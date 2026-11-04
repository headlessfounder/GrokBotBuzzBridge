// Runs Block's agent runner (buzz-acp) as a child process and restarts it if
// it stops. buzz-acp keeps the live connection to the relay, finds the bot's
// channels, filters @mentions, fetches thread context, and starts `gbb acp`
// for each turn. Settings below are the bridge's defaults; any BUZZ_ACP_*
// variable already set in the environment wins.

import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Config, wsUrl } from "./config.ts";
import { pubkeyToHex } from "./identity.ts";
import type { Store } from "./store.ts";
import { log } from "./log.ts";

function rulesToml(cfg: Config): string {
  const scope = cfg.answerIn === "all" ? `"all"` : `[${cfg.answerIn.map((c) => `"${c}"`).join(", ")}]`;
  let toml = `# Written by GrokBotBuzzBridge on every start. Edit BRIDGE_ANSWER_IN and
# BRIDGE_OPEN_CHANNELS instead of this file.

[[rules]]
name = "mentions"
channels = ${scope}
kinds = [9]
require_mention = true
`;
  if (cfg.openChannels.length > 0) {
    toml += `
[[rules]]
name = "open-questions"
channels = [${cfg.openChannels.map((c) => `"${c}"`).join(", ")}]
kinds = [9]
require_mention = false
`;
  }
  return toml;
}

export class Supervisor {
  private child: ChildProcess | null = null;
  private stopping = false;
  private restarts = 0;
  private readonly cfg: Config;
  private readonly store: Store;
  private readonly secretHex: string;
  private readonly internalToken: string;

  constructor(cfg: Config, store: Store, secretHex: string, internalToken: string) {
    this.cfg = cfg;
    this.store = store;
    this.secretHex = secretHex;
    this.internalToken = internalToken;
  }

  private state(s: string): void {
    this.store.setSetting("runner_state", s);
    this.store.setSetting("runner_state_at", String(Date.now()));
    this.store.setSetting("runner_restarts", String(this.restarts));
  }

  start(): void {
    const rulesPath = join(this.cfg.dataDir, "buzz-acp.toml");
    writeFileSync(rulesPath, rulesToml(this.cfg));
    const main = fileURLToPath(new URL("./main.ts", import.meta.url));
    const ownerRaw = process.env.BRIDGE_OWNER?.trim();
    const owner = ownerRaw ? pubkeyToHex(ownerRaw) : (this.cfg.admins[0] ?? "");
    const defaults: Record<string, string> = {
      BUZZ_ACP_AGENT_COMMAND: process.execPath,
      BUZZ_ACP_AGENT_ARGS: `${main},acp`,
      BUZZ_ACP_SUBSCRIBE: "config",
      BUZZ_ACP_CONFIG: rulesPath,
      BUZZ_ACP_RESPOND_TO: this.cfg.respondTo,
      BUZZ_ACP_NO_BASE_PROMPT: "true",
      BUZZ_ACP_NO_MEMORY: "true",
      BUZZ_ACP_MULTIPLE_EVENT_HANDLING: "queue",
      BUZZ_ACP_AGENTS: "1",
      BUZZ_ACP_IDLE_TIMEOUT: "120",
      RUST_LOG: process.env.RUST_LOG ?? "buzz_acp=info",
    };
    if (owner) defaults.BUZZ_ACP_AGENT_OWNER = owner;
    if (this.cfg.respondTo === "allowlist") {
      defaults.BUZZ_ACP_RESPOND_TO_ALLOWLIST = [...new Set([...this.cfg.admins, ...this.cfg.allowlist])].join(",");
    }
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    for (const [k, v] of Object.entries(defaults)) if (env[k] === undefined || env[k] === "") env[k] = v;
    env.BUZZ_PRIVATE_KEY = this.secretHex;
    env.BUZZ_RELAY_URL = wsUrl(this.cfg.relayUrl);
    env.BRIDGE_INTERNAL_TOKEN = this.internalToken;
    env.BRIDGE_INTERNAL_PORT = String(this.cfg.internalPort);
    // Secrets the runner and adapter do not need.
    delete env.GROKBOT_WEBHOOK_KEY;
    this.spawnChild(env);
  }

  private spawnChild(env: Record<string, string>): void {
    if (this.stopping) return;
    this.state("starting");
    const child = spawn(this.cfg.buzzAcpBin, [], { env, cwd: this.cfg.dataDir, stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    const pipe = (stream: NodeJS.ReadableStream | null) => {
      if (!stream) return;
      let buf = "";
      stream.on("data", (d: Buffer) => {
        buf += d.toString();
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) process.stderr.write(`[buzz-acp] ${line}\n`);
        }
      });
    };
    pipe(child.stdout);
    pipe(child.stderr);
    const startedAt = Date.now();
    child.on("spawn", () => {
      this.state("running");
      log.info("buzz-acp started", { pid: child.pid });
    });
    child.on("error", (e) => log.error("could not start buzz-acp", { error: e.message, bin: this.cfg.buzzAcpBin }));
    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.stopping) return;
      this.restarts++;
      // Back off if it keeps dying quickly; reset after a healthy hour.
      if (Date.now() - startedAt > 3600_000) this.restarts = 1;
      const wait = Math.min(60_000, 1000 * 2 ** Math.min(this.restarts, 6));
      this.state(`restarting (exit ${code ?? signal})`);
      log.warn("buzz-acp stopped; restarting", { code, signal, wait });
      setTimeout(() => this.spawnChild(env), wait);
    });
  }

  stop(): Promise<void> {
    this.stopping = true;
    this.state("stopped");
    const child = this.child;
    if (!child) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(() => child.kill("SIGKILL"), 8000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
}
