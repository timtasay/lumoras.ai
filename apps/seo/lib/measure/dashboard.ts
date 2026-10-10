/**
 * Read models for the measurement screens (site dashboard, rankings, search,
 * audit, backlinks, workspace overview). Every function takes a Tx from
 * withWorkspace(): row-level security scopes it to one workspace. Numbers
 * come from what the syncs and runs stored; nothing here calls Google or a
 * paid provider.
 */
import type { Tx } from "../db/tenant.ts";
import { addDaysIso } from "../content/schedule.ts";
import { strikingDistance, zeroClickPages, type StrikingQuery, type ZeroClickPage } from "../google/analysis.ts";
import { periodOf } from "../providers/operations.ts";
import { bucketSums, fillDays } from "../ui/chart-math.ts";
import { pacificDate } from "./cadence.ts";
import type { MeasurementHealth } from "./health.ts";
import { keywordTrends, type KeywordTrend } from "./movement.ts";
import { aggregateRows, pctChange } from "./search.ts";
import { getSyncState, type SyncState } from "./gsc-sync.ts";
import { recentRuns, type RunKind, type RunRow } from "./runs.ts";

const num = (v: unknown) => Number(v ?? 0) || 0;

export type ConnState = "unconfigured" | "none" | "no_property" | "error" | "syncing" | "ok";
export type SearchConn = { state: ConnState; property: string | null; detail: string | null; sync: SyncState | null };

/** Where Search Console and GA4 stand for a site (for the designed empty / not-connected / failing states). */
export async function searchConnections(tx: Tx, siteId: string, googleConfigured: boolean): Promise<{ gsc: SearchConn; ga4: SearchConn }> {
  const conns = await tx.many<{ kind: string; property: string | null; status: string; status_detail: string | null }>(
    "SELECT kind, config->>'property' AS property, status, status_detail FROM connections WHERE site_id = $1 AND kind IN ('search_console', 'ga4')",
    [siteId],
  );
  const one = async (kind: "search_console" | "ga4"): Promise<SearchConn> => {
    const c = conns.find((x) => x.kind === kind);
    const sync = await getSyncState(tx, siteId, kind);
    if (!googleConfigured && !c) return { state: "unconfigured", property: null, detail: null, sync };
    if (!c) return { state: "none", property: null, detail: null, sync };
    if (!c.property) return { state: "no_property", property: null, detail: c.status_detail, sync };
    if (sync?.status === "error" || (c.status === "error" && kind === "search_console")) return { state: "error", property: c.property, detail: sync?.detail ?? c.status_detail, sync };
    if (!sync?.last_success_at) return { state: "syncing", property: c.property, detail: sync?.detail ?? "The first sync is queued.", sync };
    return { state: "ok", property: c.property, detail: sync.detail, sync };
  };
  return { gsc: await one("search_console"), ga4: await one("ga4") };
}

export type TrafficSeries = { start: string; end: string; days: { day: string; clicks: number; impressions: number; position: number; final: boolean }[] };

/** Daily clicks and impressions for the last `n` Pacific days up to yesterday, gaps filled with zero. */
export async function gscSeries(tx: Tx, siteId: string, now: Date, n = 90): Promise<TrafficSeries> {
  const end = addDaysIso(pacificDate(now), -1), start = addDaysIso(end, -(n - 1));
  const rows = await tx.many<{ day: string; clicks: number; impressions: number; position: string; final: boolean }>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, clicks, impressions, position::text, final FROM gsc_daily WHERE site_id = $1 AND day BETWEEN $2 AND $3 ORDER BY day",
    [siteId, start, end],
  );
  const by = new Map(rows.map((r) => [r.day, r]));
  return {
    start,
    end,
    days: fillDays(rows, start, end, (r) => r.clicks).map((d) => {
      const r = by.get(d.day);
      return { day: d.day, clicks: r?.clicks ?? 0, impressions: r?.impressions ?? 0, position: r ? Number(r.position) : 0, final: r ? r.final : true };
    }),
  };
}

export type SearchKpis = {
  clicks: number; clicksPrev: number; clicksDelta: number | null;
  impressions: number; impressionsPrev: number; impressionsDelta: number | null;
  position: number; positionPrev: number; positionDelta: number | null;
  ctr: number;
  /** Clicks per week, 12 weeks, oldest first. */
  weeklyClicks: number[];
  newest: string | null;
  hasData: boolean;
};

/** 28-day totals against the 28 days before (impression-weighted position), and the 12-week click trend. */
export async function gscKpis(tx: Tx, siteId: string, now: Date): Promise<SearchKpis> {
  const end = addDaysIso(pacificDate(now), -1);
  const r = await tx.one<Record<string, string | null>>(
    `SELECT sum(clicks) FILTER (WHERE day > $2::date - 28) AS c, sum(clicks) FILTER (WHERE day <= $2::date - 28) AS cp,
            sum(impressions) FILTER (WHERE day > $2::date - 28) AS i, sum(impressions) FILTER (WHERE day <= $2::date - 28) AS ip,
            sum(position * impressions) FILTER (WHERE day > $2::date - 28) AS pw, sum(position * impressions) FILTER (WHERE day <= $2::date - 28) AS pwp,
            to_char(max(day), 'YYYY-MM-DD') AS newest, count(*) AS n
     FROM gsc_daily WHERE site_id = $1 AND day > $2::date - 56 AND day <= $2::date`,
    [siteId, end],
  );
  const series = await gscSeries(tx, siteId, now, 84);
  const clicks = num(r.c), clicksPrev = num(r.cp), impressions = num(r.i), impressionsPrev = num(r.ip);
  const position = impressions ? num(r.pw) / impressions : 0, positionPrev = impressionsPrev ? num(r.pwp) / impressionsPrev : 0;
  return {
    clicks, clicksPrev, clicksDelta: pctChange(clicks, clicksPrev),
    impressions, impressionsPrev, impressionsDelta: pctChange(impressions, impressionsPrev),
    position: Math.round(position * 10) / 10, positionPrev: Math.round(positionPrev * 10) / 10, positionDelta: position && positionPrev ? pctChange(position, positionPrev) : null,
    ctr: impressions ? clicks / impressions : 0,
    weeklyClicks: bucketSums(series.days.map((d) => d.clicks), 7),
    newest: r.newest,
    hasData: num(r.n) > 0,
  };
}

type QueryAgg = { query: string; page: string; clicks: number; impressions: number; position: string };

/** Queries in positions 4–20 over the last 28 days, from the stored daily rows (aggregated the way Search Console would). */
export async function strikingFromStore(tx: Tx, siteId: string, now: Date, limit = 10): Promise<StrikingQuery[]> {
  const end = addDaysIso(pacificDate(now), -1);
  const rows = await tx.many<QueryAgg>(
    "SELECT query, page, clicks, impressions, position::text FROM gsc_query_daily WHERE site_id = $1 AND day > $2::date - 28 AND day <= $2::date",
    [siteId, end],
  );
  return strikingDistance(aggregateRows(rows.map((r) => ({ ...r, position: Number(r.position) })), (r) => [r.query, r.page]), { limit });
}

export async function zeroClickFromStore(tx: Tx, siteId: string, now: Date, limit = 10): Promise<ZeroClickPage[]> {
  const end = addDaysIso(pacificDate(now), -1);
  const rows = await tx.many<{ page: string; clicks: number; impressions: number; position: string }>(
    "SELECT page, clicks, impressions, position::text FROM gsc_page_daily WHERE site_id = $1 AND day > $2::date - 28 AND day <= $2::date",
    [siteId, end],
  );
  return zeroClickPages(aggregateRows(rows.map((r) => ({ ...r, position: Number(r.position) })), (r) => [r.page]), { limit });
}

export type TopRow = { key: string; page?: string; clicks: number; impressions: number; ctr: number; position: number };

export async function topQueries(tx: Tx, siteId: string, now: Date, limit = 15): Promise<TopRow[]> {
  const end = addDaysIso(pacificDate(now), -1);
  const rows = await tx.many<{ query: string; clicks: string; impressions: string; pw: string }>(
    `SELECT query, sum(clicks)::text AS clicks, sum(impressions)::text AS impressions, sum(position * impressions)::text AS pw
     FROM gsc_query_daily WHERE site_id = $1 AND day > $2::date - 28 AND day <= $2::date GROUP BY query ORDER BY sum(clicks) DESC, sum(impressions) DESC LIMIT $3`,
    [siteId, end, limit],
  );
  return rows.map((r) => ({ key: r.query, clicks: num(r.clicks), impressions: num(r.impressions), ctr: num(r.impressions) ? num(r.clicks) / num(r.impressions) : 0, position: num(r.impressions) ? Math.round((num(r.pw) / num(r.impressions)) * 10) / 10 : 0 }));
}

export async function topPages(tx: Tx, siteId: string, now: Date, limit = 15): Promise<TopRow[]> {
  const end = addDaysIso(pacificDate(now), -1);
  const rows = await tx.many<{ page: string; clicks: string; impressions: string; pw: string }>(
    `SELECT page, sum(clicks)::text AS clicks, sum(impressions)::text AS impressions, sum(position * impressions)::text AS pw
     FROM gsc_page_daily WHERE site_id = $1 AND day > $2::date - 28 AND day <= $2::date GROUP BY page ORDER BY sum(clicks) DESC, sum(impressions) DESC LIMIT $3`,
    [siteId, end, limit],
  );
  return rows.map((r) => ({ key: r.page, clicks: num(r.clicks), impressions: num(r.impressions), ctr: num(r.impressions) ? num(r.clicks) / num(r.impressions) : 0, position: num(r.impressions) ? Math.round((num(r.pw) / num(r.impressions)) * 10) / 10 : 0 }));
}

export type Ga4Summary = {
  sessions: number; organic: number; keyEvents: number; organicKeyEvents: number;
  organicPrev: number; organicDelta: number | null;
  daily: { day: string; organic: number; sessions: number }[];
  landing: { page: string; sessions: number; keyEvents: number }[];
  events: { name: string; keyEvents: number }[];
  health: MeasurementHealth | null;
  hasData: boolean;
};

export async function ga4Summary(tx: Tx, siteId: string): Promise<Ga4Summary> {
  const newest = await tx.maybe<{ d: string | null }>("SELECT to_char(max(day), 'YYYY-MM-DD') AS d FROM ga4_daily WHERE site_id = $1", [siteId]);
  const end = newest?.d ?? null;
  const state = await getSyncState(tx, siteId, "ga4");
  const health = (state?.health as MeasurementHealth | null) ?? null;
  if (!end) return { sessions: 0, organic: 0, keyEvents: 0, organicKeyEvents: 0, organicPrev: 0, organicDelta: null, daily: [], landing: [], events: [], health, hasData: false };
  const t = await tx.one<Record<string, string | null>>(
    `SELECT sum(sessions) FILTER (WHERE day > $2::date - 28) AS s, sum(organic_sessions) FILTER (WHERE day > $2::date - 28) AS o,
            sum(key_events) FILTER (WHERE day > $2::date - 28) AS k, sum(organic_key_events) FILTER (WHERE day > $2::date - 28) AS ok,
            sum(organic_sessions) FILTER (WHERE day <= $2::date - 28) AS op
     FROM ga4_daily WHERE site_id = $1 AND day > $2::date - 56`,
    [siteId, end],
  );
  const daily = await tx.many<{ day: string; organic: number; sessions: number }>("SELECT to_char(day, 'YYYY-MM-DD') AS day, organic_sessions AS organic, sessions FROM ga4_daily WHERE site_id = $1 AND day > $2::date - 28 ORDER BY day", [siteId, end]);
  const landing = await tx.many<{ page: string; sessions: string; key_events: string }>(
    "SELECT landing_page AS page, sum(sessions)::text AS sessions, sum(key_events)::text AS key_events FROM ga4_landing_daily WHERE site_id = $1 AND day > $2::date - 28 GROUP BY landing_page ORDER BY sum(sessions) DESC LIMIT 12",
    [siteId, end],
  );
  const events = await tx.many<{ name: string; k: string }>("SELECT event_name AS name, sum(key_events)::text AS k FROM ga4_event_daily WHERE site_id = $1 AND day > $2::date - 28 GROUP BY event_name ORDER BY sum(key_events) DESC LIMIT 10", [siteId, end]);
  const organic = num(t.o), organicPrev = num(t.op);
  return {
    sessions: num(t.s), organic, keyEvents: num(t.k), organicKeyEvents: num(t.ok), organicPrev, organicDelta: pctChange(organic, organicPrev),
    daily, landing: landing.map((l) => ({ page: l.page, sessions: num(l.sessions), keyEvents: num(l.key_events) })), events: events.map((e) => ({ name: e.name, keyEvents: num(e.k) })),
    health, hasData: true,
  };
}

export type InspectionRow = { url: string; source: string; verdict: string; coverage_state: string; page_fetch_state: string; last_crawl_time: Date | null; inspected_at: Date; result_link: string | null; error: string | null; title: string | null };

export async function indexStatus(tx: Tx, siteId: string): Promise<{ rows: InspectionRow[]; indexed: number; inspected: number; publishedIndexed: number; published: number }> {
  const rows = await tx.many<InspectionRow>(
    `SELECT u.url, u.source, u.verdict, u.coverage_state, u.page_fetch_state, u.last_crawl_time, u.inspected_at, u.result_link, u.error, c.title
     FROM url_inspections u LEFT JOIN content_items c ON c.id = u.item_id WHERE u.site_id = $1
     ORDER BY CASE u.source WHEN 'published' THEN 0 WHEN 'key_page' THEN 1 ELSE 2 END, u.inspected_at DESC LIMIT 100`,
    [siteId],
  );
  const pub = rows.filter((r) => r.source === "published");
  return { rows, indexed: rows.filter((r) => r.verdict === "PASS").length, inspected: rows.length, publishedIndexed: pub.filter((r) => r.verdict === "PASS").length, published: pub.length };
}

/** Rank history of every tracked keyword (the last `runs` successful checks), with movement. */
export async function rankTrends(tx: Tx, siteId: string, runs = 26): Promise<KeywordTrend[]> {
  const snaps = await tx.many<{ keyword: string; position: number | null; captured_at: Date; run_id: string; url: string | null; source: string; cluster: string; item_id: string | null; serp_features: string[] }>(
    `SELECT s.keyword, s.position, s.captured_at, s.run_id, s.url, s.source, s.cluster, s.item_id, s.serp_features FROM rank_snapshots s
     WHERE s.site_id = $1 AND s.run_id IN (SELECT r.id FROM measurement_runs r WHERE r.site_id = $1 AND r.kind = 'rank' AND r.status = 'succeeded' ORDER BY r.started_at DESC LIMIT $2)`,
    [siteId, runs],
  );
  return keywordTrends(snaps);
}

export type IssueRow = { id: string; issue_type: string; category: string; severity: "critical" | "warning" | "info"; count: number; title: string; assignee_id: string | null; assignee: string | null; task_id: string | null; task_status: string | null };
export type AuditView = { audit: { id: string; status: string; pages_crawled: number; pages_total: number | null; started_at: Date; finished_at: Date | null; provider: string } | null; issues: IssueRow[]; previousTotal: number | null };

export async function latestAudit(tx: Tx, siteId: string): Promise<AuditView> {
  const audit = await tx.maybe<NonNullable<AuditView["audit"]>>(
    "SELECT id, status, pages_crawled, pages_total, started_at, finished_at, provider FROM audits WHERE site_id = $1 AND status = 'done' ORDER BY started_at DESC LIMIT 1",
    [siteId],
  );
  if (!audit) return { audit: null, issues: [], previousTotal: null };
  const issues = await tx.many<IssueRow>(
    `SELECT i.id, i.issue_type, i.category, i.severity, i.count, i.title, i.assignee_id, coalesce(nullif(u.name, ''), u.email) AS assignee, i.task_id, t.status AS task_status
     FROM audit_issues i LEFT JOIN auth_user u ON u.id = i.assignee_id LEFT JOIN tasks t ON t.id = i.task_id
     WHERE i.audit_id = $1 ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, i.count DESC`,
    [audit.id],
  );
  const prev = await tx.maybe<{ n: string | null }>(
    "SELECT sum(i.count)::text AS n FROM audit_issues i WHERE i.audit_id = (SELECT id FROM audits WHERE site_id = $1 AND status = 'done' AND started_at < $2 ORDER BY started_at DESC LIMIT 1)",
    [siteId, audit.started_at],
  );
  return { audit, issues, previousTotal: prev?.n ? Number(prev.n) : null };
}

export type TaskRow = { id: string; title: string; detail: string; status: string; source: string; issue_type: string | null; assignee_id: string | null; assignee: string | null; created_at: Date; done_at: Date | null };

export function listTasks(tx: Tx, siteId: string): Promise<TaskRow[]> {
  return tx.many<TaskRow>(
    `SELECT t.id, t.title, t.detail, t.status, t.source, t.issue_type, t.assignee_id, coalesce(nullif(u.name, ''), u.email) AS assignee, t.created_at, t.done_at
     FROM tasks t LEFT JOIN auth_user u ON u.id = t.assignee_id WHERE t.site_id = $1
     ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, t.created_at DESC LIMIT 100`,
    [siteId],
  );
}

export type BacklinkRow = { domain: string; is_competitor: boolean; backlinks: number | null; referring_domains: number | null; domain_rank: number | null; broken_backlinks: number | null; new_referring_domains: number | null; lost_referring_domains: number | null; captured_at: Date };

export async function backlinkHistory(tx: Tx, siteId: string): Promise<BacklinkRow[]> {
  const rows = await tx.many<BacklinkRow & { backlinks: string | null }>(
    `SELECT domain, is_competitor, backlinks::text, referring_domains, domain_rank, broken_backlinks, new_referring_domains, lost_referring_domains, captured_at
     FROM backlink_snapshots WHERE site_id = $1 ORDER BY captured_at, domain`,
    [siteId],
  );
  return rows.map((r) => ({ ...r, backlinks: r.backlinks === null ? null : Number(r.backlinks) }));
}

export type NextSlot = { id: string; slot_at: Date; status: string; title: string; primary_keyword: string | null };

/** The next three slots and their state (section 12 "next up"). */
export function nextUp(tx: Tx, siteId: string, now: Date): Promise<NextSlot[]> {
  return tx.many<NextSlot>(
    "SELECT id, slot_at, status, title, primary_keyword FROM content_items WHERE site_id = $1 AND slot_at >= $2 AND status NOT IN ('rejected', 'skipped', 'unpublished', 'published') ORDER BY slot_at LIMIT 3",
    [siteId, now],
  );
}

export async function articlesLive(tx: Tx, siteId: string): Promise<number> {
  return (await tx.one<{ n: number }>("SELECT count(*)::int AS n FROM content_items WHERE site_id = $1 AND status = 'published'", [siteId])).n;
}

/** This month's paid SEO data for the site, and the workspace's budget it draws on. */
export async function creditsThisMonth(tx: Tx, siteId: string, now: Date): Promise<{ siteMicros: number; workspaceMicros: number; ceiling: number; reserve: number }> {
  const period = periodOf(now);
  const r = await tx.one<{ s: string; w: string }>(
    "SELECT coalesce(sum(cost_micros) FILTER (WHERE site_id = $1), 0)::text AS s, coalesce(sum(cost_micros), 0)::text AS w FROM usage_ledger WHERE category = 'seo_credits' AND period = $2 AND status IN ('held', 'settled')",
    [siteId, period],
  );
  const b = await tx.maybe<{ c: string; r: string }>("SELECT monthly_ceiling::text AS c, reserve::text AS r FROM budgets WHERE category = 'seo_credits'");
  return { siteMicros: num(r.s), workspaceMicros: num(r.w), ceiling: num(b?.c), reserve: num(b?.r) };
}

/** The last run of each measurement kind (status chips, "next check" lines). */
export async function lastRuns(tx: Tx, siteId: string): Promise<Partial<Record<RunKind, RunRow>>> {
  const out: Partial<Record<RunKind, RunRow>> = {};
  for (const k of ["rank", "audit", "backlinks", "gsc", "ga4", "inspect"] as RunKind[]) {
    const [r] = await recentRuns(tx, siteId, k, 1);
    if (r) out[k] = r;
  }
  return out;
}

/** Per-site search numbers for the workspace overview cards and combined KPIs. */
export async function siteSearchCards(tx: Tx, now: Date): Promise<Map<string, { clicks: number; clicksPrev: number; impressions: number; weekly: number[] }>> {
  const end = addDaysIso(pacificDate(now), -1);
  const rows = await tx.many<{ site_id: string; c: string; cp: string; i: string; w: number[] }>(
    `SELECT s.id AS site_id,
       coalesce((SELECT sum(clicks) FROM gsc_daily g WHERE g.site_id = s.id AND g.day > $1::date - 28 AND g.day <= $1::date), 0)::text AS c,
       coalesce((SELECT sum(clicks) FROM gsc_daily g WHERE g.site_id = s.id AND g.day > $1::date - 56 AND g.day <= $1::date - 28), 0)::text AS cp,
       coalesce((SELECT sum(impressions) FROM gsc_daily g WHERE g.site_id = s.id AND g.day > $1::date - 28 AND g.day <= $1::date), 0)::text AS i,
       (SELECT array_agg(coalesce((SELECT sum(clicks) FROM gsc_daily g WHERE g.site_id = s.id AND g.day > $1::date - 7 * (k + 1) AND g.day <= $1::date - 7 * k), 0)::int ORDER BY k DESC)
          FROM generate_series(0, 11) AS k) AS w
     FROM sites s`,
    [end],
  );
  return new Map(rows.map((r) => [r.site_id, { clicks: num(r.c), clicksPrev: num(r.cp), impressions: num(r.i), weekly: r.w ?? [] }]));
}
