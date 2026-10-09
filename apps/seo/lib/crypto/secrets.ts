/**
 * Secrets at rest: AES-256-GCM with versioned keys.
 *
 * Keys come from the environment, never the database:
 *   ENCRYPTION_KEYS="1:<base64 32 bytes>,2:<base64 32 bytes>"   every key still needed to decrypt
 *   ENCRYPTION_KEY_CURRENT=2                                    the version new secrets use
 * or, for a single key, ENCRYPTION_KEY=<base64 32 bytes> (version 1).
 *
 * Ciphertext format (one string column, plus key_version beside it):
 *   v<version>.<iv base64url>.<tag base64url>.<ciphertext base64url>
 * A fresh 96-bit IV per message. The additional authenticated data (AAD)
 * binds the ciphertext to where it is stored (e.g. "connections:<workspace>:<id>"),
 * so a ciphertext copied to another row or workspace fails to decrypt.
 *
 * Rotation: add a new version to ENCRYPTION_KEYS, point ENCRYPTION_KEY_CURRENT
 * at it, deploy, then re-encrypt rows (reencrypt()) and finally drop the old key.
 * Plaintext never goes to the browser, the logs, the audit log or an LLM.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class SecretsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsConfigError";
  }
}

/** Decryption failed: wrong key, wrong AAD, or the stored value was altered. */
export class SecretDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretDecryptError";
  }
}

export type Keyring = { current: number; keys: Map<number, Buffer> };

const FORMAT = /^v([1-9]\d{0,5})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]*)$/;

function decodeKey(v: string, label: string): Buffer {
  const b = Buffer.from(v.trim(), "base64");
  if (b.length !== 32) throw new SecretsConfigError(`${label} must be 32 bytes, base64-encoded (got ${b.length} bytes); create one with \`openssl rand -base64 32\``);
  return b;
}

/** Reads the keyring from the environment. Throws SecretsConfigError naming what is wrong. */
export function readKeyring(env: Record<string, string | undefined> = process.env): Keyring {
  const many = env.ENCRYPTION_KEYS?.trim();
  const single = env.ENCRYPTION_KEY?.trim();
  if (many && single) throw new SecretsConfigError("Set ENCRYPTION_KEYS (versioned) or ENCRYPTION_KEY (single), not both");
  const keys = new Map<number, Buffer>();
  if (many) {
    for (const part of many.split(",")) {
      const m = /^\s*([1-9]\d{0,5})\s*:\s*(\S+)\s*$/.exec(part);
      if (!m) throw new SecretsConfigError(`ENCRYPTION_KEYS entry must be <version>:<base64 key> (got "${part.slice(0, 6)}…")`);
      const ver = Number(m[1]);
      if (keys.has(ver)) throw new SecretsConfigError(`ENCRYPTION_KEYS lists version ${ver} twice`);
      keys.set(ver, decodeKey(m[2], `ENCRYPTION_KEYS version ${ver}`));
    }
    const cur = env.ENCRYPTION_KEY_CURRENT?.trim();
    const current = cur ? Number(cur) : Math.max(...keys.keys());
    if (!keys.has(current)) throw new SecretsConfigError(`ENCRYPTION_KEY_CURRENT=${cur} is not in ENCRYPTION_KEYS`);
    return { current, keys };
  }
  if (single) {
    keys.set(1, decodeKey(single, "ENCRYPTION_KEY"));
    return { current: 1, keys };
  }
  throw new SecretsConfigError("ENCRYPTION_KEYS (or ENCRYPTION_KEY) is not set: stored credentials cannot be encrypted");
}

export type Sealed = { ciphertext: string; keyVersion: number };

export function encryptSecret(plaintext: string, aad: string, ring: Keyring): Sealed {
  const key = ring.keys.get(ring.current);
  if (!key) throw new SecretsConfigError(`current key version ${ring.current} is missing`);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return {
    ciphertext: `v${ring.current}.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`,
    keyVersion: ring.current,
  };
}

export function decryptSecret(sealed: string, aad: string, ring: Keyring): string {
  const m = FORMAT.exec(sealed);
  if (!m) throw new SecretDecryptError("stored secret is not in the v<n>.<iv>.<tag>.<data> format");
  const ver = Number(m[1]);
  const key = ring.keys.get(ver);
  if (!key) throw new SecretDecryptError(`stored secret uses key version ${ver}, which is not in ENCRYPTION_KEYS`);
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(m[2], "base64url"));
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(Buffer.from(m[3], "base64url"));
  try {
    return Buffer.concat([d.update(Buffer.from(m[4], "base64url")), d.final()]).toString("utf8");
  } catch {
    throw new SecretDecryptError("stored secret failed authentication (wrong key, wrong context, or it was altered)");
  }
}

/** Key version a stored value was sealed with (without decrypting). */
export function keyVersionOf(sealed: string): number | null {
  const m = FORMAT.exec(sealed);
  return m ? Number(m[1]) : null;
}

/** Re-seals under the current key when needed (rotation). Returns null when already current. */
export function reencrypt(sealed: string, aad: string, ring: Keyring): Sealed | null {
  if (keyVersionOf(sealed) === ring.current) return null;
  return encryptSecret(decryptSecret(sealed, aad, ring), aad, ring);
}

/** AAD for a connection's credentials: binds them to the workspace and row. */
export const connectionAad = (workspaceId: string, connectionId: string) => `connections:${workspaceId}:${connectionId}`;
