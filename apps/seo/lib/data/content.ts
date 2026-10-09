/**
 * Content items, their versions, comments and review decisions; pipeline runs
 * and steps; publications. Every function takes a Tx from withWorkspace():
 * row-level security scopes it to one workspace and the audit triggers record
 * each write. Status changes go through setStatus(), which applies the status
 * machine (lib/content/status.ts) under a row lock.
 */
import type { Tx } from "../db/tenant.ts";
import { assertTransition, HOLDS_HEAD_TERM, type ContentStatus } from "../content/status.ts";
import type { ExistingTarget } from "../content/headterm.ts";
import type { OwnPage } from "../content/links.ts";
import { pagePath } from "../content/links.ts";
import { localParts } from "../content/schedule.ts";
import { STEP_KEYS, type StepKey } from "../pipeline/steps.ts";

export type ContentItem = {
  id: string;
  workspace_id: string;
  site_id: string;
  slot_at: Date;
  schedule_slot_at: Date | null;
  kind: "new" | "refresh";
  refresh_of: string | null;
  status: ContentStatus;
  status_detail: string | null;
  primary_keyword: string | null;
  head_term: string | null;
  secondary_keywords: string[];
  cluster: string;
  intent: string | null;
  author_id: string | null;
  title: string;
  description: string;
  slug: string | null;
  body_md: string;
  cover: { kind?: string; chips?: string[] } & Record<string, unknown>;
  topic: Record<string, unknown> | null;
  brief: Record<string, unknown> | null;
  sources: { claim: string; url: string; quote?: string }[];
  internal_links: { path: string; anchor?: string; status?: string }[];
  lint: import("../content/lint.ts").LintResult[];
  lint_passed: boolean | null;
  lint_at: Date | null;
  fact_check: FactCheckClaim[];
  fact_check_passed: boolean | null;
  unverifiable_claims: number;
  version: number;
  written_at: Date | null;
  publish_date: string | null;
  published_at: Date | null;
  live_url: string | null;
  current_run_id: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

export type FactCheckClaim = {
  claim: string;
  status: "sourced" | "rewritten" | "removed" | "unverifiable";
  sourceUrl: string | null;
  quote: string | null;
  verified: boolean;
  primary: boolean;
  note: string;
  replacement?: string | null;
};

const ITEM_COLS = `id, workspace_id, site_id, slot_at, schedule_slot_at, kind, refresh_of, status, status_detail, primary_keyword, head_term, secondary_keywords, cluster, intent,
  author_id, title, description, slug, body_md, cover, topic, brief, sources, internal_links, lint, lint_passed, lint_at, fact_check, fact_check_passed,
  unverifiable_claims, version, written_at, to_char(publish_date, 'YYYY-MM-DD') AS publish_date, published_at, live_url, current_run_id, created_by, created_at, updated_at`;

export function getItem(tx: Tx, id: string, opts: { lock?: boolean } = {}): Promise<ContentItem> {
  return tx.one<ContentItem>(`SELECT ${ITEM_COLS} FROM content_items WHERE id = $1${opts.lock ? " FOR UPDATE" : ""}`, [id], "article");
}

export type CalendarItem = Pick<ContentItem, "id" | "site_id" | "slot_at" | "status" | "title" | "primary_keyword" | "kind" | "lint_passed" | "fact_check_passed" | "unverifiable_claims" | "current_run_id" | "status_detail" | "slug" | "publish_date"> & { domain: string; author_name: string | null };

export function listCalendar(tx: Tx, opts: { siteId?: string | null; from: Date; to: Date }): Promise<CalendarItem[]> {
  return tx.many<CalendarItem>(
    `SELECT c.id, c.site_id, c.slot_at, c.status, c.title, c.primary_keyword, c.kind, c.lint_passed, c.fact_check_passed, c.unverifiable_claims,
            c.current_run_id, c.status_detail, c.slug, to_char(c.publish_date, 'YYYY-MM-DD') AS publish_date, s.domain, a.name AS author_name
     FROM content_items c JOIN sites s ON s.id = c.site_id LEFT JOIN authors a ON a.id = c.author_id
     WHERE ($1::uuid IS NULL OR c.site_id = $1) AND c.slot_at >= $2 AND c.slot_at < $3 AND c.status NOT IN ('rejected', 'skipped')
     ORDER BY c.slot_at, s.domain`,
    [opts.siteId ?? null, opts.from, opts.to],
  );
}

export function listReviewQueue(tx: Tx): Promise<(CalendarItem & { version: number; waiting_since: Date })[]> {
  return tx.many(
    `SELECT c.id, c.site_id, c.slot_at, c.status, c.title, c.primary_keyword, c.kind, c.lint_passed, c.fact_check_passed, c.unverifiable_claims,
            c.current_run_id, c.status_detail, c.slug, to_char(c.publish_date, 'YYYY-MM-DD') AS publish_date, s.domain, a.name AS author_name, c.version, c.updated_at AS waiting_since
     FROM content_items c JOIN sites s ON s.id = c.site_id LEFT JOIN authors a ON a.id = c.author_id
     WHERE c.status IN ('awaiting_review', 'changes_requested')
     ORDER BY c.slot_at`,
  );
}

export async function createPlanned(tx: Tx, workspaceId: string, siteId: string, slotAt: Date, scheduleSlotAt: Date | null, createdBy: string): Promise<string | null> {
  const r = await tx.maybe<{ id: string }>(
    `INSERT INTO content_items (workspace_id, site_id, slot_at, schedule_slot_at, created_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (site_id, schedule_slot_at) WHERE schedule_slot_at IS NOT NULL AND status <> 'rejected' DO NOTHING RETURNING id`,
    [workspaceId, siteId, slotAt, scheduleSlotAt, createdBy],
  );
  return r?.id ?? null;
}

/** Moves an item through the status machine; throws TransitionError on an illegal move. Returns the previous status. */
export async function setStatus(tx: Tx, id: string, to: ContentStatus, detail: string | null = null, extra: Record<string, unknown> = {}): Promise<ContentStatus> {
  const cur = await tx.one<{ status: ContentStatus }>("SELECT status FROM content_items WHERE id = $1 FOR UPDATE", [id], "article");
  assertTransition(cur.status, to);
  const keys = Object.keys(extra);
  await tx.exec(
    `UPDATE content_items SET status = $2, status_detail = $3${keys.map((k, i) => `, ${k} = $${i + 4}`).join("")} WHERE id = $1`,
    [id, to, detail?.slice(0, 500) ?? null, ...keys.map((k) => extra[k])],
  );
  return cur.status;
}

export async function reschedule(tx: Tx, id: string, slotAt: Date): Promise<void> {
  await tx.exec("UPDATE content_items SET slot_at = $2 WHERE id = $1", [id, slotAt]);
}

/** Saves the article's text as a new version (append-only history) and makes it current. */
export async function saveVersion(
  tx: Tx,
  workspaceId: string,
  itemId: string,
  v: { title: string; description: string; bodyMd: string; cover: Record<string, unknown> },
  source: "draft" | "fact_check" | "editor" | "restore",
  actorId: string,
  note: string | null = null,
): Promise<number> {
  const r = await tx.one<{ version: number }>(
    `UPDATE content_items SET version = version + 1, title = $2, description = $3, body_md = $4, cover = $5::jsonb WHERE id = $1 RETURNING version`,
    [itemId, v.title.slice(0, 300), v.description.slice(0, 600), v.bodyMd, JSON.stringify(v.cover)],
    "article",
  );
  await tx.exec(
    `INSERT INTO content_versions (workspace_id, item_id, version, title, description, body_md, cover, source, note, actor_id) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
    [workspaceId, itemId, r.version, v.title.slice(0, 300), v.description.slice(0, 600), v.bodyMd, JSON.stringify(v.cover), source, note?.slice(0, 500) ?? null, actorId],
  );
  return r.version;
}

export type VersionRow = { version: number; title: string; description: string; body_md: string; cover: Record<string, unknown>; source: string; note: string | null; actor_id: string; actor_email: string | null; created_at: Date };

export function listVersions(tx: Tx, itemId: string): Promise<VersionRow[]> {
  return tx.many<VersionRow>(
    `SELECT v.version, v.title, v.description, v.body_md, v.cover, v.source, v.note, v.actor_id, u.email AS actor_email, v.created_at
     FROM content_versions v LEFT JOIN auth_user u ON u.id::text = v.actor_id WHERE v.item_id = $1 ORDER BY v.version DESC`,
    [itemId],
  );
}

export type CommentRow = { id: string; user_id: string; name: string; email: string; body: string; version: number; resolved_at: Date | null; created_at: Date };

export function listComments(tx: Tx, itemId: string): Promise<CommentRow[]> {
  return tx.many<CommentRow>(
    `SELECT c.id, c.user_id, u.name, u.email, c.body, c.version, c.resolved_at, c.created_at
     FROM content_comments c JOIN auth_user u ON u.id = c.user_id WHERE c.item_id = $1 ORDER BY c.created_at`,
    [itemId],
  );
}

export async function addComment(tx: Tx, workspaceId: string, itemId: string, userId: string, body: string, version: number): Promise<void> {
  await tx.exec("INSERT INTO content_comments (workspace_id, item_id, user_id, body, version) VALUES ($1, $2, $3, $4, $5)", [workspaceId, itemId, userId, body.slice(0, 4000), version]);
}

export type ReviewRow = { id: string; version: number; decision: string; note: string; reviewer_id: string; reviewer_role: string | null; reviewer_email: string | null; created_at: Date };

export function listReviews(tx: Tx, itemId: string): Promise<ReviewRow[]> {
  return tx.many<ReviewRow>(
    `SELECT r.id, r.version, r.decision, r.note, r.reviewer_id, r.reviewer_role, u.email AS reviewer_email, r.created_at
     FROM content_reviews r LEFT JOIN auth_user u ON u.id::text = r.reviewer_id WHERE r.item_id = $1 ORDER BY r.created_at DESC`,
    [itemId],
  );
}

export async function addReview(tx: Tx, workspaceId: string, itemId: string, version: number, decision: "approved" | "rejected" | "changes_requested" | "autopilot", note: string, reviewerId: string, role: string): Promise<void> {
  await tx.exec(
    "INSERT INTO content_reviews (workspace_id, item_id, version, decision, note, reviewer_id, reviewer_role) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [workspaceId, itemId, version, decision, note.slice(0, 4000), reviewerId, role],
  );
}

// ---------------------------------------------------------------------------
// Rule 5 inputs, rule 9 inputs, topic supply
// ---------------------------------------------------------------------------

/** Published and scheduled primary keywords, plus the keywords the site's pages already target or rank for. */
export async function existingTargets(tx: Tx, siteId: string, excludeItemId?: string | null): Promise<ExistingTarget[]> {
  const items = await tx.many<{ id: string; primary_keyword: string; status: string; title: string; slug: string | null }>(
    `SELECT id, primary_keyword, status, title, slug FROM content_items
     WHERE site_id = $1 AND primary_keyword IS NOT NULL AND status = ANY($2) AND ($3::uuid IS NULL OR id <> $3)`,
    [siteId, HOLDS_HEAD_TERM as unknown as string[], excludeItemId ?? null],
  );
  const kws = await tx.many<{ keyword: string; status: string }>("SELECT keyword, status FROM keywords WHERE site_id = $1 AND status IN ('published', 'ranking')", [siteId]);
  const ranked = await tx.maybe<{ result: { keyword: string; url: string; position: number }[] }>(
    "SELECT result FROM research_log WHERE site_id = $1 AND operation = 'rankedKeywords' AND status IN ('ok', 'cached') ORDER BY created_at DESC LIMIT 1",
    [siteId],
  );
  return [
    ...items.map((i) => ({ keyword: i.primary_keyword, source: (i.status === "published" ? "published" : "scheduled") as ExistingTarget["source"], ref: `“${i.title || i.primary_keyword}”`, itemId: i.id })),
    ...kws.map((k) => ({ keyword: k.keyword, source: (k.status === "published" ? "published" : "ranked") as ExistingTarget["source"], ref: k.status === "published" ? "an existing page (keyword marked published)" : "an existing page" })),
    ...(Array.isArray(ranked?.result) ? ranked!.result.filter((r) => r && typeof r.keyword === "string" && r.position <= 20).map((r) => ({ keyword: r.keyword, source: "ranked" as const, ref: r.url })) : []),
  ];
}

/** Our own articles as pages of the site (for rule 9), with their publish dates. */
export async function ownPages(tx: Tx, siteId: string, livePathPattern: string, excludeItemId?: string | null): Promise<OwnPage[]> {
  const rows = await tx.many<{ id: string; slug: string; title: string; status: string; publish_date: string | null; slot_at: Date; timezone: string }>(
    `SELECT c.id, c.slug, c.title, c.status, to_char(c.publish_date, 'YYYY-MM-DD') AS publish_date, c.slot_at, s.timezone
     FROM content_items c JOIN sites s ON s.id = c.site_id
     WHERE c.site_id = $1 AND c.slug IS NOT NULL AND c.status NOT IN ('rejected', 'skipped', 'unpublished', 'failed', 'planned') AND ($2::uuid IS NULL OR c.id <> $2)`,
    [siteId, excludeItemId ?? null],
  );
  return rows.map((r) => ({ path: pagePath(livePathPattern, r.slug), title: r.title, status: r.status, itemId: r.id, publishDate: r.publish_date ?? localParts(r.slot_at, r.timezone).date }));
}

/** Topics the pipeline can still pick: queued seeds, plus saved keyword ideas that fit. */
export async function topicSupply(tx: Tx, siteId: string): Promise<{ seeds: number; ideas: number }> {
  const r = await tx.one<{ seeds: number; ideas: number }>(
    `SELECT (SELECT count(*)::int FROM seed_backlog WHERE site_id = $1 AND status = 'queued') AS seeds,
            (SELECT count(DISTINCT coalesce(nullif(variant_key, ''), keyword))::int FROM keywords WHERE site_id = $1 AND status = 'idea' AND fit <> 'not_offered') AS ideas`,
    [siteId],
  );
  return r;
}

// ---------------------------------------------------------------------------
// Pipeline runs and steps
// ---------------------------------------------------------------------------
export type RunRow = {
  id: string;
  site_id: string;
  item_id: string;
  trigger: string;
  status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "canceled";
  current_step: StepKey | null;
  created_by: string;
  cost_micros: string;
  tokens: number;
  error: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type StepRow = {
  id: string;
  step: StepKey;
  position: number;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "waiting";
  attempt: number;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_micros: string;
  duration_ms: number | null;
  error: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  updated_at: Date;
};

export async function createRun(tx: Tx, workspaceId: string, siteId: string, itemId: string, trigger: "schedule" | "manual" | "retry" | "batch", createdBy: string): Promise<string> {
  const run = await tx.one<{ id: string }>(
    "INSERT INTO pipeline_runs (workspace_id, site_id, item_id, trigger, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [workspaceId, siteId, itemId, trigger, createdBy],
  );
  await tx.exec(
    `INSERT INTO pipeline_steps (workspace_id, run_id, step, position) SELECT $1, $2, s, p FROM unnest($3::text[]) WITH ORDINALITY AS t(s, p)`,
    [workspaceId, run.id, STEP_KEYS as unknown as string[]],
  );
  await tx.exec("UPDATE content_items SET current_run_id = $2 WHERE id = $1", [itemId, run.id]);
  return run.id;
}

export function getRun(tx: Tx, runId: string): Promise<RunRow> {
  return tx.one<RunRow>("SELECT id, site_id, item_id, trigger, status, current_step, created_by, cost_micros::text, tokens, error, started_at, finished_at, created_at, updated_at FROM pipeline_runs WHERE id = $1", [runId], "run");
}

export function listSteps(tx: Tx, runId: string): Promise<StepRow[]> {
  return tx.many<StepRow>(
    `SELECT id, step, position, status, attempt, input, output, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micros::text,
            duration_ms, error, started_at, finished_at, updated_at FROM pipeline_steps WHERE run_id = $1 ORDER BY position`,
    [runId],
  );
}

export function listRuns(tx: Tx, opts: { siteId?: string | null; itemId?: string | null; limit?: number } = {}): Promise<(RunRow & { title: string; primary_keyword: string | null; domain: string; slot_at: Date })[]> {
  return tx.many(
    `SELECT r.id, r.site_id, r.item_id, r.trigger, r.status, r.current_step, r.created_by, r.cost_micros::text, r.tokens, r.error, r.started_at, r.finished_at, r.created_at, r.updated_at,
            c.title, c.primary_keyword, s.domain, c.slot_at
     FROM pipeline_runs r JOIN content_items c ON c.id = r.item_id JOIN sites s ON s.id = r.site_id
     WHERE ($1::uuid IS NULL OR r.site_id = $1) AND ($2::uuid IS NULL OR r.item_id = $2)
     ORDER BY r.created_at DESC LIMIT $3`,
    [opts.siteId ?? null, opts.itemId ?? null, Math.min(opts.limit ?? 50, 200)],
  );
}

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------
export type PublicationRow = {
  id: string;
  item_id: string;
  connection_id: string | null;
  publisher: "github" | "gitea" | "webhook";
  mode: "pr" | "commit" | "webhook";
  action: "publish" | "update" | "unpublish";
  status: "pending" | "open" | "merged" | "closed" | "published" | "failed" | "unpublished";
  remote_id: string | null;
  path: string | null;
  branch: string | null;
  commit_sha: string | null;
  pr_number: number | null;
  pr_url: string | null;
  live_url: string | null;
  live_status: number | null;
  live_checked_at: Date | null;
  indexing: Record<string, unknown> | null;
  error: string | null;
  created_at: Date;
};

export function listPublications(tx: Tx, itemId: string): Promise<PublicationRow[]> {
  return tx.many<PublicationRow>("SELECT * FROM publications WHERE item_id = $1 ORDER BY created_at DESC", [itemId]);
}

export const isStepKey = (s: unknown): s is StepKey => typeof s === "string" && (STEP_KEYS as readonly string[]).includes(s);
