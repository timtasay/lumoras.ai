/**
 * Backlinks baseline (section 9 and 11, monitoring only; prospecting and
 * outreach are Phase 5): the site and up to five brand-profile competitors,
 * taken when a site is onboarded or a data provider is first configured (the
 * cadence finds no earlier snapshot), then quarterly.
 *
 * For each domain: backlinksOverview (backlinks, referring domains, rank,
 * broken links). For the site also backlinksProfile (one row per referring
 * domain, up to 100), so new and lost referring domains are counted against
 * the previous snapshot. Every call is priced first as a whole (the sum must
 * fit the budget above the reserve), then made through the metered path.
 */
import { withWorkspace, type TenantContext } from "../db/tenant.ts";
import { getSiteSettings } from "../data/sites.ts";
import { decide, REFUSAL_TEXT } from "../metering/budget.ts";
import { BudgetRefusedError, meteredCall, quoteCall, type MeterDeps } from "../metering/metered.ts";
import type { Operation } from "../providers/types.ts";
import { ProviderError } from "../providers/types.ts";
import { formatMicros } from "../research/money.ts";
import { alertRun, claimRun, finishRun, type MeasureDeps, type RunTrigger } from "./runs.ts";

export const MAX_COMPETITORS = 5;
export const PROFILE_LIMIT = 100;

const bare = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const isDomain = (d: string) => /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(d);

/** New and lost referring domains between two snapshots of the profile. */
export function diffReferring(prev: string[] | null, cur: string[]): { added: number; lost: number } | null {
  if (!prev) return null;
  const a = new Set(prev), b = new Set(cur);
  return { added: [...b].filter((d) => !a.has(d)).length, lost: [...a].filter((d) => !b.has(d)).length };
}

export type BacklinksOutcome =
  | { status: "skipped"; reason: string; runId: string | null }
  | { status: "refused"; reason: string; runId: string; estimateMicros: number }
  | { status: "succeeded"; runId: string; domains: number; costMicros: number }
  | { status: "failed"; runId: string; reason: string };

export async function runBacklinks(deps: MeasureDeps, ctx: TenantContext, siteId: string, opts: { windowKey: string; trigger: RunTrigger }): Promise<BacklinksOutcome> {
  const now = deps.now();
  const { site, competitors } = await withWorkspace(deps.db, ctx, async (tx) => ({
    site: await getSiteSettings(tx, siteId),
    competitors: (await tx.maybe<{ competitors: string[] }>("SELECT competitors FROM brand_profiles WHERE site_id = $1", [siteId]))?.competitors ?? [],
  }), { readOnly: true });
  if (opts.trigger === "schedule" && (site.backlinks_cadence === "off" || site.status !== "active")) return { status: "skipped", reason: "backlinks are off for this site", runId: null };
  const claimed = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("backlinks.run");
    return claimRun(tx, ctx.workspaceId, siteId, "backlinks", opts.windowKey, opts.trigger, ctx.actorId, now);
  });
  if (!claimed) return { status: "skipped", reason: `already done for ${opts.windowKey}`, runId: null };
  const runId = claimed.id;
  const finish = (status: "skipped" | "refused" | "failed" | "succeeded", f: Parameters<typeof finishRun>[3], alert?: [string, string]) =>
    withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action(`backlinks.${status}`);
      await finishRun(tx, runId, status, f);
      if (alert) await alertRun(tx, ctx.workspaceId, site, "backlinks", runId, alert[0], alert[1], "/backlinks");
    });
  if (!deps.seo) {
    await finish("skipped", { detail: "No SEO data provider is configured, so backlinks cannot be read yet.", now });
    return { status: "skipped", reason: "no provider", runId };
  }
  const meter: MeterDeps = { db: deps.db, provider: deps.seo, now: deps.now };
  const mctx = { ...ctx, siteId };
  const rivals = [...new Set(competitors.map(bare))].filter((d) => isDomain(d) && d !== site.domain).slice(0, MAX_COMPETITORS);
  const ops: Operation[] = [
    { op: "backlinksOverview", params: { domain: site.domain } },
    { op: "backlinksProfile", params: { domain: site.domain, limit: PROFILE_LIMIT } },
    ...rivals.map((d) => ({ op: "backlinksOverview" as const, params: { domain: d } })),
  ];
  try {
    // price the whole baseline first: every call's quote, and the sum against the budget (cache hits are free)
    const quotes = [];
    for (const o of ops) quotes.push(await quoteCall(meter, mctx, o));
    const total = quotes.reduce((s, q) => s + (q.cached ? 0 : q.estimate.micros), 0);
    const budget = quotes[0].budget;
    const d = decide(budget, total);
    const refusal = quotes.find((q) => q.refusal)?.refusal ?? (d.ok ? null : d.reason);
    if (refusal) {
      const text = `${REFUSAL_TEXT[refusal]} The baseline for ${1 + rivals.length} domain${rivals.length ? "s" : ""} would cost about ${formatMicros(total)}.`;
      await finish("refused", { detail: text, estimateMicros: total, retryAfter: new Date(now.getTime() + 24 * 3_600_000), now }, ["backlinks baseline refused by the budget", text]);
      return { status: "refused", reason: refusal, runId, estimateMicros: total };
    }
    let cost = 0;
    const overview = await meteredCall(meter, mctx, ops[0] as Extract<Operation, { op: "backlinksOverview" }>, { confirmMaxMicros: quotes[0].estimate.micros });
    const profile = await meteredCall(meter, mctx, ops[1] as Extract<Operation, { op: "backlinksProfile" }>, { confirmMaxMicros: quotes[1].estimate.micros });
    cost += overview.costMicros + profile.costMicros;
    const rows: { domain: string; competitor: boolean; o: typeof overview.data; sample: string[]; cost: number }[] = [
      { domain: site.domain, competitor: false, o: overview.data, sample: [...new Set(profile.data.filter((b) => !b.lost).map((b) => bare(b.domainFrom)).filter(Boolean))].slice(0, PROFILE_LIMIT), cost: overview.costMicros + profile.costMicros },
    ];
    for (let i = 0; i < rivals.length; i++) {
      const r = await meteredCall(meter, mctx, ops[2 + i] as Extract<Operation, { op: "backlinksOverview" }>, { confirmMaxMicros: quotes[2 + i].estimate.micros });
      cost += r.costMicros;
      rows.push({ domain: rivals[i], competitor: true, o: r.data, sample: [], cost: r.costMicros });
    }
    await withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action("backlinks.snapshot");
      const prev = await tx.maybe<{ referring_sample: string[] }>("SELECT referring_sample FROM backlink_snapshots WHERE site_id = $1 AND domain = $2 AND NOT is_competitor ORDER BY captured_at DESC LIMIT 1", [siteId, site.domain]);
      for (const r of rows) {
        const diff = r.competitor ? null : diffReferring(prev?.referring_sample ?? null, r.sample);
        await tx.exec(
          `INSERT INTO backlink_snapshots (workspace_id, site_id, run_id, domain, is_competitor, backlinks, referring_domains, domain_rank, broken_backlinks, referring_sample, new_referring_domains, lost_referring_domains, cost_micros, captured_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (run_id, domain) DO NOTHING`,
          [ctx.workspaceId, siteId, runId, r.domain, r.competitor, r.o.backlinks, r.o.referringDomains, r.o.rank, r.o.brokenBacklinks, r.sample, diff?.added ?? null, diff?.lost ?? null, r.cost, now],
        );
      }
      await finishRun(tx, runId, "succeeded", { detail: `Backlinks for ${site.domain}${rivals.length ? ` and ${rivals.length} competitor${rivals.length === 1 ? "" : "s"}` : ""}.`, estimateMicros: total, costMicros: cost, stats: { domains: rows.length }, now });
    });
    return { status: "succeeded", runId, domains: rows.length, costMicros: cost };
  } catch (e) {
    if (e instanceof BudgetRefusedError) {
      await finish("refused", { detail: e.message, estimateMicros: e.estimateMicros, retryAfter: new Date(now.getTime() + 24 * 3_600_000), now }, ["backlinks baseline refused by the budget", e.message]);
      return { status: "refused", reason: e.reason, runId, estimateMicros: e.estimateMicros };
    }
    const retryable = e instanceof ProviderError && !!e.opts.retryable;
    const msg = e instanceof Error ? e.message.slice(0, 300) : "unknown error";
    await finish("failed", { detail: `The backlinks baseline failed: ${msg}`, retryAfter: retryable ? now : new Date(now.getTime() + 6 * 3_600_000), now }, retryable ? undefined : ["backlinks baseline failed", msg]);
    if (retryable) throw e;
    return { status: "failed", runId, reason: msg };
  }
}
