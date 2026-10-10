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
import { GitPublisher, parseRepository, readGitConfig } from "./git.ts";
import { WebhookPublisher } from "./webhook.ts";
import { PublishError, type Publisher, type Validation } from "./types.ts";

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

/**
 * How to create the token a Git connection needs: a fine-grained token limited
 * to this one repository, with Contents and Pull requests read and write.
 */
export function tokenInstructions(conn: Pick<PublishConnection, "kind" | "config">): string[] {
  if (conn.kind === "webhook") return ["Paste the signing secret your endpoint verifies (at least 16 characters)."];
  const g = readGitConfig(conn.config);
  let repo = "the repository";
  try {
    const r = parseRepository(g.repository);
    repo = `${r.owner}/${r.repo}`;
  } catch {
    // keep the generic wording
  }
  if (g.provider === "gitea")
    return [`In Gitea: Settings → Applications → Generate new token, with repository read and write access, for an account that can open pull requests on ${repo}.`, "Paste it here. It is encrypted before it is stored and never shown again."];
  return [
    "On GitHub: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.",
    `Repository access: Only select repositories → ${repo} (nothing else).`,
    "Repository permissions: Contents → Read and write; Pull requests → Read and write (Metadata read-only is added automatically).",
    `Generate it, then paste it here. It is encrypted before it is stored and never shown again. ${g.mode === "pr" ? `Pull requests target ${g.branch}.` : `Commits land on ${g.branch}.`}`,
  ];
}

/** The Test button's answer for a connection that has no credential yet: what is set, what is missing. Calls nothing. */
export function missingCredentialValidation(conn: Pick<PublishConnection, "kind" | "config" | "label">): Validation {
  if (conn.kind !== "git") return { ok: false, detail: `${conn.label} has no signing secret yet. Add it, then test again.`, checks: [{ label: "Signing secret", ok: false, detail: "Not stored yet." }] };
  const g = readGitConfig(conn.config);
  const checks = [
    { label: "Repository", ok: true, detail: `${g.repository} (${g.provider === "github" ? "GitHub" : "Gitea"})` },
    { label: "Base branch", ok: true, detail: `${g.branch}: ${g.mode === "pr" ? "pull requests target it" : "commits land on it"}` },
    { label: "Folder and file", ok: true, detail: `${g.contentDir}/${g.filenamePattern}` },
    { label: "Access token", ok: false, detail: `Not stored yet, so nothing can be read or published. ${tokenInstructions(conn).slice(0, 3).join(" ")}` },
  ];
  return { ok: false, detail: `Token needed: ${conn.label} has no access token yet, so the repository was not contacted. Add the token, then test again.`, checks };
}

/** Reads the sealed credential for a publishing connection (server-side only). */
export async function publisherFor(tx: Tx, ring: Keyring, workspaceId: string, connectionId: string, site: { domain: string }, policy: SafeFetchPolicy, factory: PublisherFactory = createPublisher): Promise<{ conn: PublishConnection; publisher: Publisher }> {
  const conn = await loadPublishConnection(tx, connectionId);
  const secret = await readConnectionSecret(tx, ring, workspaceId, connectionId);
  if (!secret) throw new PublishError(`Token needed: ${conn.label} has no access token yet. Add it on the site's Connections tab.`);
  return { conn, publisher: factory(conn, secret, site, policy) };
}
