/** AES-256-GCM secrets: round trip, tamper detection, context binding, key rotation, config errors. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  connectionAad,
  decryptSecret,
  encryptSecret,
  keyVersionOf,
  readKeyring,
  reencrypt,
  SecretDecryptError,
  SecretsConfigError,
} from "../../lib/crypto/secrets.ts";

const k = () => randomBytes(32).toString("base64");
const K1 = k(), K2 = k();
const ring1 = readKeyring({ ENCRYPTION_KEY: K1 });
const ring12 = readKeyring({ ENCRYPTION_KEYS: `1:${K1},2:${K2}`, ENCRYPTION_KEY_CURRENT: "2" });
const AAD = connectionAad("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222");

/** Flips one bit of one base64url part of a sealed value. */
function flip(sealed: string, part: 1 | 2 | 3): string {
  const parts = sealed.split(".");
  const b = Buffer.from(parts[part], "base64url");
  b[0] ^= 1;
  parts[part] = b.toString("base64url");
  return parts.join(".");
}

describe("encryptSecret / decryptSecret", () => {
  it("round-trips, with a fresh IV every time and the key version in front", () => {
    const a = encryptSecret("ghp_secret-token", AAD, ring1);
    const b = encryptSecret("ghp_secret-token", AAD, ring1);
    assert.notEqual(a.ciphertext, b.ciphertext);
    assert.equal(a.keyVersion, 1);
    assert.match(a.ciphertext, /^v1\./);
    assert.ok(!a.ciphertext.includes("ghp_secret"));
    assert.equal(decryptSecret(a.ciphertext, AAD, ring1), "ghp_secret-token");
    assert.equal(decryptSecret(encryptSecret("", AAD, ring1).ciphertext, AAD, ring1), "");
    assert.equal(decryptSecret(encryptSecret("ünïcødé ✓", AAD, ring1).ciphertext, AAD, ring1), "ünïcødé ✓");
  });

  it("detects tampering with the ciphertext, the tag or the IV", () => {
    const s = encryptSecret("app-password", AAD, ring1).ciphertext;
    for (const [part, name] of [[3, "ciphertext"], [2, "auth tag"], [1, "IV"]] as const) {
      assert.throws(() => decryptSecret(flip(s, part), AAD, ring1), SecretDecryptError, `a flipped bit in the ${name} was not detected`);
    }
    assert.throws(() => decryptSecret(s.slice(0, -2), AAD, ring1), SecretDecryptError, "a truncated ciphertext was accepted");
    assert.throws(() => decryptSecret("not-a-secret", AAD, ring1), /format/);
  });

  it("binds the secret to its row: another workspace or connection cannot decrypt it", () => {
    const s = encryptSecret("token", AAD, ring1).ciphertext;
    assert.throws(() => decryptSecret(s, connectionAad("33333333-3333-3333-3333-333333333333", "22222222-2222-2222-2222-222222222222"), ring1), SecretDecryptError);
    assert.throws(() => decryptSecret(s, connectionAad("11111111-1111-1111-1111-111111111111", "44444444-4444-4444-4444-444444444444"), ring1), SecretDecryptError);
  });

  it("fails on the wrong key", () => {
    const s = encryptSecret("token", AAD, ring1).ciphertext;
    assert.throws(() => decryptSecret(s, AAD, readKeyring({ ENCRYPTION_KEY: K2 })), SecretDecryptError);
  });
});

describe("rotation", () => {
  it("decrypts old versions, encrypts with the current one, and re-seals on demand", () => {
    const old = encryptSecret("rotate-me", AAD, ring1);
    assert.equal(decryptSecret(old.ciphertext, AAD, ring12), "rotate-me");
    const fresh = encryptSecret("new", AAD, ring12);
    assert.equal(fresh.keyVersion, 2);
    const re = reencrypt(old.ciphertext, AAD, ring12);
    assert.ok(re);
    assert.equal(re.keyVersion, 2);
    assert.equal(keyVersionOf(re.ciphertext), 2);
    assert.equal(decryptSecret(re.ciphertext, AAD, readKeyring({ ENCRYPTION_KEYS: `2:${K2}` })), "rotate-me", "after re-sealing, the old key can be dropped");
    assert.equal(reencrypt(re.ciphertext, AAD, ring12), null, "already current");
  });

  it("names the missing key version once an old key is dropped too early", () => {
    const old = encryptSecret("x", AAD, ring1).ciphertext;
    assert.throws(() => decryptSecret(old, AAD, readKeyring({ ENCRYPTION_KEYS: `2:${K2}` })), /key version 1, which is not in ENCRYPTION_KEYS/);
  });
});

describe("readKeyring", () => {
  it("rejects missing, short, duplicate and inconsistent configuration", () => {
    assert.throws(() => readKeyring({}), SecretsConfigError);
    assert.throws(() => readKeyring({ ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }), /32 bytes/);
    assert.throws(() => readKeyring({ ENCRYPTION_KEYS: `1:${K1},1:${K2}` }), /twice/);
    assert.throws(() => readKeyring({ ENCRYPTION_KEYS: `1:${K1}`, ENCRYPTION_KEY_CURRENT: "3" }), /not in ENCRYPTION_KEYS/);
    assert.throws(() => readKeyring({ ENCRYPTION_KEYS: `1:${K1}`, ENCRYPTION_KEY: K2 }), /not both/);
    assert.throws(() => readKeyring({ ENCRYPTION_KEYS: "garbage" }), /version>:<base64/);
  });
  it("defaults the current version to the highest one", () => {
    assert.equal(readKeyring({ ENCRYPTION_KEYS: `1:${K1}, 3:${K2}` }).current, 3);
  });
});
