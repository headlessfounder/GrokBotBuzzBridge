// One JSON object per line on stderr. stdout is reserved: in `gbb acp` mode it
// carries the ACP protocol, so nothing else may ever be written there.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.BRIDGE_LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

// Values that must never reach a log line, however they got into a message.
const REDACT = [/nsec1[02-9ac-hj-np-z]{20,}/gi, /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, /(gbb_[a-z]+_)[A-Za-z0-9_-]{8,}/g];

function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    let s = value;
    for (const r of REDACT) s = s.replace(r, "[redacted]");
    return s;
  }
  if (value instanceof Error) return { message: scrub(value.message), name: value.name };
  return value;
}

function write(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < threshold) return;
  const line: Record<string, unknown> = { t: new Date().toISOString(), level, msg: scrub(msg) };
  for (const [k, v] of Object.entries(fields)) line[k] = scrub(v);
  process.stderr.write(JSON.stringify(line) + "\n");
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};
