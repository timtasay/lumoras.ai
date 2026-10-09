/**
 * The one place a site's publishing connection becomes a Publisher. The
 * decrypted credential is read here, server-side, inside the workspace's own
 * transaction, handed to the publisher and never returned, logged or shown.
 *
 * Adding a publisher: implement Publisher (lib/publishers/types.ts), add its
 * connection kind and form fields (lib/validation.ts connectionInput), and a
 * case below. Test it against a local fake of the remote API
 * (test/helpers/fake-*.ts).
 */
import type { Tx } from "../db/tenant.ts";
import { readConnectionSecret } from "../data/connections.ts";
import type { Keyring } from "../crypto/secrets.ts";
import type { SafeFetchPolicy } from "../net/safe-fetch.ts";
import { GitPublisher, readGitConfig } from "./git.ts";
import { WebhookPublisher } from "./webhook.ts";
import { PublishError, type Publisher } from "./types.ts";

export type PublishConnection = { id: string; kind: string; label: string; config: Record<string, unknown>; status: string };

export const PUBLISHING_KINDS = ["git", "webhook"] as const;

/** The path an article has on the live site, from the connection's live-path pattern. */
export function livePathPattern(conn: Pick<PublishConnection, "kind" | "config"> | null): string {
  const p = conn?.config.livePath;
  return typeof p === "string" && p.startsWith("/") ? p : "/blog/{{slug}}";
}

export function describeConnection(conn: Pick<PublishConnection, "kind" | "config">): string {
  if (conn.kind === "git") {
    const g = readGitConfig(conn.config);
    return `${g.provider === "github" ? "GitHub" : "Gitea"} · ${g.mode === "pr" ? "opens a pull request" : "commits"} on ${g.branch} · ${g.contentDir}/${g.filenamePattern}`;
  }
  if (conn.kind === "webhook") return `Signed webhook to ${String(conn.config.endpoint ?? "")}`;
  return conn.kind;
}

export async function loadPublishConnection(tx: Tx, connectionId: string): Promise<PublishConnection> {
  const c = await tx.one<PublishConnection>("SELECT id, kind, label, config, status FROM connections WHERE id = $1", [connectionId], "connection");
  if (!(PUBLISHING_KINDS as readonly string[]).includes(c.kind)) throw new PublishError(`${c.label} is not a publishing connection.`);
  return c;
}

export type PublisherFactory = (conn: PublishConnection, secret: string, site: { domain: string }, policy: SafeFetchPolicy) => Publisher;

export const createPublisher: PublisherFactory = (conn, secret, site, policy) => {
  switch (conn.kind) {
    case "git":
      return new GitPublisher(readGitConfig(conn.config), secret, { policy });
    case "webhook":
      return new WebhookPublisher({ endpoint: String(conn.config.endpoint ?? "") }, secret, site, { policy });
    default:
      throw new PublishError(`No publisher for ${conn.kind} yet.`);
  }
};

/** Reads the sealed credential for a publishing connection (server-side only). */
export async function publisherFor(tx: Tx, ring: Keyring, workspaceId: string, connectionId: string, site: { domain: string }, policy: SafeFetchPolicy, factory: PublisherFactory = createPublisher): Promise<{ conn: PublishConnection; publisher: Publisher }> {
  const conn = await loadPublishConnection(tx, connectionId);
  const secret = await readConnectionSecret(tx, ring, workspaceId, connectionId);
  if (!secret) throw new PublishError(`${conn.label} has no stored credential.`);
  return { conn, publisher: factory(conn, secret, site, policy) };
}
