/**
 * Per-site external connections. Credentials are sealed with AES-256-GCM
 * (lib/crypto/secrets.ts) bound to the workspace and row id, stored with their
 * key version, and NEVER selected back out by anything that renders: the list
 * query returns only whether a secret exists and its key version.
 * Live "test" buttons arrive with each connector's phase.
 */
import { randomUUID } from "node:crypto";
import type { Tx } from "../db/tenant.ts";
import { connectionAad, decryptSecret, encryptSecret, reencrypt, type Keyring } from "../crypto/secrets.ts";
import type * as z from "zod";
import { connectionInput, type ConnectionInput } from "../validation.ts";
import { DEFAULT_TEMPLATE } from "../publishers/frontmatter.ts";

export type ConnectionKind = "git" | "wordpress" | "webflow" | "ghost" | "webhook" | "search_console" | "ga4" | "social";

export type ConnectionView = {
  id: string;
  site_id: string;
  kind: ConnectionKind;
  label: string;
  config: Record<string, string>;
  has_secret: boolean;
  key_version: number | null;
  status: "untested" | "ok" | "warn" | "error";
  status_detail: string | null;
  last_tested_at: Date | null;
  created_at: Date;
};

const VIEW_COLS = "id, site_id, kind, label, config, credentials_ciphertext IS NOT NULL AS has_secret, key_version, status, status_detail, last_tested_at, created_at";

export function listConnections(tx: Tx, siteId: string): Promise<ConnectionView[]> {
  return tx.many<ConnectionView>(`SELECT ${VIEW_COLS} FROM connections WHERE site_id = $1 ORDER BY created_at`, [siteId]);
}

/** Non-secret settings per kind; the secret goes in its own sealed column. */
function split(input: ConnectionInput): { config: Record<string, string>; secret: string } {
  switch (input.kind) {
    case "git":
      return {
        config: {
          provider: input.provider,
          repository: input.repository,
          apiBaseUrl: input.apiBaseUrl,
          branch: input.branch,
          contentDir: input.contentDir,
          filenamePattern: input.filenamePattern,
          frontmatterTemplate: input.frontmatterTemplate || DEFAULT_TEMPLATE,
          mode: input.mode,
          livePath: input.livePath,
        },
        secret: input.secret,
      };
    case "wordpress":
      return { config: { siteUrl: input.siteUrl, username: input.username }, secret: input.secret };
    case "webhook":
      return { config: { endpoint: input.endpoint, livePath: input.livePath }, secret: input.secret };
  }
}

/** What createConnection accepts: the form's input, defaults not yet applied (they are, here). */
export type ConnectionCreate = z.input<typeof connectionInput>;

export async function createConnection(tx: Tx, ring: Keyring, workspaceId: string, siteId: string, raw: ConnectionCreate): Promise<ConnectionView> {
  const input = connectionInput.parse(raw);
  const id = randomUUID();
  const { config, secret } = split(input);
  const sealed = encryptSecret(secret, connectionAad(workspaceId, id), ring);
  return tx.one<ConnectionView>(
    `INSERT INTO connections (id, workspace_id, site_id, kind, label, config, credentials_ciphertext, key_version, status_detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
     RETURNING ${VIEW_COLS}`,
    [id, workspaceId, siteId, input.kind, input.label, JSON.stringify(config), sealed.ciphertext, sealed.keyVersion, input.kind === "wordpress" ? "Saved. The WordPress publisher arrives in Phase 5." : "Saved. Run the test to check it."],
  );
}

export async function deleteConnection(tx: Tx, id: string): Promise<void> {
  if (!(await tx.exec("DELETE FROM connections WHERE id = $1", [id]))) throw new Error("connection not found");
}

/** Server-side only (publishers, Phase 3+): the decrypted secret. Never return this to a client. */
export async function readConnectionSecret(tx: Tx, ring: Keyring, workspaceId: string, id: string): Promise<string | null> {
  const row = await tx.one<{ c: string | null }>("SELECT credentials_ciphertext AS c FROM connections WHERE id = $1", [id], "connection");
  return row.c ? decryptSecret(row.c, connectionAad(workspaceId, id), ring) : null;
}

/** Re-seals every secret in this workspace under the current key. Returns how many changed. */
export async function rotateConnectionKeys(tx: Tx, ring: Keyring, workspaceId: string): Promise<number> {
  const rows = await tx.many<{ id: string; c: string }>("SELECT id, credentials_ciphertext AS c FROM connections WHERE credentials_ciphertext IS NOT NULL FOR UPDATE");
  let n = 0;
  for (const r of rows) {
    const next = reencrypt(r.c, connectionAad(workspaceId, r.id), ring);
    if (!next) continue;
    await tx.exec("UPDATE connections SET credentials_ciphertext = $2, key_version = $3 WHERE id = $1", [r.id, next.ciphertext, next.keyVersion]);
    n++;
  }
  return n;
}

export async function setConnectionStatus(tx: Tx, id: string, status: ConnectionView["status"], detail: string, at = new Date()): Promise<void> {
  await tx.exec("UPDATE connections SET status = $2, status_detail = $3, last_tested_at = $4 WHERE id = $1", [id, status, detail.slice(0, 500), at]);
}
