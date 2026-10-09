"use server";
/**
 * Research, keywords, seed backlog and budget actions. Paid work goes only
 * through the metered path (lib/metering/metered.ts): a quote first (priced,
 * budget and reserve checked, nothing spent), then a confirmed run that
 * refuses if the fresh estimate is above what the person confirmed. Results
 * cross to the browser as plain data; provider credentials never do.
 */
import { revalidatePath } from "next/cache";
import { formObject, inWorkspace, readWorkspace, toActionError, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/db/tenant";
import { addSeeds, deleteKeywords, deleteSeed, KEYWORD_STATUSES, logResult, saveKeywords, setBudget, setKeywordCluster, setKeywordStatus, updateSeed, type KeywordStatus } from "@/lib/data/research";
import { BudgetRefusedError, meteredCall, quoteCall } from "@/lib/metering/metered";
import { CATEGORIES, type Category } from "@/lib/providers/operations";
import { ProviderError, type DomainOverview, type KeywordRow, type SerpItem } from "@/lib/providers/types";
import { researchScope, ProviderMissingError } from "@/lib/research/app";
import { normalizeKeyword } from "@/lib/research/keywords";
import { parseUsd } from "@/lib/research/money";
import { annotate, quoteResearch, runResearch, type AnnotatedRow, type ResearchRequest } from "@/lib/research/service";

export type BudgetView = { ceiling: number; reserve: number; used: number; held: number; available: number; spendable: number; unset: boolean };
export type QuoteView =
  | { ok: true; kind: "logged"; logId: string; lastAt: string; freshUntil: string }
  | {
      ok: true;
      kind: "quote";
      label: string;
      estimateMicros: number;
      explain: string;
      basis: string;
      cachedAt: string | null;
      budget: BudgetView;
      refusal: string | null;
      refusalText: string | null;
    }
  | { ok: false; error: string };

export type RunView =
  | { ok: true; kind: "ideas"; status: "ok" | "cached" | "logged"; logId: string; at: string; costMicros: number; rows: AnnotatedRow[] }
  | { ok: true; kind: "serp"; status: "ok" | "cached"; logId: string; at: string; costMicros: number; items: SerpItem[] }
  | { ok: false; error: string; refusal?: string };

function researchError(e: unknown): { ok: false; error: string; refusal?: string } {
  if (e instanceof BudgetRefusedError) return { ok: false, error: e.message, refusal: e.reason };
  if (e instanceof ProviderMissingError) return { ok: false, error: e.message };
  if (e instanceof ProviderError) return { ok: false, error: `The SEO data provider could not answer: ${e.message.slice(0, 200)}. Nothing was charged unless the provider billed it, and the ledger says so.` };
  const s = toActionError(e);
  return { ok: false, error: s.error ?? "Something went wrong." };
}

function parseRequest(raw: { kind: string; query: string }): ResearchRequest | null {
  const q = normalizeKeyword(String(raw.query ?? ""));
  if (!q || q.length > 80) return null;
  if (raw.kind === "ideas") return { kind: "ideas", seed: q };
  if (raw.kind === "serp") return { kind: "serp", keyword: q };
  return null;
}

const budgetView = (b: { ceiling: number; reserve: number; used: number; held: number; available: number; spendable: number; unset: boolean }): BudgetView => ({
  ceiling: b.ceiling, reserve: b.reserve, used: b.used, held: b.held, available: b.available, spendable: b.spendable, unset: b.unset,
});

export async function quoteResearchAction(slug: string, siteId: string, raw: { kind: string; query: string }): Promise<QuoteView> {
  try {
    const req = parseRequest(raw);
    if (!req) return { ok: false, error: "Enter a seed or keyword of up to 80 characters." };
    const s = await researchScope(slug, siteId, "research:run", { rateLimit: true });
    const q = await quoteResearch(s.deps, s.ctx, s.site, s.market, req);
    if (q.kind === "logged") return { ok: true, kind: "logged", logId: q.logId, lastAt: q.lastAt.toISOString(), freshUntil: q.freshUntil.toISOString() };
    const x = q.quote;
    return {
      ok: true,
      kind: "quote",
      label: x.label,
      estimateMicros: x.cached ? 0 : x.estimate.micros,
      explain: x.estimate.explain,
      basis: x.estimate.basis,
      cachedAt: x.cached?.createdAt.toISOString() ?? null,
      budget: budgetView(x.budget),
      refusal: x.refusal,
      refusalText: x.refusalText,
    };
  } catch (e) {
    return researchError(e);
  }
}

export async function runResearchAction(slug: string, siteId: string, raw: { kind: string; query: string }, confirmMaxMicros: number): Promise<RunView> {
  try {
    const req = parseRequest(raw);
    if (!req) return { ok: false, error: "Enter a seed or keyword of up to 80 characters." };
    if (!Number.isInteger(confirmMaxMicros) || confirmMaxMicros < 0) return { ok: false, error: "Confirm the estimate first." };
    const s = await researchScope(slug, siteId, "research:run", { rateLimit: true });
    const r = await runResearch(s.deps, s.ctx, s.site, s.brand, s.market, req, confirmMaxMicros);
    revalidatePath(`/w/${slug}/sites/${siteId}/keywords`);
    revalidatePath(`/w/${slug}/settings/budget`);
    return r.kind === "ideas"
      ? { ok: true, kind: "ideas", status: r.status, logId: r.logId, at: r.at.toISOString(), costMicros: r.costMicros, rows: r.rows }
      : { ok: true, kind: "serp", status: r.status, logId: r.logId, at: r.at.toISOString(), costMicros: r.costMicros, items: r.items };
  } catch (e) {
    return researchError(e);
  }
}

/** The ideas of a logged research run, annotated (free: reads the log). */
export async function loggedIdeasAction(slug: string, siteId: string, logId: string): Promise<RunView> {
  try {
    if (!isUuid(siteId) || !isUuid(logId)) return { ok: false, error: "Not found." };
    const s = await researchScope(slug, siteId, "site:read", { needProvider: false });
    const r = await readWorkspace(slug, (tx) => logResult<KeywordRow[]>(tx, siteId, logId));
    if (!r || r.operation !== "keywordIdeas") return { ok: false, error: "That research is not in the log." };
    return { ok: true, kind: "ideas", status: "logged", logId, at: r.created_at.toISOString(), costMicros: 0, rows: annotate(r.result, s.brand) };
  } catch (e) {
    return researchError(e);
  }
}

/**
 * Saves chosen ideas. Only keyword strings come from the browser: the
 * metrics are read back from the research log on the server, and rule 7
 * is applied again (a "does not sell" keyword cannot be saved).
 */
export async function saveIdeasAction(slug: string, siteId: string, logId: string, keywords: string[]): Promise<ActionState> {
  try {
    if (!isUuid(siteId) || !isUuid(logId) || !Array.isArray(keywords) || keywords.length > 500) throw new Error("bad request");
    const s = await researchScope(slug, siteId, "keyword:manage", { needProvider: false });
    const wanted = new Set(keywords.map((k) => normalizeKeyword(String(k))));
    const n = await inWorkspace(slug, "keyword:manage", "keyword.save", async (tx, a) => {
      const log = await logResult<KeywordRow[]>(tx, siteId, logId);
      if (!log || log.operation !== "keywordIdeas") throw new Error("That research is not in the log.");
      const rows = annotate(log.result, s.brand).filter((r) => wanted.has(r.keyword) && r.fit !== "not_offered");
      return saveKeywords(
        tx,
        a.workspace.id,
        siteId,
        rows.map((r) => ({ ...r, market: log.market, fit: r.fit, variantKey: r.variantKey, cluster: "", sourceLogId: logId, metricsAt: log.created_at })),
      );
    });
    revalidatePath(`/w/${slug}/sites/${siteId}/keywords`);
    return { ok: true, message: n ? `Saved ${n} keyword${n === 1 ? "" : "s"}.` : "Nothing to save: excluded keywords are never saved.", at: Date.now(), data: { saved: n } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function keywordBulkAction(slug: string, siteId: string, ids: string[], change: { status?: string; cluster?: string; remove?: boolean }): Promise<ActionState> {
  try {
    if (!isUuid(siteId) || !Array.isArray(ids) || !ids.length || ids.length > 1000 || !ids.every(isUuid)) throw new Error("Select keywords first.");
    const n = await inWorkspace(slug, "keyword:manage", change.remove ? "keyword.delete" : "keyword.update", async (tx) => {
      if (change.remove) return deleteKeywords(tx, siteId, ids);
      if (change.status) {
        if (!(KEYWORD_STATUSES as readonly string[]).includes(change.status)) throw new Error("Unknown status.");
        return setKeywordStatus(tx, siteId, ids, change.status as KeywordStatus);
      }
      if (typeof change.cluster === "string") return setKeywordCluster(tx, siteId, ids, change.cluster.trim().slice(0, 80));
      return 0;
    });
    revalidatePath(`/w/${slug}/sites/${siteId}/keywords`);
    const what = change.remove ? "Removed" : change.status ? `Marked ${change.status}:` : "Clustered";
    return { ok: true, message: `${what} ${n} keyword${n === 1 ? "" : "s"}.`, at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------- seed backlog
export async function addSeedsAction(slug: string, siteId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const o = formObject(fd);
    const seeds = [...new Set(String(o.seeds ?? "").split(/[\n,]/).map(normalizeKeyword).filter(Boolean))];
    if (!seeds.length) return { ok: false, error: "Add at least one seed.", fieldErrors: { seeds: "One seed per line" }, at: Date.now() };
    if (seeds.length > 100 || seeds.some((x) => x.length > 80)) return { ok: false, error: "Check the highlighted fields.", fieldErrors: { seeds: "At most 100 seeds of 80 characters" }, at: Date.now() };
    const priority = Math.max(0, Math.min(3, Number(o.priority) || 0));
    const n = await inWorkspace(slug, "keyword:manage", "seed.add", (tx, a) => addSeeds(tx, a.workspace.id, siteId, seeds, priority, a.viewer.user.id));
    revalidatePath(`/w/${slug}/sites/${siteId}/keywords`);
    return { ok: true, message: n ? `Added ${n} seed${n === 1 ? "" : "s"}${n < seeds.length ? ` (${seeds.length - n} already in the backlog)` : ""}.` : "Those seeds are already in the backlog.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateSeedAction(slug: string, siteId: string, id: string, patch: { priority?: number; status?: "queued" | "researched" | "skipped" }): Promise<ActionState> {
  try {
    if (!isUuid(id)) throw new Error("bad seed");
    const p: { priority?: number; status?: "queued" | "researched" | "skipped" } = {};
    if (patch.priority !== undefined) p.priority = Math.max(0, Math.min(3, Math.round(Number(patch.priority))));
    if (patch.status && ["queued", "researched", "skipped"].includes(patch.status)) p.status = patch.status;
    await inWorkspace(slug, "keyword:manage", "seed.update", (tx) => updateSeed(tx, siteId, id, p));
    revalidatePath(`/w/${slug}/sites/${siteId}/keywords`);
    return { ok: true, message: "Seed updated.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteSeedAction(slug: string, siteId: string, id: string): Promise<ActionState> {
  try {
    if (!isUuid(id)) throw new Error("bad seed");
    await inWorkspace(slug, "keyword:manage", "seed.delete", (tx) => deleteSeed(tx, siteId, id));
    revalidatePath(`/w/${slug}/sites/${siteId}/keywords`);
    return { ok: true, message: "Seed removed.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------- domain overview (paid, budgeted)
export type OverviewQuote = { ok: true; estimateMicros: number; explain: string; cachedAt: string | null; budget: BudgetView; refusal: string | null; refusalText: string | null } | { ok: false; error: string };
export type OverviewRun = { ok: true; status: "ok" | "cached"; at: string; costMicros: number; data: DomainOverview } | { ok: false; error: string; refusal?: string };

const overviewOp = (s: Awaited<ReturnType<typeof researchScope>>) => ({ op: "domainOverview" as const, params: { domain: s.site.domain, market: s.market } });

export async function quoteOverviewAction(slug: string, siteId: string): Promise<OverviewQuote> {
  try {
    const s = await researchScope(slug, siteId, "research:run", { rateLimit: true });
    const q = await quoteCall(s.deps, s.ctx, overviewOp(s));
    return { ok: true, estimateMicros: q.cached ? 0 : q.estimate.micros, explain: q.estimate.explain, cachedAt: q.cached?.createdAt.toISOString() ?? null, budget: budgetView(q.budget), refusal: q.refusal, refusalText: q.refusalText };
  } catch (e) {
    return researchError(e);
  }
}

export async function runOverviewAction(slug: string, siteId: string, confirmMaxMicros: number): Promise<OverviewRun> {
  try {
    const s = await researchScope(slug, siteId, "research:run", { rateLimit: true });
    const r = await meteredCall(s.deps, s.ctx, overviewOp(s), { confirmMaxMicros });
    revalidatePath(`/w/${slug}/sites/${siteId}`);
    return { ok: true, status: r.status, at: (r.cachedAt ?? new Date()).toISOString(), costMicros: r.costMicros, data: r.data };
  } catch (e) {
    return researchError(e);
  }
}

// ---------------------------------------------------------------- budget (owners)
export async function setBudgetAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const o = formObject(fd);
    const category = String(o.category) as Category;
    if (!CATEGORIES.includes(category)) throw new Error("Unknown budget category.");
    const posts = category === "social_posts";
    const read = (k: string) => {
      const raw = String(o[k] ?? "").trim();
      if (posts) return /^\d{1,7}$/.test(raw) ? Number(raw) : null;
      return parseUsd(raw);
    };
    const ceiling = read("ceiling"), reserve = read("reserve");
    const fe: Record<string, string> = {};
    if (ceiling === null) fe.ceiling = posts ? "Enter a whole number of posts" : "Enter an amount in US dollars, like 25 or 25.50";
    if (reserve === null) fe.reserve = posts ? "Enter a whole number of posts" : "Enter an amount in US dollars";
    if (ceiling !== null && reserve !== null && reserve > ceiling) fe.reserve = "The reserve cannot be more than the monthly ceiling";
    if (Object.keys(fe).length) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fe, at: Date.now() };
    await inWorkspace(slug, "budget:manage", "budget.update", (tx, a) => setBudget(tx, a.workspace.id, category, ceiling!, reserve!));
    revalidatePath(`/w/${slug}/settings/budget`);
    return { ok: true, message: "Budget saved.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}
