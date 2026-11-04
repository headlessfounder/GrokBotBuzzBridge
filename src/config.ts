// Settings come from environment variables (see .env.example). Secrets that a
// person pastes in during setup (the Grok Bot webhook URL and key) and secrets
// the bridge generates (its Buzz key, connector token, callback secret) live in
// <data dir>/secrets.json with mode 0600, never in env files people commit.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { generateSecret, pubkeyToHex, publicKeyFromSecret, secretToHex } from "./identity.ts";

export const VERSION = "0.1.0";

export interface Config {
  dataDir: string;
  relayUrl: string; // wss://… as people type it
  publicUrl: string | null; // https://… where Grok Bot reaches the connector
  basePath: string; // path part of publicUrl, e.g. "/grokbot"
  port: number; // public listener (connector, callback, setup page)
  internalPort: number; // loopback listener (ACP adapter, CLI)
  communityName: string;
  botName: string;
  botAbout: string;
  botAvatarUrl: string | null;
  admins: string[]; // hex pubkeys
  answerIn: "all" | string[]; // channel UUIDs where @mentions are answered
  openChannels: string[]; // channel UUIDs where every message is a question
  autoJoin: boolean; // join the open channels it should answer in
  respondTo: "anyone" | "allowlist";
  allowlist: string[]; // hex pubkeys (plus admins) when respondTo = allowlist
  alertChannel: string | null;
  rateLimitPerHour: number;
  taskTimeoutMinutes: number;
  maxRepliesPerTask: number;
  allowFreePosting: boolean;
  allowReading: boolean;
  ackReaction: string;
  maxAttachmentMb: number;
  buzzBin: string;
  buzzAcpBin: string;
}

export interface Secrets {
  buzzSecretHex: string;
  connectorToken: string;
  callbackSecret: string;
  webhookUrl: string | null;
  webhookKey: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function list(name: string): string[] {
  return (process.env[name] ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be true or false`);
}

function channels(name: string): string[] {
  const ids = list(name);
  for (const id of ids) if (!UUID.test(id)) throw new Error(`${name}: "${id}" is not a channel UUID`);
  return ids.map((s) => s.toLowerCase());
}

function pubkeys(name: string): string[] {
  return list(name).map((p) => {
    try {
      return pubkeyToHex(p);
    } catch (e) {
      throw new Error(`${name}: ${(e as Error).message}`);
    }
  });
}

export function loadConfig(): Config {
  const relayUrl = (process.env.BUZZ_RELAY_URL ?? "").trim().replace(/\/+$/, "");
  if (!/^wss?:\/\/|^https?:\/\//.test(relayUrl)) {
    throw new Error("BUZZ_RELAY_URL must be set to the community address, e.g. wss://community.example.com");
  }
  const publicUrlRaw = (process.env.BRIDGE_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  let publicUrl: string | null = null;
  let basePath = "";
  if (publicUrlRaw) {
    const u = new URL(publicUrlRaw);
    if (u.protocol !== "https:" && !bool("BRIDGE_ALLOW_HTTP_PUBLIC_URL", false)) {
      throw new Error("BRIDGE_PUBLIC_URL must start with https:// (Grok Bot only calls HTTPS connectors)");
    }
    publicUrl = publicUrlRaw;
    basePath = u.pathname.replace(/\/+$/, "");
  }
  const answerInRaw = (process.env.BRIDGE_ANSWER_IN ?? "all").trim().toLowerCase();
  const respondTo = (process.env.BRIDGE_RESPOND_TO ?? "anyone").trim().toLowerCase();
  if (respondTo !== "anyone" && respondTo !== "allowlist") throw new Error("BRIDGE_RESPOND_TO must be anyone or allowlist");
  const alert = (process.env.BRIDGE_ALERT_CHANNEL ?? "").trim().toLowerCase();
  if (alert && !UUID.test(alert)) throw new Error("BRIDGE_ALERT_CHANNEL must be a channel UUID");
  return {
    dataDir: process.env.BRIDGE_DATA_DIR ?? "/data",
    relayUrl,
    publicUrl,
    basePath,
    port: int("BRIDGE_PORT", 8787, 1, 65535),
    internalPort: int("BRIDGE_INTERNAL_PORT", 8788, 1, 65535),
    communityName: (process.env.BRIDGE_COMMUNITY_NAME ?? "").trim() || new URL(relayUrl.replace(/^ws/, "http")).hostname,
    botName: (process.env.BRIDGE_BOT_NAME ?? "Grok Bot").trim(),
    botAbout: (process.env.BRIDGE_BOT_ABOUT ?? "I answer questions for this community. Mention me or DM me.").trim(),
    botAvatarUrl: (process.env.BRIDGE_BOT_AVATAR_URL ?? "").trim() || null,
    admins: pubkeys("BRIDGE_ADMINS"),
    answerIn: answerInRaw === "all" || answerInRaw === "" ? "all" : channels("BRIDGE_ANSWER_IN"),
    openChannels: channels("BRIDGE_OPEN_CHANNELS"),
    autoJoin: bool("BRIDGE_AUTO_JOIN", true),
    respondTo,
    allowlist: pubkeys("BRIDGE_ALLOWLIST"),
    alertChannel: alert || null,
    rateLimitPerHour: int("BRIDGE_RATE_LIMIT_PER_HOUR", 6, 0, 1000),
    taskTimeoutMinutes: int("BRIDGE_TASK_TIMEOUT_MINUTES", 10, 1, 240),
    maxRepliesPerTask: int("BRIDGE_MAX_REPLIES_PER_TASK", 5, 1, 50),
    allowFreePosting: bool("BRIDGE_ALLOW_FREE_POSTING", false),
    allowReading: bool("BRIDGE_ALLOW_READING", false),
    ackReaction: process.env.BRIDGE_ACK_REACTION ?? "👀",
    maxAttachmentMb: int("BRIDGE_MAX_ATTACHMENT_MB", 25, 1, 100),
    buzzBin: process.env.BRIDGE_BUZZ_BIN ?? "buzz",
    buzzAcpBin: process.env.BRIDGE_BUZZ_ACP_BIN ?? "buzz-acp",
  };
}

function token(prefix: string): string {
  return `gbb_${prefix}_${randomBytes(24).toString("base64url")}`;
}

function secretsPath(dataDir: string): string {
  return join(dataDir, "secrets.json");
}

/** Loads secrets, creating any that are missing. Env values win over the file. */
export function loadSecrets(dataDir: string): Secrets {
  mkdirSync(dataDir, { recursive: true });
  const path = secretsPath(dataDir);
  const stored: Partial<Secrets> = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  let changed = !existsSync(path);
  const s: Secrets = {
    buzzSecretHex: stored.buzzSecretHex ?? "",
    connectorToken: stored.connectorToken ?? "",
    callbackSecret: stored.callbackSecret ?? "",
    webhookUrl: stored.webhookUrl ?? null,
    webhookKey: stored.webhookKey ?? null,
  };
  if (!s.buzzSecretHex) {
    s.buzzSecretHex = generateSecret();
    changed = true;
  }
  if (!s.connectorToken) {
    s.connectorToken = token("conn");
    changed = true;
  }
  if (!s.callbackSecret) {
    s.callbackSecret = randomBytes(32).toString("hex");
    changed = true;
  }
  if (changed) saveSecrets(dataDir, s);
  // Operators may bring an existing identity or webhook through the environment.
  const envKey = process.env.BUZZ_PRIVATE_KEY?.trim();
  if (envKey) s.buzzSecretHex = secretToHex(envKey);
  if (process.env.BRIDGE_CONNECTOR_TOKEN?.trim()) s.connectorToken = process.env.BRIDGE_CONNECTOR_TOKEN.trim();
  if (process.env.GROKBOT_WEBHOOK_URL?.trim()) s.webhookUrl = process.env.GROKBOT_WEBHOOK_URL.trim();
  if (process.env.GROKBOT_WEBHOOK_KEY?.trim()) s.webhookKey = process.env.GROKBOT_WEBHOOK_KEY.trim();
  return s;
}

export function saveSecrets(dataDir: string, s: Secrets): void {
  const path = secretsPath(dataDir);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** Updates fields in the stored secrets file (not env overrides). */
export function updateSecrets(dataDir: string, patch: Partial<Secrets>): Secrets {
  const path = secretsPath(dataDir);
  const stored: Secrets = JSON.parse(readFileSync(path, "utf8"));
  const next = { ...stored, ...patch };
  saveSecrets(dataDir, next);
  return next;
}

export function newConnectorToken(): string {
  return token("conn");
}

export function botPubkey(s: Secrets): string {
  return publicKeyFromSecret(s.buzzSecretHex);
}

export function wsUrl(relayUrl: string): string {
  return relayUrl.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
}

export function httpUrl(relayUrl: string): string {
  return relayUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}
