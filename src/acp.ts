// `gbb acp` — the "agent" that Block's runner (buzz-acp) starts over stdio.
//
// buzz-acp speaks ACP (Agent Client Protocol: JSON-RPC 2.0, one JSON object per
// line) to its agent. A normal agent would think and then post with the buzz
// tool. This one hands each turn to the bridge service and returns at once:
// Grok Bot answers later, through the connector, so the channel is never
// blocked while Grok Bot works.
//
// stdout carries the protocol only. Logs go to stderr.

import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { VERSION } from "./config.ts";
import { log } from "./log.ts";

type Json = Record<string, unknown>;

function write(msg: Json): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function respond(id: unknown, result: Json): void {
  write({ jsonrpc: "2.0", id, result });
}

function error(id: unknown, code: number, message: string): void {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

function promptText(params: Json): string {
  const blocks = Array.isArray(params.prompt) ? (params.prompt as Json[]) : [];
  return blocks
    .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : typeof b.resource === "object" && b.resource && typeof (b.resource as Json).text === "string" ? ((b.resource as Json).text as string) : ""))
    .filter(Boolean)
    .join("\n\n");
}

async function handOff(text: string): Promise<Json> {
  const port = process.env.BRIDGE_INTERNAL_PORT ?? "8788";
  const token = process.env.BRIDGE_INTERNAL_TOKEN ?? "";
  let lastError = "";
  // The service normally answers in milliseconds; retry briefly if it is restarting.
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/internal/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return (await res.json()) as Json;
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, Math.min(4000, 250 * 2 ** attempt)));
  }
  throw new Error(`bridge service unavailable: ${lastError}`);
}

export async function runAcpAdapter(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();

  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: Json;
    try {
      msg = JSON.parse(line) as Json;
    } catch {
      log.warn("acp: ignoring a line that is not JSON");
      continue;
    }
    const id = msg.id;
    const method = typeof msg.method === "string" ? msg.method : "";
    const params = (msg.params ?? {}) as Json;
    const isRequest = id !== undefined && id !== null && method !== "";

    if (!method) continue; // a response to something we never send

    switch (method) {
      case "initialize":
        respond(id, {
          // buzz-acp asks for protocol 2; answering 2 means it sends the system
          // prompt in session/new (which we ignore) instead of every message.
          protocolVersion: 2,
          agentCapabilities: {
            loadSession: false,
            promptCapabilities: { image: false, audio: false, embeddedContext: true },
            mcpCapabilities: { http: false, sse: false },
          },
          agentInfo: { name: "grokbot-buzz-bridge", title: "Grok Bot (via GrokBotBuzzBridge)", version: VERSION },
          authMethods: [],
        });
        break;
      case "authenticate":
        respond(id, {});
        break;
      case "session/new":
        respond(id, { sessionId: "gbb_" + randomBytes(8).toString("hex") });
        break;
      case "session/prompt": {
        const text = promptText(params);
        const p = handOff(text)
          .then((result) => {
            log.info("acp: turn handed to the bridge", { action: result.action, task: result.taskId });
            respond(id, { stopReason: "end_turn" });
          })
          .catch((e) => {
            log.error("acp: could not hand the turn to the bridge", { error: (e as Error).message });
            error(id, -32603, (e as Error).message);
          })
          .finally(() => pending.delete(p));
        pending.add(p);
        break;
      }
      case "session/cancel":
        // Turns finish in milliseconds; nothing to cancel.
        break;
      default:
        if (isRequest) {
          // Optional methods (model selection, config, etc.) are not supported.
          error(id, -32601, `method not supported: ${method}`);
        }
    }
  }
  await Promise.allSettled([...pending]);
}
