// Durable state in one SQLite file (Node's built-in node:sqlite, no native
// add-ons). Both the long-running service and short CLI commands open it; WAL
// mode lets them share it safely.

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

export type TaskStatus =
  | "queued" // waiting to be sent to Grok Bot
  | "dispatched" // Grok Bot accepted the webhook and is working
  | "answered" // Grok Bot replied and said it was done
  | "finished" // Grok Bot closed it without replying
  | "timed_out" // no answer in time; a fallback was posted
  | "failed" // could not reach Grok Bot; a fallback was posted
  | "rejected"; // refused before dispatch (paused, rate limit, not allowed)

export const OPEN: TaskStatus[] = ["queued", "dispatched"];

export interface Task {
  id: string;
  created_at: number;
  updated_at: number;
  status: TaskStatus;
  thread_key: string;
  channel_id: string;
  channel_name: string | null;
  scope: string;
  reply_to: string | null;
  trigger_event_id: string;
  asker_pubkey: string | null;
  asker_label: string | null;
  question: string;
  prompt: string;
  attempts: number;
  next_attempt_at: number;
  dispatched_at: number | null;
  closed_at: number | null;
  replies: number;
  last_error: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  scope TEXT NOT NULL,
  reply_to TEXT,
  trigger_event_id TEXT NOT NULL,
  asker_pubkey TEXT,
  asker_label TEXT,
  question TEXT NOT NULL,
  prompt TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  dispatched_at INTEGER,
  closed_at INTEGER,
  replies INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS tasks_thread ON tasks(thread_key, status);
CREATE INDEX IF NOT EXISTS tasks_asker ON tasks(asker_pubkey, created_at);
CREATE TABLE IF NOT EXISTS seen_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT,
  seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS replies (
  task_id TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  event_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, idem_key)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS setup_tokens (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  task_id TEXT,
  detail TEXT
);
`;

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dataDir: string) {
    this.db = new DatabaseSync(join(dataDir, "bridge.db"));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---- settings -------------------------------------------------------------

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  // ---- audit ----------------------------------------------------------------

  audit(kind: string, taskId: string | null, detail: Record<string, unknown> | string = {}): void {
    const text = typeof detail === "string" ? detail : JSON.stringify(detail);
    this.db.prepare("INSERT INTO audit(at, kind, task_id, detail) VALUES(?, ?, ?, ?)").run(Date.now(), kind, taskId, text.slice(0, 2000));
    this.db.prepare("DELETE FROM audit WHERE id < (SELECT MAX(id) - 5000 FROM audit)").run();
  }

  recentAudit(limit = 20): Array<{ at: number; kind: string; task_id: string | null; detail: string }> {
    return this.db.prepare("SELECT at, kind, task_id, detail FROM audit ORDER BY id DESC LIMIT ?").all(limit) as never;
  }

  // ---- events and tasks -----------------------------------------------------

  /** Returns the task already created for this Buzz event, if any. */
  seenEvent(eventId: string): string | null | undefined {
    const row = this.db.prepare("SELECT task_id FROM seen_events WHERE event_id = ?").get(eventId) as { task_id: string | null } | undefined;
    return row === undefined ? undefined : row.task_id;
  }

  markSeen(eventIds: string[], taskId: string | null): void {
    const stmt = this.db.prepare("INSERT OR IGNORE INTO seen_events(event_id, task_id, seen_at) VALUES(?, ?, ?)");
    for (const id of eventIds) stmt.run(id, taskId, Date.now());
  }

  createTask(t: Omit<Task, "id" | "created_at" | "updated_at" | "attempts" | "next_attempt_at" | "dispatched_at" | "closed_at" | "replies" | "last_error">): Task {
    const id = "t_" + randomBytes(9).toString("base64url");
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO tasks(id, created_at, updated_at, status, thread_key, channel_id, channel_name, scope, reply_to,
          trigger_event_id, asker_pubkey, asker_label, question, prompt, next_attempt_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, now, now, t.status, t.thread_key, t.channel_id, t.channel_name, t.scope, t.reply_to, t.trigger_event_id, t.asker_pubkey, t.asker_label, t.question, t.prompt, now);
    return this.getTask(id)!;
  }

  getTask(id: string): Task | null {
    return (this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined) ?? null;
  }

  updateTask(id: string, patch: Partial<Task>): void {
    const keys = Object.keys(patch).filter((k) => k !== "id");
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => (patch as Record<string, unknown>)[k] as never);
    this.db.prepare(`UPDATE tasks SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, Date.now(), id);
  }

  /** Queued tasks that are due and whose thread has nothing in flight. */
  dueTasks(now: number): Task[] {
    return this.db
      .prepare(
        `SELECT * FROM tasks q WHERE q.status = 'queued' AND q.next_attempt_at <= ?
           AND NOT EXISTS (SELECT 1 FROM tasks d WHERE d.thread_key = q.thread_key AND d.status = 'dispatched')
           AND q.id = (SELECT id FROM tasks f WHERE f.thread_key = q.thread_key AND f.status = 'queued' ORDER BY created_at LIMIT 1)
         ORDER BY q.created_at LIMIT 10`,
      )
      .all(now) as unknown as Task[];
  }

  dispatchedBefore(cutoff: number): Task[] {
    return this.db.prepare("SELECT * FROM tasks WHERE status = 'dispatched' AND dispatched_at < ?").all(cutoff) as unknown as Task[];
  }

  questionsSince(asker: string, since: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM tasks WHERE asker_pubkey = ? AND created_at >= ? AND status != 'rejected'")
      .get(asker, since) as { n: number };
    return Number(row.n);
  }

  counts(): Record<string, number> {
    const rows = this.db.prepare("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status").all() as Array<{ status: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }

  recentTasks(limit = 10): Task[] {
    return this.db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").all(limit) as unknown as Task[];
  }

  // ---- replies (idempotency) -----------------------------------------------

  findReply(taskId: string, idemKey: string): { event_id: string | null } | null {
    return (this.db.prepare("SELECT event_id FROM replies WHERE task_id = ? AND idem_key = ?").get(taskId, idemKey) as { event_id: string | null } | undefined) ?? null;
  }

  recordReply(taskId: string, idemKey: string, eventId: string | null): void {
    this.db.prepare("INSERT OR REPLACE INTO replies(task_id, idem_key, event_id, created_at) VALUES(?, ?, ?, ?)").run(taskId, idemKey, eventId, Date.now());
    this.db.prepare("UPDATE tasks SET replies = replies + 1, updated_at = ? WHERE id = ?").run(Date.now(), taskId);
  }

  // ---- one-time setup links --------------------------------------------------

  createSetupToken(kind: "link" | "session", ttlMs: number): string {
    const raw = randomBytes(24).toString("base64url");
    this.db.prepare("DELETE FROM setup_tokens WHERE expires_at < ?").run(Date.now());
    this.db.prepare("INSERT INTO setup_tokens(hash, kind, expires_at) VALUES(?, ?, ?)").run(sha256(raw), kind, Date.now() + ttlMs);
    return raw;
  }

  /** Validates a token; one-time links are consumed on use. */
  useSetupToken(raw: string, kind: "link" | "session"): boolean {
    const hash = sha256(raw);
    const row = this.db.prepare("SELECT kind, expires_at FROM setup_tokens WHERE hash = ?").get(hash) as { kind: string; expires_at: number } | undefined;
    if (!row || row.kind !== kind || row.expires_at < Date.now()) return false;
    if (kind === "link") this.db.prepare("DELETE FROM setup_tokens WHERE hash = ?").run(hash);
    return true;
  }
}
