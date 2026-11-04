// Buzz identities are Nostr keys: a 32-byte secp256k1 secret and the x-only
// public key derived from it. Node's built-in crypto can do the derivation, so
// no extra dependency is needed. bech32 (npub/nsec) is implemented below.

import { createECDH, randomBytes } from "node:crypto";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >>> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function convertBits(data: Uint8Array | number[], from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >>> bits) & maxv);
    }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & maxv);
  else if (!pad && (bits >= from || ((acc << (to - bits)) & maxv))) throw new Error("invalid bech32 padding");
  return out;
}

export function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const data = convertBits(bytes, 8, 5, true);
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >>> (5 * (5 - i))) & 31);
  return hrp + "1" + [...data, ...checksum].map((d) => CHARSET[d]).join("");
}

export function bech32Decode(text: string): { hrp: string; bytes: Uint8Array } {
  const s = text.toLowerCase();
  const pos = s.lastIndexOf("1");
  if (pos < 1 || pos + 7 > s.length) throw new Error("not a bech32 string");
  const hrp = s.slice(0, pos);
  const data: number[] = [];
  for (const c of s.slice(pos + 1)) {
    const d = CHARSET.indexOf(c);
    if (d < 0) throw new Error("invalid bech32 character");
    data.push(d);
  }
  if (polymod([...hrpExpand(hrp), ...data]) !== 1) throw new Error("bad bech32 checksum");
  return { hrp, bytes: Uint8Array.from(convertBits(data.slice(0, -6), 5, 8, false)) };
}

const HEX64 = /^[0-9a-f]{64}$/i;

/** Accepts 64-char hex or an nsec; returns lowercase hex. */
export function secretToHex(secret: string): string {
  const s = secret.trim();
  if (HEX64.test(s)) return s.toLowerCase();
  const { hrp, bytes } = bech32Decode(s);
  if (hrp !== "nsec" || bytes.length !== 32) throw new Error("expected an nsec or 64-char hex secret key");
  return Buffer.from(bytes).toString("hex");
}

/** Accepts 64-char hex or an npub; returns lowercase hex. */
export function pubkeyToHex(pubkey: string): string {
  const s = pubkey.trim();
  if (HEX64.test(s)) return s.toLowerCase();
  const { hrp, bytes } = bech32Decode(s);
  if (hrp !== "npub" || bytes.length !== 32) throw new Error(`not a public key: ${s.slice(0, 12)}…`);
  return Buffer.from(bytes).toString("hex");
}

export function publicKeyFromSecret(secretHex: string): string {
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(Buffer.from(secretHex, "hex"));
  // Compressed point = 1 parity byte + 32-byte x coordinate. Nostr uses x only.
  return ecdh.getPublicKey(undefined, "compressed").subarray(1).toString("hex");
}

export function npub(pubkeyHex: string): string {
  return bech32Encode("npub", Buffer.from(pubkeyHex, "hex"));
}

export function nsec(secretHex: string): string {
  return bech32Encode("nsec", Buffer.from(secretHex, "hex"));
}

export function generateSecret(): string {
  // setPrivateKey rejects zero and values >= the curve order, so retry on the
  // (astronomically rare) invalid draw instead of checking the range by hand.
  for (;;) {
    const candidate = randomBytes(32).toString("hex");
    try {
      publicKeyFromSecret(candidate);
      return candidate;
    } catch {
      /* draw again */
    }
  }
}
