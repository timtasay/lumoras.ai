/**
 * Research as the product does it: rule 4 (never buy a seed twice inside
 * its maximum age), then the metered call, then rule 6 (collapse
 * near-duplicate and geographic variants) and rule 7 (drop what the
 * business does not sell). Server-side only.
 */
import { withWorkspace } from "../db/tenant.ts";
import { lastSeedResearch, logResult, markSeedResearched } from "../data/research.ts";
import { meteredCall, quoteCall, type MeterContext, type MeterDeps, type Quote } from "../metering/metered.ts";
import type { KeywordRow, Market, SerpItem } from "../providers/types.ts";
import { collapseVariants, normalizeKeyword, variantKey } from "./keywords.ts";
import { classifyFit, offerTerms, type Fit } from "./offering.ts";
import { seedDecision } from "./seeds.ts";

export type SiteForResearch = { id: string; domain: string; research_max_age_days: number };
export type BrandLists = { sells: string[]; does_not_sell: string[] };

export type AnnotatedRow = KeywordRow & { fit: Fit; fitReason: string | null; variantKey: string; target: boolean; variants: number; places: string[] };

/** Rules 6 and 7 on a list of research rows (pure). Excluded rows stay in the list, marked not_offered. */
export function annotate(rows: KeywordRow[], brand: BrandLists): AnnotatedRow[] {
  const sells = offerTerms(brand.sells), no = offerTerms(brand.does_not_sell);
  const groups = collapseVariants(rows);
  const byKey = new Map(groups.map((g) => [g.key, g]));
  return rows.map((r) => {
    const f = classifyFit(r.keyword, sells, no);
    const g = byKey.get(variantKey(r.keyword))!;
    return { ...r, fit: f.fit, fitReason: f.matched ? f.matched.source : null, variantKey: g.key, target: g.target === r, variants: g.members.length, places: g.target === r ? g.places : [] };
  });
}

export const IDEAS_LIMIT = 150;
export const SERP_DEPTH = 20;

export type ResearchRequest = { kind: "ideas"; seed: string } | { kind: "serp"; keyword: string };

function operationFor(req: ResearchRequest, market: Market) {
  return req.kind === "ideas"
    ? ({ op: "keywordIdeas", params: { seed: normalizeKeyword(req.seed), market, limit: IDEAS_LIMIT } } as const)
    : ({ op: "serp", params: { keyword: normalizeKeyword(req.keyword), market, depth: SERP_DEPTH } } as const);
}

export type ResearchQuote = { kind: "logged"; logId: string; lastAt: Date; freshUntil: Date } | { kind: "quote"; quote: Quote };

/** What running this would cost, or that the seed is already in the log (rule 4). Calls nothing paid. */
export async function quoteResearch(deps: MeterDeps, ctx: MeterContext, site: SiteForResearch, market: Market, req: ResearchRequest): Promise<ResearchQuote> {
  const o = operationFor(req, market);
  if (o.op === "keywordIdeas") {
    const last = await withWorkspace(deps.db, ctx, (tx) => lastSeedResearch(tx, site.id, o.params.seed, market.label), { readOnly: true });
    const d = seedDecision(last?.created_at ?? null, site.research_max_age_days, (deps.now ?? (() => new Date()))());
    if (!d.run && last) return { kind: "logged", logId: last.id, lastAt: d.lastAt, freshUntil: d.freshUntil };
  }
  return { kind: "quote", quote: await quoteCall(deps, ctx, o) };
}

export type ResearchOutcome =
  | { kind: "ideas"; status: "ok" | "cached" | "logged"; logId: string; at: Date; costMicros: number; rows: AnnotatedRow[] }
  | { kind: "serp"; status: "ok" | "cached"; logId: string; at: Date; costMicros: number; items: SerpItem[] };

/**
 * Runs research through the metered path. A seed researched within the
 * site's maximum age is NOT bought again: the logged result comes back
 * (status "logged", no provider call, no charge).
 */
export async function runResearch(deps: MeterDeps, ctx: MeterContext, site: SiteForResearch, brand: BrandLists, market: Market, req: ResearchRequest, confirmMaxMicros?: number): Promise<ResearchOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const o = operationFor(req, market);
  if (o.op === "keywordIdeas") {
    const seed = o.params.seed;
    const logged = await withWorkspace(
      deps.db,
      ctx,
      async (tx) => {
        const last = await lastSeedResearch(tx, site.id, seed, market.label);
        if (!last || seedDecision(last.created_at, site.research_max_age_days, now).run) return null;
        const r = await logResult<KeywordRow[]>(tx, site.id, last.id);
        return r ? { id: last.id, at: last.created_at, rows: r.result } : null;
      },
      { readOnly: true },
    );
    if (logged) return { kind: "ideas", status: "logged", logId: logged.id, at: logged.at, costMicros: 0, rows: annotate(logged.rows, brand) };
    const r = await meteredCall(deps, ctx, o, { confirmMaxMicros, onSettled: async (tx) => void (await markSeedResearched(tx, site.id, seed, now)) });
    return { kind: "ideas", status: r.status, logId: r.logId, at: r.cachedAt ?? now, costMicros: r.costMicros, rows: annotate(r.data, brand) };
  }
  const r = await meteredCall(deps, ctx, o, { confirmMaxMicros });
  return { kind: "serp", status: r.status, logId: r.logId, at: r.cachedAt ?? now, costMicros: r.costMicros, items: r.data };
}
