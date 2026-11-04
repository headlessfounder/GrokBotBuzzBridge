#!/usr/bin/env node
// gbb — GrokBotBuzzBridge command line.
//
//   gbb start            run the bridge (the container's main process)
//   gbb status [--json]  what the bridge is doing right now
//   gbb check [--json]   every health check, with fixes; exit 1 if any fail
//   gbb setup-link       one-time link to the setup page (for the person)
//   gbb test-webhook     send Grok Bot a harmless ping
//   gbb selftest --channel <uuid>   ask a real question and wait for the answer
//   gbb channels [--json]           channels the bot sees, and which it is in
//   gbb identity         the bot's public identity (npub)
//   gbb backup-key --show            print the bot's secret key (people only)
//   gbb acp              internal: the agent process buzz-acp starts

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const [, , command = "help", ...rest] = process.argv;

function flag(name: string): boolean {
  return rest.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

async function internal(path: string, method = "GET"): Promise<unknown> {
  const { loadConfig } = await import("./config.ts");
  const cfg = loadConfig();
  const tokenFile = join(cfg.dataDir, "internal-token");
  if (!existsSync(tokenFile)) throw new Error("the bridge is not running (no internal token yet). Start it first.");
  const token = readFileSync(tokenFile, "utf8").trim();
  const res = await fetch(`http://127.0.0.1:${cfg.internalPort}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body;
}

function printChecks(checks: Array<{ name: string; ok: boolean | null; detail: string; fix?: string }>): void {
  for (const c of checks) {
    const mark = c.ok === null ? "–" : c.ok ? "✓" : "✗";
    console.log(`${mark} ${c.name}: ${c.detail}`);
    if (c.fix && c.ok !== true) console.log(`    fix: ${c.fix}`);
  }
}

async function start(): Promise<void> {
  const { loadConfig, loadSecrets, VERSION } = await import("./config.ts");
  const { Store } = await import("./store.ts");
  const { Bridge } = await import("./bridge.ts");
  const { startServers } = await import("./server.ts");
  const { Supervisor } = await import("./supervisor.ts");
  const { npub } = await import("./identity.ts");
  const { sha256 } = await import("./store.ts");
  const { log } = await import("./log.ts");

  const cfg = loadConfig();
  const secrets = loadSecrets(cfg.dataDir);
  const store = new Store(cfg.dataDir);
  const bridge = new Bridge(cfg, secrets, store);
  const internalToken = randomBytes(24).toString("base64url");
  writeFileSync(join(cfg.dataDir, "internal-token"), internalToken + "\n", { mode: 0o600 });

  log.info("starting GrokBotBuzzBridge", { version: VERSION, relay: cfg.relayUrl, bot: npub(bridge.botPubkey), publicUrl: cfg.publicUrl });
  const servers = startServers(bridge, internalToken);
  bridge.start();

  // Profile: set once per change, so the bot shows a name in Buzz. Retried
  // with the channel check below until the community lets the bot in.
  const profileHash = sha256(JSON.stringify([cfg.botName, cfg.botAbout, cfg.botAvatarUrl]));
  const ensureProfile = async () => {
    if (store.getSetting("profile_hash") === profileHash) return;
    try {
      await bridge.buzz.setProfile({ name: cfg.botName, about: cfg.botAbout, avatar: cfg.botAvatarUrl });
      store.setSetting("profile_hash", profileHash);
      log.info("profile set", { name: cfg.botName });
    } catch (e) {
      log.warn("could not set the bot's profile yet (is it a member of the community?)", { error: (e as Error).message });
    }
  };

  // Join the open channels it should answer in. Private channels need an admin.
  const autoJoin = async () => {
    if (!cfg.autoJoin) return;
    try {
      const member = new Set((await bridge.buzz.channels()).map((c) => c.channel_id));
      const visible = await bridge.buzz.allOpenChannels();
      const wanted = cfg.answerIn === "all" ? visible.map((c) => c.channel_id) : [...new Set([...cfg.answerIn, ...cfg.openChannels])];
      for (const id of wanted) {
        if (member.has(id)) continue;
        try {
          await bridge.buzz.joinChannel(id);
          log.info("joined channel", { channel: visible.find((c) => c.channel_id === id)?.name ?? id });
        } catch (e) {
          log.warn("could not join channel (private channels need an admin to add the bot)", { channel: id, error: (e as Error).message });
        }
      }
    } catch (e) {
      log.warn("channel auto-join skipped", { error: (e as Error).message });
    }
  };
  const housekeeping = async () => {
    await ensureProfile();
    await autoJoin();
  };
  await housekeeping();
  const joinTimer = setInterval(() => void housekeeping(), 5 * 60_000);

  const supervisor = new Supervisor(cfg, store, secrets.buzzSecretHex, internalToken);
  supervisor.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    clearInterval(joinTimer);
    bridge.stop();
    await supervisor.stop();
    servers.close();
    store.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

async function selftest(): Promise<void> {
  const channel = option("channel");
  const timeout = Number(option("timeout") ?? "300");
  if (!channel) throw new Error("usage: gbb selftest --channel <channel uuid> [--timeout seconds]");
  const { loadConfig, loadSecrets, botPubkey, wsUrl } = await import("./config.ts");
  const { BuzzClient } = await import("./buzz.ts");
  const { generateSecret } = await import("./identity.ts");
  const cfg = loadConfig();
  const bot = botPubkey(loadSecrets(cfg.dataDir));
  const tester = new BuzzClient({ bin: cfg.buzzBin, relayUrl: wsUrl(cfg.relayUrl), secretHex: generateSecret() });
  console.log("Using a temporary test identity to ask the bot a question.");
  try {
    await tester.joinChannel(channel);
  } catch (e) {
    console.log(`(could not join the channel as the tester: ${(e as Error).message})`);
  }
  try {
    await tester.setProfile({ name: "Bridge self-test", about: "Temporary identity used by gbb selftest", avatar: null });
  } catch {
    /* optional */
  }
  const question = option("question") ?? "This is an automated test from the bridge installer. Please reply with one short sentence confirming you can read this.";
  const eventId = await tester.sendMessage({ channel, content: `@${cfg.botName} ${question}`, mentions: [bot] });
  console.log(`Asked in channel ${channel} (event ${eventId.slice(0, 12)}…). Waiting up to ${timeout}s for the bot's answer…`);
  const deadline = Date.now() + timeout * 1000;
  let notice = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const thread = await tester.thread(channel, eventId).catch(() => []);
    const answers = thread.filter((m) => m.pubkey === bot && m.id !== eventId);
    const real = answers.filter((m) => !/^(Sorry, I couldn't reach|I'm not connected|I'm paused|This is taking longer)/.test(m.content));
    if (real.length > 0) {
      console.log(`✓ The bot answered:\n\n${real[real.length - 1]!.content}\n`);
      return;
    }
    if (answers.length > 0 && !notice) {
      notice = true;
      console.log(`The bridge posted a notice instead of an answer:\n  ${answers[0]!.content}\nStill waiting in case Grok Bot answers late…`);
    }
  }
  console.log("✗ No answer in time. Run `gbb status` to see what happened to the question.");
  process.exitCode = 1;
}

async function main(): Promise<void> {
  switch (command) {
    case "start":
      return start();
    case "acp": {
      const { runAcpAdapter } = await import("./acp.ts");
      return runAcpAdapter();
    }
    case "status": {
      const s = (await internal("/internal/status")) as Record<string, any>;
      if (flag("json")) return console.log(JSON.stringify(s, null, 2));
      console.log(`GrokBotBuzzBridge ${s.version} · ${s.community} (${s.relay})`);
      console.log(`Bot: ${s.bot.name} · ${s.bot.npub}`);
      console.log(`Connector: ${s.connectorUrl ?? "no public address set"}`);
      console.log(`State: ${s.paused ? "PAUSED" : "running"} · runner ${s.runner.state ?? "?"} (restarts ${s.runner.restarts}) · webhook ${s.webhookConfigured ? "saved" : "NOT saved"}`);
      console.log(`Questions: ${JSON.stringify(s.tasks)}`);
      for (const t of s.recent) console.log(`  ${t.at}  ${t.status.padEnd(10)} #${t.channel}  ${t.asker ?? "?"}: ${t.question}${t.error ? `  [${t.error}]` : ""}`);
      return;
    }
    case "check": {
      const checks = (await internal("/internal/check")) as Array<{ name: string; ok: boolean | null; detail: string; fix?: string }>;
      if (flag("json")) console.log(JSON.stringify(checks, null, 2));
      else printChecks(checks);
      if (checks.some((c) => c.ok === false)) process.exitCode = 1;
      return;
    }
    case "setup-link": {
      const { loadConfig } = await import("./config.ts");
      const { Store } = await import("./store.ts");
      const cfg = loadConfig();
      const store = new Store(cfg.dataDir);
      const token = store.createSetupToken("link", 30 * 60_000);
      store.close();
      const base = cfg.publicUrl ?? `http://localhost:${cfg.port}`;
      console.log(`${base}/setup?token=${token}`);
      console.error(cfg.publicUrl ? "Works once, for 30 minutes. Give it to the person setting up Grok Bot." : "No BRIDGE_PUBLIC_URL is set, so this is a local link: open it through an SSH tunnel to this server's port.");
      return;
    }
    case "test-webhook": {
      const r = (await internal("/internal/test-webhook", "POST")) as { status: number; error?: string };
      console.log(r.status >= 200 && r.status < 300 ? `✓ Grok Bot accepted the ping (HTTP ${r.status}). Check the routine's run history in Grok Bot.` : `✗ Ping failed: ${r.status ? `HTTP ${r.status}` : r.error}`);
      if (!(r.status >= 200 && r.status < 300)) process.exitCode = 1;
      return;
    }
    case "selftest":
      return selftest();
    case "channels": {
      const { loadConfig, loadSecrets, wsUrl } = await import("./config.ts");
      const { BuzzClient } = await import("./buzz.ts");
      const cfg = loadConfig();
      const client = new BuzzClient({ bin: cfg.buzzBin, relayUrl: wsUrl(cfg.relayUrl), secretHex: loadSecrets(cfg.dataDir).buzzSecretHex });
      const member = await client.channels();
      const visible = await client.allOpenChannels();
      const all = new Map([...visible, ...member].map((c) => [c.channel_id, c]));
      const memberIds = new Set(member.map((c) => c.channel_id));
      if (flag("json")) return console.log(JSON.stringify([...all.values()].map((c) => ({ ...c, member: memberIds.has(c.channel_id) })), null, 2));
      for (const c of [...all.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        console.log(`${memberIds.has(c.channel_id) ? "member " : "       "} ${c.channel_id}  #${c.name}`);
      }
      return;
    }
    case "identity": {
      const { loadConfig, loadSecrets, botPubkey } = await import("./config.ts");
      const { npub } = await import("./identity.ts");
      const pk = botPubkey(loadSecrets(loadConfig().dataDir));
      console.log(JSON.stringify({ npub: npub(pk), pubkey: pk }, null, 2));
      return;
    }
    case "backup-key": {
      if (!flag("show")) {
        console.log("This prints the bot's secret key. Whoever has it can speak as the bot.\nRun it yourself (not through an AI agent) with --show, and store the result in a password manager.");
        return;
      }
      const { loadConfig, loadSecrets } = await import("./config.ts");
      const { nsec } = await import("./identity.ts");
      console.log(nsec(loadSecrets(loadConfig().dataDir).buzzSecretHex));
      return;
    }
    case "version": {
      const { VERSION } = await import("./config.ts");
      console.log(VERSION);
      return;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 15).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  }
}

main().catch((e) => {
  console.error(`gbb ${command}: ${(e as Error).message}`);
  process.exit(1);
});
