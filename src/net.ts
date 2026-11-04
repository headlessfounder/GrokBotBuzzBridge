// Fetching URLs that Grok Bot hands us (attachments). The bridge sits on a
// server next to private services, so a URL must never be allowed to reach
// them: only https, only public addresses, a size cap, and no redirects to
// anywhere we have not checked.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function privateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80")) return true;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? privateV4(mapped[1]!) : false;
}

export async function assertPublicHttps(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("not a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("only https:// links can be attached");
  if (url.username || url.password) throw new Error("links with credentials are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const a of addresses) {
    if (a.family === 4 ? privateV4(a.address) : privateV6(a.address)) {
      throw new Error("that link points to a private network address");
    }
  }
  return url;
}

export interface Downloaded {
  path: string;
  dir: string;
  bytes: number;
  head: Buffer;
}

/** Downloads a public https URL to a temp file, following at most 3 checked redirects. */
export async function download(raw: string, maxBytes: number, filename?: string): Promise<Downloaded> {
  let url = await assertPublicHttps(raw);
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicHttps(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    break;
  }
  if (!res || !res.ok || !res.body) throw new Error(`download failed (HTTP ${res?.status ?? "?"})`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error(`file is larger than ${Math.round(maxBytes / 1e6)} MB`);
  const dir = await mkdtemp(join(tmpdir(), "gbb-"));
  const safeName = (filename ?? basename(url.pathname) ?? "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "file";
  const path = join(dir, safeName);
  const out = createWriteStream(path, { mode: 0o600 });
  let bytes = 0;
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new Error(`file is larger than ${Math.round(maxBytes / 1e6)} MB`);
      if (chunks.length < 4) chunks.push(Buffer.from(chunk));
      if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  } catch (e) {
    out.destroy();
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
  return { path, dir, bytes, head: Buffer.concat(chunks).subarray(0, 64) };
}

/** The attachment types Block's buzz tool (0.2.1) will upload, by magic bytes. */
export function attachableType(head: Buffer): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (head.subarray(4, 8).toString("latin1") === "ftyp") return "video/mp4";
  return null;
}
