/**
 * The ten steps. Each takes the run's context and returns its output (stored
 * on the pipeline_steps row with model, tokens, cost and duration by the
 * runner). Steps do their own database writes in short transactions and hold
 * none open while a model, a provider or a remote site answers.
 */
import { withWorkspace, type TenantContext, type Tx } from "../db/tenant.ts";
import { addReview, existingTargets, getItem, ownPages, saveVersion, setStatus, topicSupply, type ContentItem, type FactCheckClaim } from "../data/content.ts";
import { getBrand, listAuthors, type SiteSettings } from "../data/sites.ts";
import { notify } from "../data/workspaces.ts";
import { listBacklog, saveKeywords, setKeywordStatus } from "../data/research.ts";
import { headTerm, headTermConflicts, describeConflict } from "../content/headterm.ts";
import { lintArticle, lintPassed, type LinkCheck } from "../content/lint.ts";
import { linkTargetsOn, normPath, pagePath } from "../content/links.ts";
import { analyzeMarkdown, isExternal } from "../content/markdown.ts";
import { AUTOPILOT_WARNING, localParts, publishDateFor } from "../content/schedule.ts";
import { runToolLoop, type LoopResult, type ToolImpl } from "../llm/loop.ts";
import { modelFor } from "../llm/types.ts";
import { meteredCall } from "../metering/metered.ts";
import { quoteOnPage } from "../net/fetcher.ts";
import { nextSeeds } from "../research/seeds.ts";
import { annotate, runResearch } from "../research/service.ts";
import type { Fit } from "../research/offering.ts";
import { normalizeIntent, normalizeKeyword, type Intent } from "../research/keywords.ts";
import { marketFor } from "../research/market.ts";
import { readSeoRules, slugify } from "../validation.ts";
import { gscInsights, inspectUrl } from "../google/service.ts";
import { livePathPattern, loadPublishConnection, publisherFor, createPublisher } from "../publishers/registry.ts";
import type { PublishableArticle } from "../publishers/types.ts";
import { BRAND_SOURCE, SYSTEM, briefOutput, draftOutput, factOutput, jsonSchemaOf, taskMessage, topicOutput, type BriefInput, type BriefOutput, type DraftInput, type FactInput, type TopicCandidate, type TopicInput, type TopicOutput } from "./prompts.ts";
import { QUEUES, StepError, type PipelineDeps } from "./deps.ts";
import type { StepKey } from "./steps.ts";
import type { RunRow } from "../data/content.ts";
import { can, type Permission } from "../auth/permissions.ts";

export type StepContext = {
  deps: PipelineDeps;
  ctx: TenantContext;
  run: RunRow;
  item: ContentItem;
  site: SiteSettings;
  outputs: Partial<Record<StepKey, Record<string, unknown>>>;
};

export type StepResult = {
  output: Record<string, unknown>;
  input?: Record<string, unknown>;
  status?: "succeeded" | "skipped" | "waiting";
  model?: string | null;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costMicros?: number;
  /** Publish only: not before this instant. */
  deferUntil?: Date;
};

const tx = <T>(s: StepContext, fn: (tx: Tx) => Promise<T>, readOnly = false) => withWorkspace(s.deps.db, s.ctx, fn, { readOnly });
const llmDeps = (s: StepContext) => ({ db: s.deps.db, llm: s.deps.llm, prices: s.deps.prices, now: s.deps.now });
const meterCtx = (s: StepContext) => ({ ...s.ctx, siteId: s.site.id });
const fromLoop = <T>(r: LoopResult<T>): Pick<StepResult, "model" | "usage" | "costMicros"> => ({ model: r.model, usage: r.usage, costMicros: r.costMicros });

/** The date the article will carry (site time), never back-dated unless the site allows it. */
export function publishDateOf(s: Pick<StepContext, "deps" | "site" | "item">): string {
  return publishDateFor(s.item.slot_at, { writtenAt: s.item.written_at, now: s.deps.now(), timezone: s.site.timezone, allowBackdating: s.site.allow_backdating });
}

async function livePattern(s: StepContext): Promise<string> {
  if (!s.site.publish_connection_id) return "/blog/{{slug}}";
  const c = await tx(s, (t) => loadPublishConnection(t, s.site.publish_connection_id!), true).catch(() => null);
  return livePathPattern(c);
}

// ---------------------------------------------------------------- 1. context
export async function stepContext(s: StepContext): Promise<StepResult> {
  const d = await tx(
    s,
    async (t) => {
      const brand = await getBrand(t, s.site.id);
      const authors = await listAuthors(t, s.site.id);
      const routes = (await t.one<{ n: number }>("SELECT count(*)::int AS n FROM site_routes WHERE site_id = $1", [s.site.id])).n;
      const counts = await t.one<{ published: number; scheduled: number }>(
        `SELECT count(*) FILTER (WHERE status = 'published')::int AS published,
                count(*) FILTER (WHERE status IN ('approved', 'awaiting_review', 'changes_requested', 'generating', 'publishing'))::int AS scheduled
         FROM content_items WHERE site_id = $1 AND id <> $2`,
        [s.site.id, s.item.id],
      );
      const research = await t.one<{ lookups: number; spent: string }>("SELECT count(*)::int AS lookups, coalesce(sum(cost_micros), 0)::text AS spent FROM research_log WHERE site_id = $1", [s.site.id]);
      const supply = await topicSupply(t, s.site.id);
      const gsc = await t.maybe<{ id: string }>("SELECT id FROM connections WHERE site_id = $1 AND kind = 'search_console' AND status <> 'error'", [s.site.id]);
      return { brand, authors, routes, counts, research, supply, gscConnected: !!gsc };
    },
    true,
  );
  let gsc: { striking: unknown[]; zeroClick: unknown[] } | null = null;
  let gscNote = d.gscConnected ? "" : "Not connected: the opportunity scan has no free signals.";
  if (d.gscConnected && s.deps.google) {
    try {
      const g = await gscInsights(s.deps.google, s.ctx, s.site.id);
      if (g) gsc = { striking: g.striking.slice(0, 25), zeroClick: g.zeroClick.slice(0, 15) };
      else gscNote = "Connected, but no property is chosen yet.";
    } catch (e) {
      gscNote = `Could not read Search Console: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`;
    }
  } else if (d.gscConnected) gscNote = "Connected, but Google is not configured on this server.";
  if (!d.authors.length) throw new StepError("The site has no configured author. Bylines are real people: add one under Authors (rule 10).");
  return {
    input: { site: s.site.domain, slot: s.item.slot_at.toISOString(), publishDate: publishDateOf(s) },
    output: {
      brand: { overview: d.brand.overview.slice(0, 200), sells: d.brand.sells.length, doesNotSell: d.brand.does_not_sell.length, voiceRules: d.brand.voice_rules.length, productFacts: d.brand.product_facts.length },
      authors: d.authors.map((a) => ({ id: a.id, name: a.name, demo: a.is_demo })),
      routes: d.routes,
      published: d.counts.published,
      scheduled: d.counts.scheduled,
      researchLog: { lookups: d.research.lookups, spentMicros: Number(d.research.spent) },
      topicSupply: d.supply,
      searchConsole: gsc ? { striking: gsc.striking, zeroClick: gsc.zeroClick } : null,
      searchConsoleNote: gscNote || null,
      rankSnapshot: "Rank tracking runs in Phase 4: no snapshot yet.",
      publishDate: publishDateOf(s),
    },
  };
}

// ---------------------------------------------------------------- 2. opportunity scan
type Striking = { query: string; page: string; position: number; impressions: number; clicks: number };

export async function stepScan(s: StepContext): Promise<StepResult> {
  const gsc = (s.outputs.context?.searchConsole ?? null) as { striking: Striking[]; zeroClick: { page: string; impressions: number }[] } | null;
  if (s.item.kind === "refresh" && s.item.refresh_of) {
    return { output: { decision: "refresh", reason: "This slot was created as a refresh.", refresh: { itemId: s.item.refresh_of }, freeCandidates: [] } };
  }
  if (!gsc) return { output: { decision: "new", reason: "No Search Console data: nothing free to act on, so a new article.", freeCandidates: [], striking: 0, zeroClick: 0 } };
  const now = s.deps.now();
  const ours = await tx(
    s,
    (t) =>
      t.many<{ id: string; live_url: string | null; title: string; primary_keyword: string | null; published_at: Date | null }>(
        "SELECT id, live_url, title, primary_keyword, published_at FROM content_items WHERE site_id = $1 AND status = 'published' AND live_url IS NOT NULL",
        [s.site.id],
      ),
    true,
  );
  const pathOf = (u: string) => {
    try {
      return normPath(new URL(u).pathname);
    } catch {
      return normPath(u);
    }
  };
  const byPath = new Map(ours.map((o) => [pathOf(o.live_url!), o]));
  // refresh: one of OUR articles, older than 30 days, sitting at 8–20 for a query with real impressions
  const refresh = gsc.striking
    .filter((q) => q.position >= 8 && q.position <= 20 && q.impressions >= 50)
    .map((q) => ({ q, item: byPath.get(pathOf(q.page)) }))
    .filter((x) => x.item && x.item.published_at && now.getTime() - x.item.published_at.getTime() > 30 * 86_400_000)
    .sort((a, b) => b.q.impressions - a.q.impressions)[0];
  if (refresh?.item) {
    await tx(s, async (t) => {
      await t.action("content.refresh_decision");
      await t.exec("UPDATE content_items SET kind = 'refresh', refresh_of = $2, primary_keyword = $3, head_term = NULL WHERE id = $1", [s.item.id, refresh.item!.id, refresh.item!.primary_keyword]);
    });
    return {
      output: {
        decision: "refresh",
        reason: `“${refresh.item.title}” sits at position ${refresh.q.position.toFixed(1)} for “${refresh.q.query}” with ${refresh.q.impressions} impressions: refreshing it beats a new page.`,
        refresh: { itemId: refresh.item.id, title: refresh.item.title, url: refresh.item.live_url, query: refresh.q.query, position: refresh.q.position },
        freeCandidates: [],
        striking: gsc.striking.length,
        zeroClick: gsc.zeroClick.length,
      },
    };
  }
  // new: striking-distance queries on pages that are not ours are free topic candidates
  const free = gsc.striking
    .filter((q) => !byPath.has(pathOf(q.page)))
    .slice(0, 10)
    .map((q) => ({ keyword: normalizeKeyword(q.query), impressions: q.impressions, position: q.position, page: q.page }));
  return { output: { decision: "new", reason: "No published article of ours is close enough to page one to refresh.", freeCandidates: free, striking: gsc.striking.length, zeroClick: gsc.zeroClick.length } };
}

// ---------------------------------------------------------------- 3. topic selection
const INTENT_WEIGHT: Record<string, number> = { commercial: 1.2, transactional: 1.1, informational: 1, navigational: 0.4 };
export function scoreCandidate(c: { volume: number | null; kd: number | null; intent: string | null; source: string; impressions?: number }): number {
  const vol = c.volume ?? (c.impressions ? c.impressions * 3 : 50);
  return (vol / ((c.kd ?? 30) + 10)) * (INTENT_WEIGHT[c.intent ?? "informational"] ?? 1) * (c.source === "search_console" ? 1.3 : 1);
}

export async function stepTopic(s: StepContext): Promise<StepResult> {
  const scan = s.outputs.scan ?? {};
  if (scan.decision === "refresh") {
    const ref = (scan.refresh ?? {}) as { itemId?: string };
    const orig = ref.itemId ? await tx(s, (t) => getItem(t, ref.itemId!), true) : null;
    if (!orig?.primary_keyword) throw new StepError("The page to refresh has no primary keyword.");
    await tx(s, async (t) => {
      await t.action("content.topic");
      await t.exec("UPDATE content_items SET primary_keyword = $2, secondary_keywords = $3, cluster = $4, intent = $5, topic = $6::jsonb WHERE id = $1", [
        s.item.id,
        orig.primary_keyword,
        orig.secondary_keywords,
        orig.cluster,
        orig.intent,
        JSON.stringify({ chosenBy: "refresh", keyword: orig.primary_keyword, refreshOf: orig.id }),
      ]);
    });
    return { status: "skipped", output: { decision: "refresh", keyword: orig.primary_keyword, reason: "Refreshing an existing article: its keyword stays. No paid research." } };
  }

  const now = s.deps.now();
  const market = marketFor(s.site);
  const { brand, existing, ideas, backlog } = await tx(
    s,
    async (t) => ({
      brand: await getBrand(t, s.site.id),
      existing: await existingTargets(t, s.site.id, s.item.id),
      ideas: await t.many<{ keyword: string; search_volume: number | null; keyword_difficulty: number | null; cpc_micros: string | null; competition: string | null; intent: string | null }>(
        "SELECT keyword, search_volume, keyword_difficulty, cpc_micros::text, competition::text, intent FROM keywords WHERE site_id = $1 AND status = 'idea' AND fit <> 'not_offered' ORDER BY search_volume DESC NULLS LAST LIMIT 200",
        [s.site.id],
      ),
      backlog: await listBacklog(t, s.site.id),
    }),
    true,
  );
  const lists = { sells: brand.sells, does_not_sell: brand.does_not_sell };
  type Row = { keyword: string; volume: number | null; kd: number | null; cpcMicros: number | null; competition: number | null; intent: Intent | null; source: string; impressions?: number };
  const pool: Row[] = [];
  const research: { seed: string; status: string; costMicros: number }[] = [];
  for (const f of (scan.freeCandidates ?? []) as { keyword: string; impressions: number }[]) pool.push({ keyword: f.keyword, volume: null, kd: null, cpcMicros: null, competition: null, intent: null, source: "search_console", impressions: f.impressions });
  for (const i of ideas) pool.push({ keyword: i.keyword, volume: i.search_volume, kd: i.keyword_difficulty, cpcMicros: i.cpc_micros ? Number(i.cpc_micros) : null, competition: i.competition ? Number(i.competition) : null, intent: normalizeIntent(i.intent), source: "saved idea" });

  const allowed = () => {
    const rows = annotate(pool.map((p) => ({ keyword: p.keyword, volume: p.volume, kd: p.kd, cpcMicros: p.cpcMicros, competition: p.competition, intent: p.intent })), lists);
    const rejected: { keyword: string; reason: string }[] = [];
    const out: TopicCandidate[] = [];
    rows.forEach((r, i) => {
      if (r.fit === "not_offered") return void rejected.push({ keyword: r.keyword, reason: `rule 7: matches "does not sell" (${r.fitReason})` });
      if (!r.target) return void rejected.push({ keyword: r.keyword, reason: "rule 6: a near-duplicate or place variant of another candidate" });
      const conflicts = headTermConflicts(r.keyword, existing);
      if (conflicts.length) return void rejected.push({ keyword: r.keyword, reason: `rule 5: ${describeConflict(conflicts[0])}` });
      if (out.some((o) => normalizeKeyword(o.keyword) === normalizeKeyword(r.keyword))) return;
      out.push({ keyword: r.keyword, volume: r.volume, kd: r.kd, cpcUsd: r.cpcMicros !== null ? r.cpcMicros / 1e6 : null, intent: r.intent, fit: r.fit, places: r.places, variants: r.variants, source: pool[i].source });
    });
    out.sort((a, b) => scoreCandidate({ ...b, impressions: pool.find((p) => p.keyword === b.keyword)?.impressions }) - scoreCandidate({ ...a, impressions: pool.find((p) => p.keyword === a.keyword)?.impressions }));
    return { candidates: out.slice(0, 8), rejected };
  };

  let { candidates, rejected } = allowed();
  // too few safe candidates: research the next seed from the backlog (paid, metered, rule 4 inside)
  if (candidates.length < 3 && s.deps.seo) {
    const seeds = nextSeeds(
      backlog.map((b) => ({ id: b.id, seed: b.seed, priority: b.priority, status: b.status, lastResearchedAt: b.last_researched_at, createdAt: b.created_at })),
      s.site.research_max_age_days,
      now,
      1,
    );
    for (const seed of seeds) {
      const r = await runResearch({ db: s.deps.db, provider: s.deps.seo, now: s.deps.now }, meterCtx(s), s.site, lists, market, { kind: "ideas", seed: seed.seed });
      if (r.kind !== "ideas") continue;
      research.push({ seed: seed.seed, status: r.status, costMicros: r.costMicros });
      for (const row of r.rows) pool.push({ keyword: row.keyword, volume: row.volume, kd: row.kd, cpcMicros: row.cpcMicros, competition: row.competition, intent: row.intent, source: `seed: ${seed.seed}` });
    }
    ({ candidates, rejected } = allowed());
  }
  if (!candidates.length) throw new StepError("No topic left that passes the rules: add seeds to the backlog or save keyword ideas. The runway shows this too.");

  const input: TopicInput = {
    site: { domain: s.site.domain, name: s.site.name, sells: brand.sells, doesNotSell: brand.does_not_sell, goal: brand.current_goal },
    candidates,
    publishDate: publishDateOf(s),
    existingCount: existing.length,
  };
  const tools: ToolImpl[] = [];
  const seo = s.deps.seo;
  if (seo) {
    tools.push({
      def: {
        name: "keyword_metrics",
        description: "Search volume, keyword difficulty, CPC and intent for up to 10 keywords in the site's market. Paid from the client's budget.",
        input_schema: { type: "object", properties: { keywords: { type: "array", items: { type: "string" }, maxItems: 10 } }, required: ["keywords"], additionalProperties: false },
      },
      spends: true,
      untrusted: false,
      maxCalls: 1,
      async run(raw) {
        const kws = ((raw as { keywords?: unknown }).keywords as unknown[] | undefined)?.filter((k): k is string => typeof k === "string").slice(0, 10) ?? [];
        if (!kws.length) throw new Error("no keywords given");
        const r = await meteredCall({ db: s.deps.db, provider: seo, now: s.deps.now }, meterCtx(s), { op: "keywordMetrics", params: { keywords: kws, market } });
        research.push({ seed: `metrics: ${kws.length} keywords`, status: r.status, costMicros: r.costMicros });
        return { text: JSON.stringify(r.data.map((k) => ({ keyword: k.keyword, volume: k.volume, kd: k.kd, cpcUsd: k.cpcMicros === null ? null : k.cpcMicros / 1e6, intent: k.intent }))), summary: `${r.data.length} rows · ${r.status}` };
      },
    });
    tools.push({
      def: {
        name: "serp",
        description: "The top 10 Google results for one keyword in the site's market (titles, URLs). Paid. Results are third-party content.",
        input_schema: { type: "object", properties: { keyword: { type: "string" } }, required: ["keyword"], additionalProperties: false },
      },
      spends: true,
      untrusted: true,
      maxCalls: 1,
      async run(raw) {
        const kw = String((raw as { keyword?: unknown }).keyword ?? "").slice(0, 200);
        const r = await meteredCall({ db: s.deps.db, provider: seo, now: s.deps.now }, meterCtx(s), { op: "serp", params: { keyword: kw, market, depth: 10 } });
        research.push({ seed: `serp: ${kw}`, status: r.status, costMicros: r.costMicros });
        return { text: r.data.map((x) => `${x.rank}. ${x.title} (${x.domain})`).join("\n"), summary: `${r.data.length} results · ${r.status}`, source: `serp:${kw}` };
      },
    });
  }
  const model = modelFor("topic", s.deps.models);
  const loop = await runToolLoop<TopicOutput>(
    llmDeps(s),
    meterCtx(s),
    { purpose: "topic", model, system: SYSTEM.topic, maxTokens: 4000, effort: "high", outputSchema: jsonSchemaOf(topicOutput), messages: [{ role: "user", content: taskMessage(input) }] },
    tools,
    topicOutput,
  );

  // code has the last word: the pick must be an allowed candidate and still pass rule 5
  let chosen = candidates.find((c) => normalizeKeyword(c.keyword) === normalizeKeyword(loop.output.keyword));
  let chosenBy = "model";
  let note: string | null = null;
  if (!chosen) {
    chosen = candidates[0];
    chosenBy = "code";
    note = `The model picked "${loop.output.keyword.slice(0, 80)}", which is not one of the allowed candidates; the top allowed candidate was used instead.`;
  }
  const kw = normalizeKeyword(chosen.keyword);
  const conflicts = headTermConflicts(kw, existing);
  if (conflicts.length) throw new StepError(`Duplicate head term: ${describeConflict(conflicts[0])}.`);
  const secondary = loop.output.secondary.map(normalizeKeyword).filter((k) => k && k !== kw && !headTermConflicts(k, existing).length).slice(0, 5);
  const topic = { chosenBy, note, keyword: kw, rationale: loop.output.rationale, places: chosen.places, candidates, rejected: rejected.slice(0, 25), research, tools: loop.tools };
  await tx(s, async (t) => {
    await t.action("content.topic");
    await t.exec("UPDATE content_items SET primary_keyword = $2, head_term = $3, secondary_keywords = $4, cluster = $5, intent = $6, topic = $7::jsonb WHERE id = $1", [
      s.item.id,
      kw,
      headTerm(kw),
      secondary,
      loop.output.cluster.slice(0, 80),
      chosen!.intent ?? loop.output.intent,
      JSON.stringify(topic),
    ]);
    const kwRow = pool.find((p) => normalizeKeyword(p.keyword) === kw);
    await saveKeywords(t, s.ctx.workspaceId, s.site.id, [
      { keyword: kw, volume: kwRow?.volume ?? null, kd: kwRow?.kd ?? null, cpcMicros: kwRow?.cpcMicros ?? null, competition: kwRow?.competition ?? null, intent: normalizeIntent(chosen!.intent), market: market.label, fit: chosen!.fit as Fit, variantKey: headTerm(kw), cluster: loop.output.cluster.slice(0, 80), sourceLogId: null, metricsAt: now },
    ]);
    const ids = (await t.many<{ id: string }>("SELECT id FROM keywords WHERE site_id = $1 AND keyword = $2", [s.site.id, kw])).map((x) => x.id);
    await setKeywordStatus(t, s.site.id, ids, "targeted");
    // rule 4: what was bought and not used now is the next runs' topic supply, saved as ideas (free to reuse)
    const leftovers = candidates.filter((c) => c.source.startsWith("seed:") && normalizeKeyword(c.keyword) !== kw);
    if (leftovers.length) {
      await saveKeywords(
        t,
        s.ctx.workspaceId,
        s.site.id,
        leftovers.map((c) => {
          const row = pool.find((p) => p.keyword === c.keyword);
          return { keyword: normalizeKeyword(c.keyword), volume: c.volume, kd: c.kd, cpcMicros: row?.cpcMicros ?? null, competition: row?.competition ?? null, intent: normalizeIntent(c.intent), market: market.label, fit: c.fit as Fit, variantKey: headTerm(c.keyword), cluster: "", sourceLogId: null, metricsAt: now };
        }),
      );
    }
  });
  return { input: { candidates: candidates.length, rejected: rejected.length }, output: { keyword: kw, chosenBy, note, intent: chosen.intent, secondary, rationale: loop.output.rationale, candidates: candidates.slice(0, 5), rejected: rejected.slice(0, 10), research, tools: loop.tools }, ...fromLoop(loop) };
}

// ---------------------------------------------------------------- 4. brief
export async function stepBrief(s: StepContext): Promise<StepResult> {
  const item = await tx(s, (t) => getItem(t, s.item.id), true);
  if (!item.primary_keyword) throw new StepError("No target keyword: run topic selection first.");
  const publishDate = publishDateOf(s);
  const pattern = await livePattern(s);
  const { brand, routes, pages, titles, refreshOf } = await tx(
    s,
    async (t) => ({
      brand: await getBrand(t, s.site.id),
      routes: await t.many<{ path: string }>("SELECT path FROM site_routes WHERE site_id = $1 ORDER BY length(path), path LIMIT 2000", [s.site.id]),
      pages: await ownPages(t, s.site.id, pattern, item.id),
      titles: (await t.many<{ title: string }>("SELECT title FROM content_items WHERE site_id = $1 AND title <> '' AND id <> $2 AND status NOT IN ('rejected', 'skipped') LIMIT 100", [s.site.id, item.id])).map((x) => x.title),
      refreshOf: item.refresh_of ? await getItem(t, item.refresh_of) : null,
    }),
    true,
  );
  const keyTitles = new Map((brand.key_pages ?? []).map((k) => { try { return [normPath(new URL(k.url).pathname), k.title] as const; } catch { return ["", ""] as const; } }));
  const targets = [...linkTargetsOn(publishDate, routes, pages).values()]
    .filter((t) => !(refreshOf?.slug && t.path === pagePath(pattern, refreshOf.slug)))
    .map((t) => ({ path: t.path, title: t.source === "inventory" ? keyTitles.get(t.path) || titleFromPath(t.path) : t.title }))
    .slice(0, 120);
  const rules = readSeoRules(brand.seo_rules);
  const topic = (item.topic ?? {}) as { places?: string[] };
  const input: BriefInput = {
    site: { domain: s.site.domain, name: s.site.name, audience: brand.audience, positioning: brand.positioning, productFacts: brand.product_facts, forbiddenClaims: brand.forbidden_claims, voiceRules: brand.voice_rules },
    target: { keyword: item.primary_keyword, secondary: item.secondary_keywords, intent: item.intent ?? "informational", places: topic.places ?? [], cluster: item.cluster },
    refresh: refreshOf ? { url: refreshOf.live_url ?? "", title: refreshOf.title } : null,
    publishDate,
    linkTargets: targets,
    links: { min: rules.internalLinksMin, max: rules.internalLinksMax },
    cover: { kinds: rules.coverKinds, chips: rules.coverChips, chipMax: rules.coverChipMax },
    titleMax: rules.titleMax,
    existingTitles: titles.slice(0, 50),
  };
  const loop = await runToolLoop<BriefOutput>(
    llmDeps(s),
    meterCtx(s),
    { purpose: "brief", model: modelFor("brief", s.deps.models), system: SYSTEM.brief, maxTokens: 6000, effort: "medium", outputSchema: jsonSchemaOf(briefOutput), messages: [{ role: "user", content: taskMessage(input) }] },
    [],
    briefOutput,
  );
  // rule 9 in code: only links that exist on the publish date survive
  const allowed = new Set(targets.map((t) => normPath(t.path)));
  const kept: BriefOutput["internalLinks"] = [];
  const dropped: { path: string; reason: string }[] = [];
  for (const l of loop.output.internalLinks) {
    const p = normPath(l.path);
    if (!allowed.has(p)) dropped.push({ path: l.path, reason: `not live on ${publishDate}` });
    else if (kept.some((k) => normPath(k.path) === p)) dropped.push({ path: l.path, reason: "duplicate" });
    else if (kept.length < rules.internalLinksMax) kept.push({ ...l, path: p });
  }
  let slug = refreshOf?.slug ?? (slugify(loop.output.slug) || slugify(item.primary_keyword));
  if (!refreshOf) {
    const taken = new Set([...pages.map((p) => p.path), ...routes.map((r) => normPath(r.path))]);
    for (let n = 2; taken.has(pagePath(pattern, slug)) && n < 50; n++) slug = `${slugify(loop.output.slug || item.primary_keyword).slice(0, 44)}-${n}`;
  }
  const brief = { ...loop.output, slug, internalLinks: kept, droppedLinks: dropped, publishDate };
  await tx(s, async (t) => {
    await t.action("content.brief");
    await t.exec("UPDATE content_items SET brief = $2::jsonb, slug = $3, internal_links = $4::jsonb, cover = $5::jsonb, publish_date = $6 WHERE id = $1", [
      item.id,
      JSON.stringify(brief),
      slug,
      JSON.stringify(kept.map((k) => ({ path: k.path, anchor: k.anchor, status: "live on publish date" }))),
      JSON.stringify(loop.output.cover),
      publishDate,
    ]);
  });
  return {
    input: { keyword: item.primary_keyword, publishDate, linkTargets: targets.length },
    output: { title: loop.output.title, slug, sections: loop.output.outline.length, outline: loop.output.outline.map((o) => o.heading), questions: loop.output.questions, internalLinks: kept, droppedLinks: dropped, claimsToSource: loop.output.claimsToSource, cover: loop.output.cover },
    ...fromLoop(loop),
  };
}

const titleFromPath = (p: string) => (p === "/" ? "Home" : (p.split("/").filter(Boolean).at(-1) ?? p).replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()));

// ---------------------------------------------------------------- 5. draft
export async function stepDraft(s: StepContext): Promise<StepResult> {
  const item = await tx(s, (t) => getItem(t, s.item.id), true);
  const brief = item.brief as (BriefOutput & { slug: string }) | null;
  if (!brief || !item.primary_keyword) throw new StepError("No brief: run the brief step first.");
  const { brand, authors, refreshOf } = await tx(s, async (t) => ({ brand: await getBrand(t, s.site.id), authors: await listAuthors(t, s.site.id), refreshOf: item.refresh_of ? await getItem(t, item.refresh_of) : null }), true);
  // rule 10: a configured author, a real person first; never a generated one
  const author = authors.find((a) => !a.is_demo) ?? authors[0];
  if (!author) throw new StepError("The site has no configured author (rule 10).");
  const rules = readSeoRules(brand.seo_rules);
  const input: DraftInput = {
    site: { domain: s.site.domain, name: s.site.name, voiceRules: brand.voice_rules, bannedWords: brand.banned_words, productFacts: brand.product_facts, forbiddenClaims: brand.forbidden_claims },
    rules: { titleMax: rules.titleMax, descriptionMin: rules.descriptionMin, descriptionMax: rules.descriptionMax, bodyMinWords: rules.bodyMinWords, bodyMaxWords: rules.bodyMaxWords, introMinSentences: rules.introMinSentences, introMaxSentences: rules.introMaxSentences, noEmDash: rules.noEmDash, noEmoji: rules.noEmoji },
    brief: { ...brief, keyword: item.primary_keyword, secondary: item.secondary_keywords, places: ((item.topic ?? {}) as { places?: string[] }).places ?? [] },
    refreshOf: refreshOf ? { title: refreshOf.title, bodyMd: refreshOf.body_md } : null,
  };
  const loop = await runToolLoop(
    llmDeps(s),
    meterCtx(s),
    { purpose: "draft", model: modelFor("draft", s.deps.models), system: SYSTEM.draft, maxTokens: 12000, effort: "medium", outputSchema: jsonSchemaOf(draftOutput), messages: [{ role: "user", content: taskMessage(input) }] },
    [],
    draftOutput,
  );
  const a = analyzeMarkdown(loop.output.bodyMd);
  const version = await tx(s, async (t) => {
    await t.action("content.draft");
    const v = await saveVersion(t, s.ctx.workspaceId, item.id, { title: loop.output.title, description: loop.output.description, bodyMd: loop.output.bodyMd, cover: loop.output.cover }, "draft", s.ctx.actorId, `Drafted by ${loop.model}`);
    await t.exec("UPDATE content_items SET author_id = $2, written_at = $3 WHERE id = $1", [item.id, author.id, s.deps.now()]);
    return v;
  });
  return {
    input: { brief: brief.title, author: author.name, voiceRules: brand.voice_rules.length },
    output: { title: loop.output.title, titleLength: loop.output.title.length, descriptionLength: loop.output.description.length, words: a.words, sections: a.headings.filter((h) => h.depth === 2).length, author: { id: author.id, name: author.name, demo: author.is_demo }, version },
    ...fromLoop(loop),
  };
}

// ---------------------------------------------------------------- 6. fact-check
const PRIMARY_HOST = /(^|\.)(gov|mil|edu|int)(\.[a-z]{2})?$|(^|\.)europa\.eu$|(^|\.)gov\.uk$/i;

/** Code's verdict on the model's evidence: quotes must really be on the fetched page (or in the product facts). */
export function verifyClaims(claims: { claim: string; status: FactCheckClaim["status"]; sourceUrl: string | null; quote: string | null; replacement: string | null; note: string }[], ctx: { fetched: Map<string, { status: number; text: string }>; productFacts: string[]; finalBody: string }): FactCheckClaim[] {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
  const body = norm(ctx.finalBody);
  return claims.map((c) => {
    const base = { claim: c.claim, sourceUrl: c.sourceUrl, quote: c.quote, replacement: c.replacement, note: c.note, primary: false, verified: false };
    switch (c.status) {
      case "sourced": {
        if (c.sourceUrl === BRAND_SOURCE) {
          const ok = !!c.quote && ctx.productFacts.some((f) => norm(f).includes(norm(c.quote!)) || norm(c.quote!).includes(norm(f)));
          return ok ? { ...base, status: "sourced", verified: true, primary: true, note: "Matches the client's confirmed product facts." } : { ...base, status: "unverifiable", note: "The quote is not one of the brand profile's product facts." };
        }
        const page = c.sourceUrl ? ctx.fetched.get(c.sourceUrl) : undefined;
        if (!page) return { ...base, status: "unverifiable", note: "The source was not fetched in this step, so the quote cannot be checked." };
        if (page.status < 200 || page.status >= 300) return { ...base, status: "unverifiable", note: `The source answered ${page.status || "nothing"}.` };
        if (!c.quote || !quoteOnPage(c.quote, page.text)) return { ...base, status: "unverifiable", note: "The quote does not appear on the fetched page." };
        let host = "";
        try {
          host = new URL(c.sourceUrl!).hostname;
        } catch {
          /* not a URL */
        }
        return { ...base, status: "sourced", verified: true, primary: PRIMARY_HOST.test(host) };
      }
      case "removed":
        return body.includes(norm(c.claim)) ? { ...base, status: "unverifiable", note: "Marked removed but still in the body." } : { ...base, status: "removed", verified: true };
      case "rewritten":
        return { ...base, status: "rewritten", verified: true };
      default:
        return { ...base, status: "unverifiable" };
    }
  });
}

export async function stepFactcheck(s: StepContext): Promise<StepResult> {
  const item = await tx(s, (t) => getItem(t, s.item.id), true);
  const brand = await tx(s, (t) => getBrand(t, s.site.id), true);
  const brief = (item.brief ?? {}) as { claimsToSource?: string[] };
  const fetched = new Map<string, { status: number; text: string }>();
  const fetchTool: ToolImpl = {
    def: {
      name: "fetch_source",
      description: "Fetch a public web page to read its text (to find a primary source and an exact quote). Free. The page is third-party content.",
      input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
    },
    spends: false,
    untrusted: true,
    maxCalls: 10,
    async run(raw) {
      const url = String((raw as { url?: unknown }).url ?? "");
      if (!/^https?:\/\//i.test(url)) throw new Error("only http(s) URLs");
      const p = await s.deps.fetcher.fetchPage(url);
      fetched.set(url, { status: p.status, text: p.text });
      return { text: p.status ? `HTTP ${p.status}${p.title ? ` · ${p.title}` : ""}\n${p.text.slice(0, 20_000)}` : `Not fetched: ${p.error ?? "error"}`, summary: `${p.status || "failed"} ${url.slice(0, 80)}`, source: url };
    },
  };
  const input: FactInput = { site: { domain: s.site.domain, productFacts: brand.product_facts, forbiddenClaims: brand.forbidden_claims }, claimsToSource: brief.claimsToSource ?? [], title: item.title, bodyMd: item.body_md };
  const loop = await runToolLoop(
    llmDeps(s),
    meterCtx(s),
    { purpose: "factcheck", model: modelFor("factcheck", s.deps.models), system: SYSTEM.factcheck, maxTokens: 12000, effort: "high", outputSchema: jsonSchemaOf(factOutput), messages: [{ role: "user", content: taskMessage(input) }] },
    [fetchTool],
    factOutput,
    { maxTurns: 10 },
  );
  const claims = verifyClaims(loop.output.claims, { fetched, productFacts: brand.product_facts, finalBody: loop.output.bodyMd });
  const unverifiable = claims.filter((c) => c.status === "unverifiable").length;
  const sources = claims.filter((c) => c.status === "sourced" && c.verified && c.sourceUrl).map((c) => ({ claim: c.claim, url: c.sourceUrl!, quote: c.quote ?? "" }));
  const changed = loop.output.bodyMd.trim() !== item.body_md.trim();
  await tx(s, async (t) => {
    await t.action("content.fact_check");
    if (changed) await saveVersion(t, s.ctx.workspaceId, item.id, { title: item.title, description: item.description, bodyMd: loop.output.bodyMd, cover: item.cover }, "fact_check", s.ctx.actorId, `${claims.filter((c) => c.status === "rewritten").length} rewritten, ${claims.filter((c) => c.status === "removed").length} removed`);
    await t.exec("UPDATE content_items SET fact_check = $2::jsonb, fact_check_passed = $3, unverifiable_claims = $4, sources = $5::jsonb WHERE id = $1", [item.id, JSON.stringify(claims), unverifiable === 0, unverifiable, JSON.stringify(sources)]);
  });
  const count = (st: string) => claims.filter((c) => c.status === st).length;
  return {
    input: { claims: input.claimsToSource.length, words: analyzeMarkdown(item.body_md).words },
    output: { claims: claims.length, sourced: count("sourced"), rewritten: count("rewritten"), removed: count("removed"), unverifiable, passed: unverifiable === 0, evidence: claims, fetched: [...fetched.entries()].map(([url, p]) => ({ url, status: p.status })), bodyChanged: changed },
    ...fromLoop(loop),
  };
}

// ---------------------------------------------------------------- 7. lint
export async function runLint(deps: Pick<PipelineDeps, "db" | "fetcher" | "now">, ctx: TenantContext, site: SiteSettings, itemId: string, opts: { checkLinks?: boolean } = {}) {
  const t0 = await withWorkspace(deps.db, ctx, async (t) => ({ item: await getItem(t, itemId), brand: await getBrand(t, site.id), authors: await listAuthors(t, site.id) }), { readOnly: true });
  const { item, brand } = t0;
  const pattern = site.publish_connection_id ? await withWorkspace(deps.db, ctx, (t) => loadPublishConnection(t, site.publish_connection_id!), { readOnly: true }).then(livePathPattern, () => "/blog/{{slug}}") : "/blog/{{slug}}";
  const a = analyzeMarkdown(item.body_md);
  const external = [...new Set(a.links.filter((l) => isExternal(l.url, site.domain)).map((l) => l.url))].slice(0, 30);
  if (opts.checkLinks !== false && external.length) {
    const results = await Promise.all(external.map((u) => deps.fetcher.checkLink(u)));
    await withWorkspace(deps.db, ctx, async (t) => {
      await t.action("content.link_check");
      for (const r of results) {
        await t.exec(
          `INSERT INTO link_checks (workspace_id, site_id, url, status_code, ok, error, checked_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (site_id, url) DO UPDATE SET status_code = EXCLUDED.status_code, ok = EXCLUDED.ok, error = EXCLUDED.error, checked_at = EXCLUDED.checked_at`,
          [ctx.workspaceId, site.id, r.url, r.status, r.ok, r.error?.slice(0, 500) ?? null, deps.now()],
        );
      }
    });
  }
  const publishDate = publishDateFor(item.slot_at, { writtenAt: item.written_at, now: deps.now(), timezone: site.timezone, allowBackdating: site.allow_backdating });
  const data = await withWorkspace(
    deps.db,
    ctx,
    async (t) => ({
      routes: await t.many<{ path: string }>("SELECT path FROM site_routes WHERE site_id = $1", [site.id]),
      pages: await ownPages(t, site.id, pattern, item.id),
      checks: await t.many<{ url: string; ok: boolean; status_code: number | null; error: string | null; checked_at: Date }>("SELECT url, ok, status_code, error, checked_at FROM link_checks WHERE site_id = $1 AND url = ANY($2)", [site.id, external]),
      existing: await existingTargets(t, site.id, item.id),
    }),
    { readOnly: true },
  );
  const linkChecks = new Map<string, LinkCheck>(data.checks.map((c) => [c.url, { url: c.url, ok: c.ok, status: c.status_code, error: c.error, checkedAt: c.checked_at.toISOString() }]));
  const results = lintArticle(
    {
      title: item.title,
      description: item.description,
      bodyMd: item.body_md,
      slug: item.slug,
      primaryKeyword: item.primary_keyword,
      authorId: item.author_id,
      cover: item.cover,
      publishDate,
      rules: readSeoRules(brand.seo_rules),
      bannedWords: brand.banned_words,
      siteDomain: site.domain,
      authors: t0.authors,
      routes: data.routes,
      pages: data.pages,
      linkChecks,
      existingTargets: item.kind === "refresh" ? [] : data.existing,
      itemId: item.id,
    },
    a,
  );
  const passed = lintPassed(results);
  await withWorkspace(deps.db, ctx, async (t) => {
    await t.action("content.lint");
    await t.exec("UPDATE content_items SET lint = $2::jsonb, lint_passed = $3, lint_at = $4, publish_date = $5 WHERE id = $1", [item.id, JSON.stringify(results), passed, deps.now(), publishDate]);
  });
  return { results, passed, publishDate, external: external.length };
}

export async function stepLint(s: StepContext): Promise<StepResult> {
  const r = await runLint(s.deps, s.ctx, s.site, s.item.id);
  const n = (st: string) => r.results.filter((x) => x.status === st).length;
  return { input: { rules: r.results.length, publishDate: r.publishDate, externalLinks: r.external }, output: { passed: r.passed, pass: n("pass"), warn: n("warn"), fail: n("fail"), results: r.results } };
}

// ---------------------------------------------------------------- 8. review gate
export { AUTOPILOT_WARNING };

/** Members who may approve, for notifications (owners, editors, reviewers). */
async function approvers(t: Tx, workspaceId: string): Promise<string[]> {
  const rows = await t.many<{ user_id: string; role: string }>("SELECT user_id, role FROM auth_member WHERE organization_id = $1", [workspaceId]);
  return rows.filter((r) => can(r.role as never, "content:approve" as Permission)).map((r) => r.user_id);
}

export async function stepReview(s: StepContext): Promise<StepResult> {
  const item = await tx(s, (t) => getItem(t, s.item.id), true);
  if (item.status === "approved" || item.status === "publishing" || item.status === "published") {
    return { output: { decision: "approved", mode: s.site.review_mode } };
  }
  if (item.status === "rejected") return { output: { decision: "rejected" }, status: "succeeded" };
  if (item.status === "awaiting_review" || item.status === "changes_requested") return { output: { decision: "waiting", mode: s.site.review_mode }, status: "waiting" };
  const ready = !!item.lint_passed && !!item.fact_check_passed && item.unverifiable_claims === 0;
  if (s.site.review_mode === "autopilot" && ready) {
    await tx(s, async (t) => {
      await t.action("content.autopilot");
      await addReview(t, s.ctx.workspaceId, item.id, item.version, "autopilot", "Approved by autopilot: lint and fact-check passed.", s.ctx.actorId, "system");
      await setStatus(t, item.id, "approved", "Approved by autopilot.");
    });
    return { output: { decision: "approved", mode: "autopilot", note: AUTOPILOT_WARNING } };
  }
  const why = s.site.review_mode === "autopilot" ? "Autopilot is on, but lint or fact-check did not pass: held for a person." : "Approval required (the site's review mode).";
  const title = `Review: ${item.title || item.primary_keyword || "an article"}`;
  const sent = await tx(s, async (t) => {
    await t.action("content.review_request");
    await setStatus(t, item.id, "awaiting_review", why);
    const users = await approvers(t, s.ctx.workspaceId);
    const ws = await t.one<{ slug: string }>("SELECT slug FROM auth_organization WHERE id = $1", [s.ctx.workspaceId]);
    const href = `/w/${ws.slug}/content/${item.id}`;
    await notify(t, s.ctx.workspaceId, users, { kind: "review", title, body: `${s.site.domain} · goes live ${item.publish_date ?? ""}`, href });
    const emails = (await t.many<{ email: string }>("SELECT email FROM auth_user WHERE id = ANY($1::uuid[])", [users])).map((u) => u.email);
    return { emails, href };
  });
  // the email is a courtesy: a mail failure never fails the step (the in-app notification is already there)
  for (const to of sent.emails) {
    await s.deps
      .mail({ to, kind: "review-request", subject: `${title} (${s.site.domain})`, text: `An article for ${s.site.domain} is waiting for review.\n\n${why}\n\nOpen it: ${s.deps.baseUrl}${sent.href}\n` })
      .catch((e: unknown) => s.deps.log.warn("review request email failed", { err: e instanceof Error ? e.message : String(e) }));
  }
  return { output: { decision: "waiting", mode: s.site.review_mode, reason: why, lintPassed: item.lint_passed, factCheckPassed: item.fact_check_passed }, status: "waiting" };
}

// ---------------------------------------------------------------- 9. publish
export function readingMinutes(words: number) {
  return Math.max(1, Math.round(words / 220));
}

export async function buildArticle(s: Pick<StepContext, "deps" | "ctx" | "site">, item: ContentItem, publishDate: string, pattern: string): Promise<PublishableArticle> {
  const author = item.author_id ? await withWorkspace(s.deps.db, s.ctx, (t) => t.maybe<{ name: string; role: string }>("SELECT name, role FROM authors WHERE id = $1", [item.author_id]), { readOnly: true }) : null;
  const a = analyzeMarkdown(item.body_md);
  const path = pagePath(pattern, item.slug!);
  const brief = (item.brief ?? {}) as { tags?: string[] };
  return {
    id: item.id,
    slug: item.slug!,
    title: item.title,
    description: item.description,
    bodyMd: item.body_md,
    date: publishDate,
    keyword: item.primary_keyword ?? "",
    secondaryKeywords: item.secondary_keywords,
    tags: (brief.tags ?? []).slice(0, 8),
    cluster: item.cluster,
    readingMinutes: readingMinutes(a.words),
    words: a.words,
    cover: { kind: String(item.cover.kind ?? ""), chips: Array.isArray(item.cover.chips) ? item.cover.chips.map(String) : [] },
    author: author ? { name: author.name, role: author.role } : null,
    path,
    url: `https://${s.site.domain}${path}`,
    sources: item.sources.map((x) => ({ claim: x.claim, url: x.url })),
    version: item.version,
    updated: localParts(s.deps.now(), s.site.timezone).date,
  };
}

export async function stepPublish(s: StepContext): Promise<StepResult> {
  const item = await tx(s, (t) => getItem(t, s.item.id), true);
  if (item.status === "published") return { output: { already: true, liveUrl: item.live_url } };
  if (item.status !== "approved" && item.status !== "publishing") throw new StepError(`The article is ${item.status.replace(/_/g, " ")}, not approved.`);
  if (s.deps.now() < item.slot_at) return { output: { scheduledFor: item.slot_at.toISOString() }, status: "waiting", deferUntil: item.slot_at };
  // the same gates again, at the last moment: an edit after approval re-runs them
  if (!item.lint_passed) throw new StepError("Lint has failing rules: fix them before this can publish.");
  if (!item.fact_check_passed || item.unverifiable_claims > 0) throw new StepError(`${item.unverifiable_claims || "Some"} unverifiable claim(s): every claim needs a primary source or must be removed before publishing.`);
  if (!s.site.publish_connection_id) throw new StepError("No publishing connection is set for this site.");
  if (!s.deps.keyring) throw new StepError("Encryption keys are not configured on the worker: credentials cannot be read.");
  const publishDate = publishDateOf({ ...s, item });
  const { conn, publisher } = await tx(s, (t) => publisherFor(t, s.deps.keyring!, s.ctx.workspaceId, s.site.publish_connection_id!, { domain: s.site.domain }, s.deps.outbound, s.deps.publisherFactory ?? createPublisher), true);
  const article = await buildArticle(s, item, publishDate, livePathPattern(conn));
  const refreshPub = item.refresh_of
    ? await tx(s, (t) => t.maybe<{ path: string | null; remote_id: string | null; branch: string | null; pr_number: number | null; commit_sha: string | null }>("SELECT path, remote_id, branch, pr_number, commit_sha FROM publications WHERE item_id = $1 AND status IN ('open', 'merged', 'published') ORDER BY created_at DESC LIMIT 1", [item.refresh_of]), true)
    : null;
  await tx(s, async (t) => {
    await t.action("content.publish_start");
    if (item.status !== "publishing") await setStatus(t, item.id, "publishing", `Publishing through ${conn.label}.`);
  });
  let result;
  try {
    result = refreshPub
      ? await publisher.update(article, { path: refreshPub.path, remoteId: refreshPub.remote_id, branch: refreshPub.branch, prNumber: refreshPub.pr_number, commitSha: refreshPub.commit_sha })
      : await publisher.publish(article);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await tx(s, async (t) => {
      await t.action("content.publish_failed");
      await t.exec(
        "INSERT INTO publications (workspace_id, site_id, item_id, connection_id, publisher, mode, action, status, error) VALUES ($1, $2, $3, $4, $5, $6, $7, 'failed', $8)",
        [s.ctx.workspaceId, s.site.id, item.id, conn.id, publisher.kind, conn.kind === "webhook" ? "webhook" : conn.config.mode === "commit" ? "commit" : "pr", refreshPub ? "update" : "publish", msg.slice(0, 2000)],
      );
      await setStatus(t, item.id, "approved", `Publishing failed: ${msg}`.slice(0, 500));
    });
    throw new StepError(`Publishing failed: ${msg}`, (e as { opts?: { retryable?: boolean } }).opts?.retryable ?? false);
  }
  const pubId = await tx(s, async (t) => {
    await t.action("content.publish");
    const p = await t.one<{ id: string }>(
      `INSERT INTO publications (workspace_id, site_id, item_id, connection_id, publisher, mode, action, status, remote_id, path, branch, commit_sha, pr_number, pr_url, live_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [s.ctx.workspaceId, s.site.id, item.id, conn.id, publisher.kind, result.mode, refreshPub ? "update" : "publish", result.status, result.remoteId, result.path ?? null, result.branch ?? null, result.commitSha && /^[0-9a-f]{7,64}$/.test(result.commitSha) ? result.commitSha : null, result.prNumber ?? null, result.prUrl ?? null, result.liveUrl],
    );
    await setStatus(t, item.id, "published", result.detail, { published_at: s.deps.now(), live_url: result.liveUrl, publish_date: publishDate });
    return p.id;
  });
  return { input: { connection: conn.label, publisher: publisher.kind, path: result.path ?? null, publishDate }, output: { status: result.status, mode: result.mode, prUrl: result.prUrl ?? null, prNumber: result.prNumber ?? null, path: result.path ?? null, branch: result.branch ?? null, liveUrl: result.liveUrl, detail: result.detail, publicationId: pubId } };
}

// ---------------------------------------------------------------- 10. after publishing
/** Phase 5 hook: social derivatives. Recorded so the run shows where they will come from. */
export const AFTER_PUBLISH_HOOKS: { name: string; run: (s: StepContext, item: ContentItem) => Promise<string> }[] = [
  { name: "social derivatives", run: async () => "Phase 5: LinkedIn, Facebook, X, Instagram and Google Business Profile drafts are written here once a provider is chosen (owner decision #4)." },
];

export async function stepAfter(s: StepContext): Promise<StepResult> {
  const item = await tx(s, (t) => getItem(t, s.item.id), true);
  const market = marketFor(s.site);
  const pub = await tx(s, (t) => t.maybe<{ id: string; status: string; mode: string; pr_url: string | null }>("SELECT id, status, mode, pr_url FROM publications WHERE item_id = $1 ORDER BY created_at DESC LIMIT 1", [item.id]), true);
  // rule 12: the target keyword goes into rank tracking (checked on the site's rank cadence, lib/measure/rank.ts)
  await tx(s, async (t) => {
    await t.action("content.after_publish");
    if (item.primary_keyword) {
      await t.exec(
        `INSERT INTO rank_tracking_queue (workspace_id, site_id, item_id, keyword, market) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (site_id, keyword, market) DO UPDATE SET item_id = EXCLUDED.item_id, status = 'queued'`,
        [s.ctx.workspaceId, s.site.id, item.id, item.primary_keyword, market.label],
      );
      await t.exec("UPDATE keywords SET status = 'published' WHERE site_id = $1 AND keyword = $2 AND status IN ('idea', 'targeted')", [s.site.id, item.primary_keyword]);
    }
  });
  // live URL: a pull request goes live only after it is merged and deployed
  let live: { status: number | null; ok: boolean; note: string } = { status: null, ok: false, note: "" };
  if (pub?.status === "open") live = { status: null, ok: false, note: `Waiting for the pull request to be merged and deployed${pub.pr_url ? ` (${pub.pr_url})` : ""}; checked again in an hour and a day.` };
  else if (item.live_url) {
    const r = await s.deps.fetcher.checkLink(item.live_url);
    live = { status: r.status, ok: r.ok, note: r.ok ? "The live URL answers 200." : `The live URL answered ${r.status ?? r.error ?? "nothing"}; checked again later.` };
    if (pub) await tx(s, async (t) => { await t.action("content.live_check"); await t.exec("UPDATE publications SET live_status = $2, live_checked_at = $3 WHERE id = $1", [pub.id, r.status, s.deps.now()]); });
  }
  let inspection: Record<string, unknown> | null = null;
  if (s.deps.google && item.live_url && live.ok) {
    try {
      inspection = await inspectUrl(s.deps.google, s.ctx, s.site.id, item.live_url);
      if (inspection && pub) await tx(s, async (t) => { await t.action("content.url_inspection"); await t.exec("UPDATE publications SET indexing = $2::jsonb WHERE id = $1", [pub.id, JSON.stringify(inspection)]); });
    } catch (e) {
      inspection = { error: e instanceof Error ? e.message.slice(0, 200) : "failed" };
    }
  }
  const hooks: { name: string; result: string }[] = [];
  for (const h of AFTER_PUBLISH_HOOKS) hooks.push({ name: h.name, result: await h.run(s, item) });
  for (const hours of [1, 24]) {
    await s.deps.enqueue(QUEUES.postPublish, { workspaceId: s.ctx.workspaceId, siteId: s.site.id, itemId: item.id, hours }, { startAfter: new Date(s.deps.now().getTime() + hours * 3_600_000), singletonKey: `${item.id}:${hours}` });
  }
  await s.deps.enqueue(QUEUES.plan, { workspaceId: s.ctx.workspaceId, siteId: s.site.id }, { singletonKey: `plan:${s.site.id}` });
  return {
    output: {
      rankTracking: item.primary_keyword ? `“${item.primary_keyword}” queued for rank tracking (${market.label}); checked on the site's rank cadence, priced first.` : "No keyword to track.",
      liveUrl: item.live_url,
      live,
      searchConsole: inspection ?? (s.deps.google ? "Inspected once the URL is live." : "Search Console is not configured: no URL inspection."),
      hooks,
      runway: "Recomputed by the site plan job.",
    },
  };
}

export const STEP_FNS: Record<StepKey, (s: StepContext) => Promise<StepResult>> = {
  context: stepContext,
  scan: stepScan,
  topic: stepTopic,
  brief: stepBrief,
  draft: stepDraft,
  factcheck: stepFactcheck,
  lint: stepLint,
  review: stepReview,
  publish: stepPublish,
  after: stepAfter,
};

