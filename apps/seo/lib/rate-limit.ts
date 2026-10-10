/**
 * Fixed-window rate limits for expensive or abusable actions, stored in
 * Postgres (app_rate_limits) so they hold across the web and worker containers
 * and across restarts. One atomic upsert per check.
 *
 * Better Auth separately limits its own endpoints per client IP
 * (lib/auth/server.ts); these limits add per-account and per-workspace keys
 * that an attacker cannot rotate by changing IP.
 */
import type pg from "pg";

export type Limit = { name: string; max: number; windowSec: number };

export const LIMITS = {
  /** sign-in links per email address */
  magicLinkPerEmail: { name: "magic-link:email", max: 5, windowSec: 15 * 60 },
  /** crawls per site (each one fetches up to 50 sitemaps from someone's server) */
  crawlPerSite: { name: "crawl:site", max: 6, windowSec: 60 * 60 },
  /** crawls per workspace */
  crawlPerWorkspace: { name: "crawl:workspace", max: 30, windowSec: 60 * 60 },
  /** invitations sent per workspace */
  invitePerWorkspace: { name: "invite:workspace", max: 50, windowSec: 60 * 60 },
  /** workspaces created per user */
  workspacePerUser: { name: "workspace:user", max: 5, windowSec: 24 * 60 * 60 },
  /** impersonations started per platform admin */
  impersonatePerAdmin: { name: "impersonate:admin", max: 30, windowSec: 60 * 60 },
  /** paid research calls (and their quotes) per member: a runaway client or script cannot drain a budget in a burst */
  researchPerUser: { name: "research:user", max: 40, windowSec: 10 * 60 },
  /** paid research calls per workspace */
  researchPerWorkspace: { name: "research:workspace", max: 200, windowSec: 60 * 60 },
  /** Google connect attempts per site */
  googleConnectPerSite: { name: "google-connect:site", max: 10, windowSec: 60 * 60 },
  /** Google live tests and property listings per site */
  googleTestPerSite: { name: "google-test:site", max: 60, windowSec: 60 * 60 },
  /** pipeline runs started or retried by hand, per member (each one spends model budget) */
  pipelinePerUser: { name: "pipeline:user", max: 30, windowSec: 60 * 60 },
  /** publishing-connection tests per site (each one calls the client's Git host or webhook) */
  publishTestPerSite: { name: "publish-test:site", max: 30, windowSec: 60 * 60 },
  /** "Run now" for measurement (paid rank checks, audits, backlinks; Google syncs), per site */
  measurePerSite: { name: "measure:site", max: 12, windowSec: 60 * 60 },
} as const satisfies Record<string, Limit>;

export class RateLimitedError extends Error {
  constructor(
    public readonly limit: Limit,
    public readonly retryAfterSec: number,
  ) {
    super(`Too many requests: try again in ${retryAfterSec < 90 ? `${retryAfterSec} seconds` : `${Math.ceil(retryAfterSec / 60)} minutes`}.`);
    this.name = "RateLimitedError";
  }
}

/** Counts one hit against `limit` for `subject`; throws RateLimitedError when over. */
export async function hit(db: pg.Pool, limit: Limit, subject: string, scale = 1, now = new Date()): Promise<{ count: number; remaining: number }> {
  const max = Math.round(limit.max * scale);
  const windowMs = limit.windowSec * 1000;
  const start = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const key = `${limit.name}:${subject}`;
  const r = await db.query<{ count: number }>(
    `INSERT INTO app_rate_limits (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = app_rate_limits.count + 1
     RETURNING count`,
    [key, start],
  );
  const count = r.rows[0].count;
  // opportunistic cleanup of old windows (cheap, indexed by primary key prefix)
  if (count === 1 && Math.random() < 0.05) {
    db.query("DELETE FROM app_rate_limits WHERE window_start < now() - interval '2 days'").catch(() => {});
  }
  if (count > max) {
    throw new RateLimitedError(limit, Math.max(1, Math.ceil((start.getTime() + windowMs - now.getTime()) / 1000)));
  }
  return { count, remaining: max - count };
}
