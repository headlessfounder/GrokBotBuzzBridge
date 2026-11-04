// Two HTTP listeners:
//
//   public   (BRIDGE_PORT, default 8787) — what the reverse proxy or tunnel exposes:
//            /healthz, /mcp (the Buzz connector), /callback/<taskId>, /setup
//   internal (127.0.0.1:BRIDGE_INTERNAL_PORT, default 8788) — only processes in
//            the same container: the ACP adapter and the gbb CLI.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type Config, VERSION, loadSecrets, newConnectorToken, updateSecrets } from "./config.ts";
import type { Bridge } from "./bridge.ts";
import { buildConnector } from "./mcp.ts";
import { renderSetup } from "./setup-page.ts";
import { runChecks, testWebhook } from "./checks.ts";
import { npub } from "./identity.ts";
import { log } from "./log.ts";

const MAX_BODY = 2 * 1024 * 1024;
const SESSION_MS = 60 * 60_000;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function bearer(req: IncomingMessage): string {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function startServers(bridge: Bridge, internalToken: string): { close: () => void } {
  const cfg: Config = bridge.cfg;
  const csrfSecret = randomBytes(16).toString("hex");

  // ---- public ---------------------------------------------------------------
  const publicServer = createServer(async (req, res) => {
    const started = Date.now();
    try {
      let path = new URL(req.url ?? "/", "http://x").pathname;
      if (cfg.basePath && path.startsWith(cfg.basePath)) path = path.slice(cfg.basePath.length) || "/";
      await routePublic(req, res, path);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (status >= 500) log.error("request failed", { url: req.url, error: e });
      if (!res.headersSent) send(res, status, { error: status >= 500 ? "internal error" : (e as Error).message });
    } finally {
      log.debug("http", { method: req.method, url: req.url?.replace(/\/mcp\/[^/?]+/, "/mcp/[token]"), ms: Date.now() - started, status: res.statusCode });
    }
  });

  async function routePublic(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (path === "/healthz") return send(res, 200, { ok: true, version: VERSION });

    // The Buzz connector (MCP, streamable HTTP, stateless).
    if (path === "/mcp" || path.startsWith("/mcp/")) {
      const presented = path.startsWith("/mcp/") ? decodeURIComponent(path.slice(5)) : bearer(req);
      const token = loadSecrets(cfg.dataDir).connectorToken;
      if (!presented || !same(presented, token)) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="buzz-connector"');
        return send(res, 401, { error: "connector token missing or wrong" });
      }
      bridge.store.setSetting("connector_seen", String(Date.now()));
      if (req.method === "GET" || req.method === "DELETE") {
        // Stateless server: no standalone SSE stream and no sessions to delete.
        return send(res, 405, { error: "method not allowed" }, { Allow: "POST" });
      }
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : undefined;
      const server = buildConnector(bridge);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
      return;
    }

    // Plain HTTP fallback for posting an answer.
    const cb = path.match(/^\/callback\/(t_[A-Za-z0-9_-]+)$/);
    if (cb) {
      const taskId = cb[1]!;
      if (!bridge.checkCallbackToken(taskId, bearer(req))) return send(res, 401, { error: "callback token missing or wrong" });
      if (req.method === "GET") {
        const t = bridge.store.getTask(taskId);
        return t ? send(res, 200, { taskId, status: t.status, replies: t.replies }) : send(res, 404, { error: "unknown task" });
      }
      if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
      const body = JSON.parse((await readBody(req)) || "{}") as { text?: string; message?: string; done?: boolean; attachments?: Array<{ url: string; filename?: string }>; idempotencyKey?: string; eventId?: string };
      try {
        const r = await bridge.reply({
          taskId,
          text: body.text ?? body.message ?? "",
          done: body.done,
          attachments: body.attachments,
          idempotencyKey: body.idempotencyKey ?? body.eventId,
          source: "callback",
        });
        return send(res, 200, { ok: true, ...r });
      } catch (e) {
        return send(res, 400, { ok: false, error: (e as Error).message });
      }
    }

    if (path === "/setup" || path.startsWith("/setup/")) return routeSetup(req, res, path);

    send(res, 404, { error: "not found" });
  }

  // ---- setup page -----------------------------------------------------------
  const pagePath = `${cfg.basePath}/setup`;
  const secure = Boolean(cfg.publicUrl?.startsWith("https://"));

  async function routeSetup(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    // One-time link → session cookie.
    const linkToken = url.searchParams.get("token");
    if (req.method === "GET" && path === "/setup" && linkToken) {
      if (!bridge.store.useSetupToken(linkToken, "link")) {
        return send(res, 403, "This setup link has expired or was already used. Ask for a new one with: gbb setup-link");
      }
      const session = bridge.store.createSetupToken("session", SESSION_MS);
      res.writeHead(303, {
        Location: pagePath,
        "Set-Cookie": `gbb_setup=${session}; HttpOnly; SameSite=Strict; Path=${cfg.basePath || "/"}; Max-Age=${SESSION_MS / 1000}${secure ? "; Secure" : ""}`,
        "Cache-Control": "no-store",
      });
      return void res.end();
    }
    const session = cookies(req).gbb_setup ?? "";
    if (!session || !bridge.store.useSetupToken(session, "session")) {
      return send(res, 403, "Open the setup page from a fresh link: run gbb setup-link on the server.");
    }
    const csrf = csrfSecret + session.slice(0, 8);
    if (req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      if (form.get("csrf") !== csrf) return send(res, 403, "Form expired. Reload the page.");
      let flash = "";
      if (path === "/setup/webhook") {
        const u = (form.get("url") ?? "").trim();
        const k = (form.get("key") ?? "").trim();
        if (!/^https:\/\//.test(u) || !k) flash = "Paste both the webhook URL (https://…) and the key.";
        else {
          const s = updateSecrets(cfg.dataDir, { webhookUrl: u, webhookKey: k });
          bridge.setSecrets(loadSecrets(cfg.dataDir));
          bridge.store.audit("webhook_saved", null, { host: new URL(u).host });
          const t = await testWebhook(bridge, s.webhookUrl!, s.webhookKey!);
          flash = t.status >= 200 && t.status < 300
            ? "Saved, and Grok Bot accepted a test webhook. Check the routine's run history in Grok Bot."
            : `Saved, but the test webhook failed (${t.status ? "HTTP " + t.status : t.error}). Check the URL and key.`;
        }
      } else if (path === "/setup/test-webhook") {
        const s = loadSecrets(cfg.dataDir);
        if (!s.webhookUrl || !s.webhookKey) flash = "Save the webhook first.";
        else {
          const t = await testWebhook(bridge, s.webhookUrl, s.webhookKey);
          flash = t.status >= 200 && t.status < 300 ? "Grok Bot accepted the test webhook." : `Test failed: ${t.status ? "HTTP " + t.status : t.error}`;
        }
      } else if (path === "/setup/rotate-connector") {
        updateSecrets(cfg.dataDir, { connectorToken: newConnectorToken() });
        bridge.store.audit("connector_rotated", null);
        flash = "New connector token made. Update the connector in Grok Bot with it.";
      } else if (path === "/setup/refresh") {
        flash = "Checks updated.";
      }
      bridge.store.setSetting("setup_flash", flash);
      res.writeHead(303, { Location: pagePath, "Cache-Control": "no-store" });
      return void res.end();
    }
    const secrets = loadSecrets(cfg.dataDir);
    const checks = await runChecks(bridge, { includePublic: false });
    const flash = bridge.store.getSetting("setup_flash");
    bridge.store.setSetting("setup_flash", "");
    const connectorUrl = cfg.publicUrl ? `${cfg.publicUrl}/mcp` : null;
    const html = renderSetup({
      community: cfg.communityName,
      botName: cfg.botName,
      npub: npub(bridge.botPubkey),
      webhookConfigured: Boolean(secrets.webhookUrl && secrets.webhookKey),
      webhookFromEnv: Boolean(process.env.GROKBOT_WEBHOOK_URL || process.env.GROKBOT_WEBHOOK_KEY),
      webhookHost: secrets.webhookUrl ? new URL(secrets.webhookUrl).host : null,
      connectorUrl,
      connectorUrlWithToken: connectorUrl ? `${connectorUrl}/${encodeURIComponent(secrets.connectorToken)}` : null,
      connectorToken: secrets.connectorToken,
      checks: checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.fix && c.ok === false ? `${c.detail}. ${c.fix}` : c.detail })),
      flash: flash || null,
      csrf,
    });
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; script-src 'unsafe-inline'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(html);
  }

  // ---- internal -------------------------------------------------------------
  const internalServer = createServer(async (req, res) => {
    try {
      if (!same(bearer(req), internalToken)) return send(res, 401, { error: "internal token wrong" });
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (req.method === "POST" && path === "/internal/turns") {
        const { text } = JSON.parse(await readBody(req)) as { text: string };
        return send(res, 200, await bridge.handleTurn(text ?? ""));
      }
      if (req.method === "GET" && path === "/internal/status") {
        return send(res, 200, await statusReport(bridge, false));
      }
      if (req.method === "GET" && path === "/internal/check") {
        return send(res, 200, await runChecks(bridge, { includePublic: true }));
      }
      if (req.method === "POST" && path === "/internal/test-webhook") {
        const s = loadSecrets(cfg.dataDir);
        if (!s.webhookUrl || !s.webhookKey) return send(res, 400, { error: "webhook not saved yet" });
        return send(res, 200, await testWebhook(bridge, s.webhookUrl, s.webhookKey));
      }
      if (req.method === "POST" && path === "/internal/reload-secrets") {
        bridge.setSecrets(loadSecrets(cfg.dataDir));
        return send(res, 200, { ok: true });
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      log.error("internal request failed", { error: e });
      if (!res.headersSent) send(res, 500, { error: (e as Error).message });
    }
  });

  publicServer.listen(cfg.port, "0.0.0.0", () => log.info("public listener up", { port: cfg.port, publicUrl: cfg.publicUrl }));
  internalServer.listen(cfg.internalPort, "127.0.0.1", () => log.info("internal listener up", { port: cfg.internalPort }));
  return {
    close: () => {
      publicServer.close();
      internalServer.close();
    },
  };
}

export async function statusReport(bridge: Bridge, withChecks: boolean): Promise<Record<string, unknown>> {
  const cfg = bridge.cfg;
  return {
    version: VERSION,
    community: cfg.communityName,
    relay: cfg.relayUrl,
    bot: { name: cfg.botName, npub: npub(bridge.botPubkey), pubkey: bridge.botPubkey },
    publicUrl: cfg.publicUrl,
    connectorUrl: cfg.publicUrl ? `${cfg.publicUrl}/mcp` : null,
    paused: bridge.paused,
    webhookConfigured: bridge.webhookConfigured,
    runner: { state: bridge.store.getSetting("runner_state"), restarts: Number(bridge.store.getSetting("runner_restarts") ?? "0") },
    tasks: bridge.store.counts(),
    recent: bridge.store.recentTasks(8).map((t) => ({
      id: t.id,
      status: t.status,
      at: new Date(t.created_at).toISOString(),
      channel: t.channel_name ?? t.channel_id,
      asker: t.asker_label,
      question: t.question.slice(0, 80),
      error: t.last_error,
    })),
    ...(withChecks ? { checks: await runChecks(bridge, { includePublic: true }) } : {}),
  };
}
