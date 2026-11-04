// Health checks shared by `gbb check`, `gbb status` and the setup page. Each
// one says what is wrong in plain words and what to do about it, so an agent
// or a person can fix problems without reading code.

import { httpUrl } from "./config.ts";
import type { Bridge } from "./bridge.ts";

export interface Check {
  id: string;
  name: string;
  ok: boolean | null; // null = not applicable yet
  detail: string;
  fix?: string;
}

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export async function runChecks(bridge: Bridge, opts: { includePublic: boolean }): Promise<Check[]> {
  const cfg = bridge.cfg;
  const out: Check[] = [];

  // 1. Relay answers NIP-11.
  try {
    const res = await fetch(httpUrl(cfg.relayUrl), { headers: { Accept: "application/nostr+json" }, signal: AbortSignal.timeout(10_000) });
    const info = (await res.json()) as { name?: string; version?: string; software?: string };
    out.push({ id: "relay", name: "Buzz relay reachable", ok: res.ok, detail: `${cfg.relayUrl} answers${info.version ? ` (version ${info.version})` : ""}` });
  } catch (e) {
    out.push({ id: "relay", name: "Buzz relay reachable", ok: false, detail: (e as Error).message, fix: "Check BUZZ_RELAY_URL and that this server can reach the community address." });
  }

  // 2. Bot can authenticate and see its channels.
  try {
    const channels = await bridge.buzz.channels();
    out.push({ id: "auth", name: "Bot signs in to Buzz", ok: true, detail: `signed in as ${cfg.botName}` });
    const missing = cfg.openChannels.filter((id) => !channels.some((c) => c.channel_id === id));
    const names = channels.map((c) => c.name).slice(0, 8).join(", ");
    out.push({
      id: "channels",
      name: "Bot is in channels",
      ok: channels.length > 0 && missing.length === 0,
      detail: channels.length ? `member of ${channels.length}: ${names}${channels.length > 8 ? ", …" : ""}` : "not a member of any channel",
      fix: missing.length
        ? `Not yet in open-question channel(s) ${missing.join(", ")}. For a private channel, an admin adds the bot in the Buzz app.`
        : channels.length === 0
          ? "Open channels are joined automatically on start. For private channels, an admin adds the bot in the Buzz app."
          : undefined,
    });
  } catch (e) {
    const msg = (e as Error).message;
    out.push({
      id: "auth",
      name: "Bot signs in to Buzz",
      ok: false,
      detail: msg,
      fix: /auth|forbidden|member|401|403/i.test(msg)
        ? "On an invite-only community, an admin must add the bot's npub as a member (shown by `gbb status`)."
        : "Check that the relay is reachable and BUZZ_RELAY_URL is right.",
    });
  }

  // 3. Block's runner is alive.
  const runner = bridge.store.getSetting("runner_state");
  const runnerAt = Number(bridge.store.getSetting("runner_state_at") ?? "0");
  out.push({
    id: "runner",
    name: "Listening for questions (buzz-acp)",
    ok: runner === "running",
    detail: runner ? `${runner}, ${ago(runnerAt)}` : "not started",
    fix: runner === "running" ? undefined : "Check the container logs: docker logs <container>. The bridge restarts the runner automatically.",
  });

  // 4. Public address.
  if (!cfg.publicUrl) {
    out.push({ id: "public", name: "Public https address", ok: false, detail: "BRIDGE_PUBLIC_URL is not set", fix: "Grok Bot runs in the cloud; give the bridge an https address (see docs/install/04-public-address.md)." });
  } else if (opts.includePublic) {
    try {
      const res = await fetch(`${cfg.publicUrl}/healthz`, { signal: AbortSignal.timeout(10_000) });
      out.push({ id: "public", name: "Public https address", ok: res.ok, detail: `${cfg.publicUrl} → HTTP ${res.status}` });
    } catch (e) {
      out.push({
        id: "public",
        name: "Public https address",
        ok: false,
        detail: `${cfg.publicUrl}: ${(e as Error).message}`,
        fix: "Check the reverse proxy or tunnel. Some servers cannot reach their own public address; test from another machine with curl <url>/healthz.",
      });
    }
  } else {
    out.push({ id: "public", name: "Public https address", ok: null, detail: cfg.publicUrl });
  }

  // 5-7. Grok Bot side.
  out.push({
    id: "webhook",
    name: "Grok Bot webhook saved",
    ok: bridge.webhookConfigured,
    detail: bridge.webhookConfigured ? "saved" : "not saved yet",
    fix: bridge.webhookConfigured ? undefined : "Open the setup page (gbb setup-link) and paste the routine's webhook URL and key.",
  });
  const test = bridge.store.getSetting("webhook_test");
  if (test) {
    const t = JSON.parse(test) as { at: number; status: number; error?: string };
    out.push({
      id: "webhook_test",
      name: "Grok Bot accepts the webhook",
      ok: t.status >= 200 && t.status < 300,
      detail: `last test ${ago(t.at)}: ${t.status ? `HTTP ${t.status}` : t.error}`,
      fix: t.status === 401 || t.status === 403 ? "The webhook key is wrong. Copy it again from the routine in Grok Bot." : undefined,
    });
  } else {
    out.push({ id: "webhook_test", name: "Grok Bot accepts the webhook", ok: null, detail: "not tested yet (Send a test webhook on the setup page, or gbb test-webhook)" });
  }
  const conn = Number(bridge.store.getSetting("connector_last_used") ?? bridge.store.getSetting("connector_seen") ?? "0");
  out.push({
    id: "connector",
    name: "Grok Bot reaches the Buzz connector",
    ok: conn ? true : null,
    detail: conn ? `last used ${ago(conn)}` : "Grok Bot has not called the connector yet",
    fix: conn ? undefined : "Add the connector in Grok Bot (setup page, step 2), then send a test webhook: the routine calls the connector when it gets the ping.",
  });
  const counts = bridge.store.counts();
  out.push({
    id: "answered",
    name: "Grok Bot has answered a question",
    ok: (counts.answered ?? 0) > 0 ? true : null,
    detail: `answered ${counts.answered ?? 0}, timed out ${counts.timed_out ?? 0}, failed ${counts.failed ?? 0}`,
  });
  return out;
}

export async function testWebhook(bridge: Bridge, url: string, key: string): Promise<{ status: number; error?: string }> {
  let result: { status: number; error?: string };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "User-Agent": "GrokBotBuzzBridge/0.1" },
      body: JSON.stringify({
        type: "bridge.ping",
        version: 1,
        sentAt: new Date().toISOString(),
        community: { name: bridge.cfg.communityName, relay: bridge.cfg.relayUrl },
        note: "Test from the bridge. Do not post in Buzz. Call the Buzz connector tool buzz_list_channels once to prove the connector works, then stop.",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    result = { status: res.status, ...(res.ok ? {} : { error: (await res.text().catch(() => "")).slice(0, 200) }) };
  } catch (e) {
    result = { status: 0, error: (e as Error).message };
  }
  bridge.store.setSetting("webhook_test", JSON.stringify({ at: Date.now(), ...result }));
  return result;
}
