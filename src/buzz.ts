// Talks to the Buzz community through Block's own `buzz` command-line tool,
// built from the same commit as the relay. The bridge never implements the
// Buzz protocol itself, so it stays correct as long as the tool does.
//
// The tool prints JSON on stdout. Errors are JSON on stderr with exit codes:
// 1 bad input, 2 relay/network, 3 auth, 4 other, 5 write conflict.

import { spawn } from "node:child_process";
import { log } from "./log.ts";

export class BuzzError extends Error {
  readonly code: number;
  readonly category: string;
  constructor(message: string, code: number, category: string) {
    super(message);
    this.code = code;
    this.category = category;
  }
  get retryable(): boolean {
    return this.code === 2 || this.code === 5;
  }
}

export interface BuzzMessage {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
}

export interface BuzzChannel {
  channel_id: string;
  name: string;
  description?: string;
}

export interface BuzzClientOptions {
  bin: string;
  relayUrl: string;
  secretHex: string;
}

export class BuzzClient {
  private readonly opts: BuzzClientOptions;

  constructor(opts: BuzzClientOptions) {
    this.opts = opts;
  }

  private once(args: string[], stdin: string | null, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.bin, args, {
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: process.env.HOME ?? "/tmp",
          BUZZ_RELAY_URL: this.opts.relayUrl,
          BUZZ_PRIVATE_KEY: this.opts.secretHex,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new BuzzError(`buzz ${args[0]} ${args[1] ?? ""} timed out`, 2, "timeout"));
      }, timeoutMs);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new BuzzError(`could not run ${this.opts.bin}: ${e.message}`, 4, "spawn"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          const text = out.trim();
          if (!text) return resolve(null);
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve(text);
          }
          return;
        }
        let message = err.trim() || `exit ${code}`;
        let category = "error";
        try {
          const parsed = JSON.parse(err.trim().split("\n").pop() ?? "{}");
          message = parsed.message ?? message;
          category = parsed.error ?? category;
        } catch {
          /* not JSON */
        }
        reject(new BuzzError(message, code ?? 4, category));
      });
      if (stdin !== null) child.stdin.end(stdin);
      else child.stdin.end();
    });
  }

  /** Runs the tool, retrying network and conflict errors with backoff. */
  async run(args: string[], stdin: string | null = null, timeoutMs = 30_000, attempts = 3): Promise<unknown> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.once(args, stdin, timeoutMs);
      } catch (e) {
        last = e;
        if (!(e instanceof BuzzError) || !e.retryable || i === attempts - 1) break;
        const wait = 500 * 2 ** i;
        log.warn("buzz command failed, retrying", { cmd: args.slice(0, 2).join(" "), wait, error: e.message });
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw last;
  }

  async sendMessage(p: { channel: string; content: string; replyTo?: string | null; files?: string[]; mentions?: string[] }): Promise<string> {
    const args = ["messages", "send", "--channel", p.channel, "--content", "-"];
    if (p.replyTo) args.push("--reply-to", p.replyTo);
    for (const f of p.files ?? []) args.push("--file", f);
    for (const m of p.mentions ?? []) args.push("--mention", m);
    // A write conflict (exit 5) is retried; a network failure after the relay
    // stored the message could duplicate it, so sends are attempted twice, not 3x.
    const res = (await this.run(args, p.content, 120_000, 2)) as { event_id?: string } | null;
    if (!res?.event_id) throw new BuzzError("relay did not return an event id for the message", 4, "protocol");
    return res.event_id;
  }

  async thread(channel: string, eventId: string, limit = 100): Promise<BuzzMessage[]> {
    const res = await this.run(["messages", "thread", "--channel", channel, "--event", eventId, "--limit", String(limit)]);
    return Array.isArray(res) ? (res as BuzzMessage[]) : [];
  }

  async recent(channel: string, limit = 20): Promise<BuzzMessage[]> {
    const res = await this.run(["messages", "get", "--channel", channel, "--limit", String(limit)]);
    return Array.isArray(res) ? (res as BuzzMessage[]) : [];
  }

  async search(query: string, limit = 20): Promise<BuzzMessage[]> {
    const res = await this.run(["messages", "search", "--query", query, "--limit", String(limit)]);
    return Array.isArray(res) ? (res as BuzzMessage[]) : [];
  }

  async channels(): Promise<BuzzChannel[]> {
    const res = await this.run(["channels", "list", "--member"]);
    return Array.isArray(res) ? (res as BuzzChannel[]) : [];
  }

  async allOpenChannels(): Promise<BuzzChannel[]> {
    const res = await this.run(["channels", "list"]);
    return Array.isArray(res) ? (res as BuzzChannel[]) : [];
  }

  async joinChannel(channel: string): Promise<void> {
    await this.run(["channels", "join", "--channel", channel]);
  }

  async react(eventId: string, emoji: string): Promise<void> {
    await this.run(["reactions", "add", "--event", eventId, "--emoji", emoji], null, 15_000, 2);
  }

  async unreact(eventId: string, emoji: string): Promise<void> {
    await this.run(["reactions", "remove", "--event", eventId, "--emoji", emoji], null, 15_000, 2);
  }

  async setProfile(p: { name: string; about: string; avatar: string | null }): Promise<void> {
    const args = ["users", "set-profile", "--name", p.name, "--about", p.about];
    if (p.avatar) args.push("--avatar", p.avatar);
    await this.run(args);
  }

  async users(pubkeys: string[]): Promise<Array<{ pubkey: string; display_name?: string; name?: string }>> {
    if (pubkeys.length === 0) return [];
    const args = ["users", "get"];
    for (const p of pubkeys) args.push("--pubkeys", p);
    const res = await this.run(args);
    return Array.isArray(res) ? (res as never) : [];
  }

  /** Downloads relay media (needs the bot's auth) to a local path. */
  async mediaGet(input: string, output: string): Promise<void> {
    await this.run(["media", "get", input, "--output", output], null, 120_000, 2);
  }
}
