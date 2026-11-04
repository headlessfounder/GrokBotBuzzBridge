import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSecret, npub, nsec, pubkeyToHex, publicKeyFromSecret, secretToHex } from "../../src/identity.ts";
import { attachableType } from "../../src/net.ts";

// Published test vectors from the Nostr NIP-19 and NIP-06 specs. Not real keys.
// gitleaks:allow
test("NIP-19 vectors", () => {
  assert.equal(nsec("67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa"), "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5");
  assert.equal(npub("7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e"), "npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg");
  assert.equal(pubkeyToHex("npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg"), "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e");
  assert.equal(secretToHex("nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5"), "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa");
});

test("NIP-06 key pair: public key derivation", () => {
  assert.equal(publicKeyFromSecret("7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a"), "17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917");
});

test("generated secrets round-trip", () => {
  const s = generateSecret();
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.equal(secretToHex(nsec(s)), s);
  const p = publicKeyFromSecret(s);
  assert.equal(pubkeyToHex(npub(p)), p);
});

test("rejects the wrong kind of key", () => {
  assert.throws(() => pubkeyToHex("nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5"));
  assert.throws(() => pubkeyToHex("npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptX"));
});

test("only the file types Buzz's tool can upload are attachable", () => {
  assert.equal(attachableType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(attachableType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(attachableType(Buffer.from("GIF89a")), "image/gif");
  assert.equal(attachableType(Buffer.from("%PDF-1.7")), null);
  assert.equal(attachableType(Buffer.from("hello")), null);
});
