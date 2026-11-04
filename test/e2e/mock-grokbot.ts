// A stand-in for a Grok Bot routine, for the local end-to-end test only.
// It accepts the bridge's webhook like Grok Bot would (Bearer webhook key),
// then answers through the bridge's Buzz connector exactly as the routine
// instructions in grokbot/ROUTINE.md tell Grok Bot to.

import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const KEY = process.env.MOCK_WEBHOOK_KEY ?? "";
const CONNECTOR = process.env.MOCK_CONNECTOR_URL ?? "";
const TOKEN = process.env.MOCK_CONNECTOR_TOKEN ?? "";

async function connector(): Promise<Client> {
  const client = new Client({ name: "mock-grokbot", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(CONNECTOR), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  return client;
}

function text(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("");
}

async function handle(body: Record<string, any>): Promise<void> {
  const client = await connector();
  try {
    if (body.type === "bridge.ping") {
      const r = await client.callTool({ name: "buzz_list_channels", arguments: {} });
      console.log("ping: listed channels via connector:", text(r).slice(0, 120).replace(/\s+/g, " "));
      return;
    }
    if (body.type !== "buzz.question") return;
    const view = JSON.parse(text(await client.callTool({ name: "buzz_get_task", arguments: { taskId: body.taskId } })));
    const answer = [
      `Mock answer to: "${body.question}"`,
      `I can see ${view.thread.length} message(s) in this thread.`,
      body.asker?.isAdmin ? "(You are an admin.)" : "",
    ].filter(Boolean).join("\n");
    const r = await client.callTool({ name: "buzz_reply", arguments: { taskId: body.taskId, text: answer, idempotencyKey: `${body.taskId}-1` } });
    console.log("answered", body.taskId, text(r).replace(/\s+/g, " "));
    // Retrying with the same idempotency key must not post twice.
    const again = await client.callTool({ name: "buzz_reply", arguments: { taskId: body.taskId, text: answer, idempotencyKey: `${body.taskId}-1` } });
    console.log("retry", body.taskId, text(again).replace(/\s+/g, " "));
  } finally {
    await client.close();
  }
}

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404).end();
    return;
  }
  if (req.headers.authorization !== `Bearer ${KEY}`) {
    res.writeHead(401).end("bad key");
    return;
  }
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  res.writeHead(202, { "Content-Type": "application/json" }).end('{"accepted":true}');
  // Like a real routine run: work happens after the webhook returns.
  setTimeout(() => handle(body).catch((e) => console.error("mock failed:", e)), 1500);
}).listen(9000, () => console.log("mock Grok Bot listening on :9000"));
