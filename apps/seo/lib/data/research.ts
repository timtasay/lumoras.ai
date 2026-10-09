/**
 * Phase 2 repositories: budgets, the usage ledger, the research log, the
 * seed backlog and saved keywords. Every function takes a Tx from
 * withWorkspace(), so row-level security scopes it to one workspace.
 */
import type { Tx } from "../db/tenant.ts";
import { CATEGORIES, type Category } from "../providers/operations.ts";
import type { KeywordRow } from "../providers/types.ts";
import type { Fit } from "../research/offering.ts";

// ---------------------------------------------------------------- budgets
export type BudgetView = { category: Category; ceiling: number; reserve: number; updated_at: Date | null };

export async function listBudgets(tx: Tx): Promise<BudgetView[]> {
  const rows = await tx.many<{ category: Category; ceiling: string; reserve: string; updated_at: Date }>(
    "SELECT category, monthly_ceiling::text AS ceiling, reserve::text AS reserve, updated_at FROM budgets",
  );
  return CATEGORIES.map((c) => {
    const r = rows.find((x) => x.category === c);
    return { category: c, ceiling: Number(r?.ceiling ?? 0), reserve: Number(r?.reserve ?? 0), updated_at: r?.updated_at ?? null };
  });
}

export async function setBudget(tx: Tx, workspaceId: string, category: Category, ceiling: number, reserve: number): Promise<void> {
  await tx.exec(
    `INSERT INTO budgets (workspace_id, category, monthly_ceiling, reserve) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, category) DO UPDATE SET monthly_ceiling = EXCLUDED.monthly_ceiling, reserve = EXCLUDED.reserve`,
    [workspaceId, category, ceiling, reserve],
  );
}

// ---------------------------------------------------------------- usage ledger
export type LedgerRow = {
  id: string;
  created_at: Date;
  site_domain: string | null;
  category: Category;
  operation: string;
  provider: string;
  status: "held" | "settled" | "released";
  cached: boolean;
  units: number;
  estimate_micros: number;
  cost_micros: number;
  actor: string;
  detail: string | null;
};

const LEDGER_SELECT = `
  SELECT l.id::text, l.created_at, s.domain AS site_domain, l.category, l.operation, l.provider, l.status, l.cached,
         l.units::int AS units, l.estimate_micros::float8 AS estimate_micros, l.cost_micros::float8 AS cost_micros,
         coalesce(u.email, l.actor_id) AS actor, l.detail
  FROM usage_ledger l
  LEFT JOIN sites s ON s.id = l.site_id
  LEFT JOIN auth_user u ON u.id::text = l.actor_id`;

export function listLedger(tx: Tx, opts: { period?: string; limit?: number } = {}): Promise<LedgerRow[]> {
  return tx.many<LedgerRow>(`${LEDGER_SELECT} WHERE ($1::date IS NULL OR l.period = $1::date) ORDER BY l.id DESC LIMIT $2`, [opts.period ?? null, Math.min(opts.limit ?? 200, 5000)]);
}

/** Spend per UTC day of a month, for the chart (days with nothing are zero). */
export async function dailySpend(tx: Tx, category: Category, period: string): Promise<{ day: string; micros: number; cached: number }[]> {
  const rows = await tx.many<{ day: string; micros: number; cached: number }>(
    `SELECT d::date::text AS day,
            coalesce(sum(l.cost_micros) FILTER (WHERE l.status IN ('held', 'settled')), 0)::float8 AS micros,
            count(l.id) FILTER (WHERE l.cached)::int AS cached
     FROM generate_series($2::date, ($2::date + interval '1 month' - interval '1 day'), interval '1 day') AS d
     LEFT JOIN usage_ledger l ON l.category = $1 AND l.period = $2::date AND (l.created_at AT TIME ZONE 'UTC')::date = d::date
     GROUP BY d ORDER BY d`,
    [category, period],
  );
  return rows;
}

// ---------------------------------------------------------------- research log
export type LogRow = {
  id: string;
  created_at: Date;
  operation: string;
  provider: string;
  subject: string;
  market: string;
  status: "ok" | "cached" | "refused" | "error";
  estimate_micros: number;
  cost_micros: number;
  result_count: number;
  detail: string | null;
  actor: string;
};

export function listResearchLog(tx: Tx, siteId: string, limit = 200): Promise<LogRow[]> {
  return tx.many<LogRow>(
    `SELECT r.id, r.created_at, r.operation, r.provider, r.subject, r.market, r.status, r.estimate_micros::float8 AS estimate_micros,
            r.cost_micros::float8 AS cost_micros, r.result_count, r.detail, coalesce(u.email, r.actor_id) AS actor
     FROM research_log r LEFT JOIN auth_user u ON u.id::text = r.actor_id
     WHERE r.site_id = $1 ORDER BY r.created_at DESC, r.id LIMIT $2`,
    [siteId, limit],
  );
}

export async function logResult<T = unknown>(tx: Tx, siteId: string, logId: string): Promise<{ result: T; operation: string; created_at: Date; market: string } | null> {
  return tx.maybe(`SELECT result, operation, created_at, market FROM research_log WHERE id = $1 AND site_id = $2 AND status IN ('ok', 'cached')`, [logId, siteId]);
}

/** Rule 4: the newest successful research of this seed for the site and market. */
export function lastSeedResearch(tx: Tx, siteId: string, seed: string, market: string): Promise<{ id: string; created_at: Date } | null> {
  return tx.maybe(
    `SELECT id, created_at FROM research_log
     WHERE site_id = $1 AND operation = 'keywordIdeas' AND seed = $2 AND market = $3 AND status IN ('ok', 'cached')
     ORDER BY created_at DESC LIMIT 1`,
    [siteId, seed, market],
  );
}

/** The newest successful result of an operation for the site (domain overview on the site page). */
export function latestResult<T>(tx: Tx, siteId: string, operation: string, subject: string): Promise<{ id: string; result: T; created_at: Date; cost_micros: number } | null> {
  return tx.maybe(
    `SELECT id, result, created_at, cost_micros::float8 AS cost_micros FROM research_log
     WHERE site_id = $1 AND operation = $2 AND subject = $3 AND status IN ('ok', 'cached') ORDER BY created_at DESC LIMIT 1`,
    [siteId, operation, subject],
  );
}

// ---------------------------------------------------------------- seed backlog
export type SeedRow = {
  id: string;
  seed: string;
  priority: number;
  status: "queued" | "researched" | "skipped";
  note: string;
  last_researched_at: Date | null;
  research_count: number;
  created_at: Date;
};

export function listBacklog(tx: Tx, siteId: string): Promise<SeedRow[]> {
  return tx.many<SeedRow>(
    `SELECT id, seed, priority, status, note, last_researched_at, research_count, created_at FROM seed_backlog WHERE site_id = $1
     ORDER BY CASE status WHEN 'queued' THEN 0 WHEN 'researched' THEN 1 ELSE 2 END, priority DESC, created_at`,
    [siteId],
  );
}

/** Adds seeds (already normalised); existing ones are left as they are. Returns how many were new. */
export async function addSeeds(tx: Tx, workspaceId: string, siteId: string, seeds: string[], priority: number, addedBy: string): Promise<number> {
  return tx.exec(
    `INSERT INTO seed_backlog (workspace_id, site_id, seed, priority, added_by)
     SELECT $1, $2, s, $4, $5 FROM unnest($3::text[]) AS s ON CONFLICT (site_id, seed) DO NOTHING`,
    [workspaceId, siteId, seeds, priority, addedBy],
  );
}

export async function updateSeed(tx: Tx, siteId: string, id: string, patch: { priority?: number; status?: SeedRow["status"] }): Promise<void> {
  const n = await tx.exec(
    "UPDATE seed_backlog SET priority = coalesce($3, priority), status = coalesce($4, status) WHERE id = $1 AND site_id = $2",
    [id, siteId, patch.priority ?? null, patch.status ?? null],
  );
  if (!n) throw new Error("seed not found");
}

export async function deleteSeed(tx: Tx, siteId: string, id: string): Promise<void> {
  if (!(await tx.exec("DELETE FROM seed_backlog WHERE id = $1 AND site_id = $2", [id, siteId]))) throw new Error("seed not found");
}

export function markSeedResearched(tx: Tx, siteId: string, seed: string, at: Date): Promise<number> {
  return tx.exec(
    `UPDATE seed_backlog SET status = 'researched', last_researched_at = $3, research_count = research_count + 1
     WHERE site_id = $1 AND seed = $2 AND status <> 'skipped'`,
    [siteId, seed, at],
  );
}

// ---------------------------------------------------------------- keywords
export const KEYWORD_STATUSES = ["idea", "targeted", "published", "ranking"] as const;
export type KeywordStatus = (typeof KEYWORD_STATUSES)[number];

export type KeywordView = {
  id: string;
  keyword: string;
  market: string;
  search_volume: number | null;
  keyword_difficulty: number | null;
  cpc_micros: number | null;
  competition: number | null;
  intent: string | null;
  cluster: string;
  variant_key: string;
  status: KeywordStatus;
  fit: Fit;
  metrics_at: Date | null;
  created_at: Date;
};

export function listKeywords(tx: Tx, siteId: string): Promise<KeywordView[]> {
  return tx.many<KeywordView>(
    `SELECT id, keyword, market, search_volume, keyword_difficulty, cpc_micros::float8 AS cpc_micros, competition::float8 AS competition, intent,
            cluster, variant_key, status, fit, metrics_at, created_at
     FROM keywords WHERE site_id = $1 ORDER BY search_volume DESC NULLS LAST, keyword`,
    [siteId],
  );
}

export type KeywordSave = KeywordRow & { market: string; fit: Fit; variantKey: string; cluster: string; sourceLogId: string | null; metricsAt: Date };

/** Saves keywords (normalised) with their metrics; status and cluster of existing rows are kept. Returns rows written. */
export async function saveKeywords(tx: Tx, workspaceId: string, siteId: string, rows: KeywordSave[]): Promise<number> {
  let n = 0;
  for (const r of rows) {
    n += await tx.exec(
      `INSERT INTO keywords (workspace_id, site_id, keyword, market, search_volume, keyword_difficulty, cpc_micros, competition, intent, cluster, variant_key, fit, source_log_id, metrics_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (site_id, keyword, market) DO UPDATE SET search_volume = EXCLUDED.search_volume, keyword_difficulty = EXCLUDED.keyword_difficulty,
         cpc_micros = EXCLUDED.cpc_micros, competition = EXCLUDED.competition, intent = EXCLUDED.intent, variant_key = EXCLUDED.variant_key,
         fit = EXCLUDED.fit, source_log_id = EXCLUDED.source_log_id, metrics_at = EXCLUDED.metrics_at,
         cluster = CASE WHEN keywords.cluster = '' THEN EXCLUDED.cluster ELSE keywords.cluster END`,
      [workspaceId, siteId, r.keyword, r.market, r.volume, r.kd, r.cpcMicros, r.competition, r.intent, r.cluster.slice(0, 80), r.variantKey.slice(0, 200), r.fit, r.sourceLogId, r.metricsAt],
    );
  }
  return n;
}

export function setKeywordStatus(tx: Tx, siteId: string, ids: string[], status: KeywordStatus): Promise<number> {
  return tx.exec("UPDATE keywords SET status = $3 WHERE site_id = $1 AND id = ANY($2::uuid[])", [siteId, ids, status]);
}

export function setKeywordCluster(tx: Tx, siteId: string, ids: string[], cluster: string): Promise<number> {
  return tx.exec("UPDATE keywords SET cluster = $3 WHERE site_id = $1 AND id = ANY($2::uuid[])", [siteId, ids, cluster.slice(0, 80)]);
}

export function deleteKeywords(tx: Tx, siteId: string, ids: string[]): Promise<number> {
  return tx.exec("DELETE FROM keywords WHERE site_id = $1 AND id = ANY($2::uuid[])", [siteId, ids]);
}
