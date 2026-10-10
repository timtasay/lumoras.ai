/**
 * THE metered call path (rule 11, section 4). Every SeoDataProvider call in
 * the product goes through meteredCall(); nothing else calls a provider.
 *
 *   1. Estimate the cost first (provider.estimateCost: the price table, or a
 *      provider quote where the provider has one).
 *   2. Look in the workspace's cache (provider + operation + normalised
 *      parameters, unexpired). A hit calls nothing, costs nothing, and is
 *      recorded as a zero-cost "cached" ledger entry and research-log line.
 *      (The cache is consulted before the budget because a hit spends
 *      nothing: a workspace below its reserve can still re-read what it
 *      already bought.)
 *   3. Check the provider's account balance where the provider can tell.
 *   4. Reserve: in one transaction holding a per-workspace, per-category
 *      advisory lock, compute this month's used amount (settled + held),
 *      refuse if the estimate would take the workspace below its reserve,
 *      otherwise insert a HOLD for the estimate. Two concurrent calls
 *      serialise on the lock and the second sees the first's hold, so they
 *      cannot both pass a check only one fits.
 *   5. Call the provider (no transaction held open while it works).
 *   6. Settle, in one transaction: the hold becomes the actual charge (what
 *      the provider says it billed, else the estimate), the research log
 *      line is written, the result cached, and the audit trail written by
 *      the triggers; all commit or roll back together. A failed call is
 *      released (or charged what the provider says it billed anyway).
 * A refusal is written to the research log and the audit log, then thrown.
 * A hold whose settle never happened (a crash mid-call) is settled at its
 * estimate after an hour: the budget errs towards counting money as spent.
 */
import type pg from "pg";
import { withWorkspace, type TenantContext, type Tx } from "../db/tenant.ts";
import { cacheKey, canonicalParams, marketOf, OPERATION_POLICY, periodOf, subjectOf, type Category } from "../providers/operations.ts";
import { invoke, ProviderError, type Operation, type OperationName, type OperationOf, type OperationResults, type SeoDataProvider } from "../providers/types.ts";
import { normalizeKeyword } from "../research/keywords.ts";
import { budgetState, decide, REFUSAL_TEXT, type BudgetRow, type BudgetState, type Refusal } from "./budget.ts";

export type MeterDeps = {
  db: pg.Pool;
  provider: SeoDataProvider;
  now?: () => Date;
  /** Holds older than this are settled at their estimate (default one hour). */
  staleHoldMs?: number;
  /**
   * Tests only: runs inside the reservation, after the budget was read and
   * before the hold is written, to widen the window in which two concurrent
   * calls could both pass a check only one fits.
   */
  afterBudgetRead?: () => Promise<void>;
};
export type MeterContext = TenantContext & { siteId: string };

export class BudgetRefusedError extends Error {
  constructor(
    public readonly reason: Refusal | "provider_balance" | "price_changed",
    public readonly operation: OperationName,
    public readonly estimateMicros: number,
    public readonly state: BudgetState | null,
  ) {
    super(REFUSAL_TEXT[reason]);
    this.name = "BudgetRefusedError";
  }
}

export type MeterResult<K extends OperationName> = {
  status: "ok" | "cached";
  data: OperationResults[K];
  costMicros: number;
  estimateMicros: number;
  ledgerId: string;
  logId: string;
  /** When the cached result was bought. */
  cachedAt: Date | null;
};

export type MeterOptions<K extends OperationName> = {
  category?: Category;
  /** The estimate the person confirmed: a fresh estimate above it is refused (price_changed). */
  confirmMaxMicros?: number;
  /** Runs inside the settle (or cache-hit) transaction, so follow-up writes commit with the charge. */
  onSettled?: (tx: Tx, data: OperationResults[K], logId: string) => Promise<void>;
};

const LIST_CAP = 500;
/** What the research log keeps of a result: lists capped, everything JSON. */
function forLog(data: unknown): unknown {
  return Array.isArray(data) ? data.slice(0, LIST_CAP) : data;
}
const resultCount = (data: unknown) => (Array.isArray(data) ? data.length : data ? 1 : 0);
const lockKey = (ws: string, c: Category) => `budget:${ws}:${c}`;

// provider balances, re-read at most once a minute per provider instance
const balances = new WeakMap<SeoDataProvider, { micros: number | null; at: number }>();
async function providerBalance(p: SeoDataProvider, now: number): Promise<number | null> {
  const b = balances.get(p);
  if (b && now - b.at < 60_000) return b.micros;
  let micros: number | null = null;
  try {
    micros = (await p.balance()).micros;
  } catch {
    micros = null; // unknown: our own budget still applies
  }
  balances.set(p, { micros, at: now });
  return micros;
}
/** Tests: forget cached provider balances. */
export const forgetBalances = (p: SeoDataProvider) => balances.delete(p);

type Usage = { settled: number; held: number };

/** This month's usage for one category (amounts in the category's unit). */
export async function usageFor(tx: Tx, category: Category, period: string): Promise<Usage> {
  const r = await tx.one<{ settled: string; held: string }>(
    `SELECT coalesce(sum(CASE WHEN status = 'settled' THEN ${category === "social_posts" ? "units" : "cost_micros"} END), 0)::text AS settled,
            coalesce(sum(CASE WHEN status = 'held' THEN ${category === "social_posts" ? "units" : "cost_micros"} END), 0)::text AS held
     FROM usage_ledger WHERE category = $1 AND period = $2`,
    [category, period],
  );
  return { settled: Number(r.settled), held: Number(r.held) };
}

export async function readBudgetState(tx: Tx, category: Category, period: string): Promise<BudgetState> {
  const row = await tx.maybe<{ category: Category; monthly_ceiling: string; reserve: string }>("SELECT category, monthly_ceiling::text, reserve::text FROM budgets WHERE category = $1", [category]);
  const u = await usageFor(tx, category, period);
  const b: BudgetRow | null = row ? { category, monthly_ceiling: Number(row.monthly_ceiling), reserve: Number(row.reserve) } : null;
  return budgetState(category, b, u.settled, u.held);
}

type CacheHit = { result: unknown; created_at: Date; expires_at: Date };
async function cacheLookup(tx: Tx, key: string, now: Date): Promise<CacheHit | null> {
  return tx.maybe<CacheHit>("SELECT result, created_at, expires_at FROM provider_cache WHERE cache_key = $1 AND expires_at > $2", [key, now]);
}

async function writeLog(
  tx: Tx,
  ctx: MeterContext,
  o: Operation,
  provider: string,
  key: string,
  v: { status: "ok" | "cached" | "refused" | "error"; estimate: number; cost: number; data?: unknown; detail?: string | null },
): Promise<string> {
  const r = await tx.one<{ id: string }>(
    `INSERT INTO research_log (workspace_id, site_id, operation, provider, seed, subject, market, params, params_hash, status, estimate_micros, cost_micros, result_count, result, detail, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14::jsonb, $15, $16) RETURNING id`,
    [
      ctx.workspaceId,
      ctx.siteId,
      o.op,
      provider,
      o.op === "keywordIdeas" ? normalizeKeyword(o.params.seed) : null,
      subjectOf(o),
      marketOf(o),
      JSON.stringify(canonicalParams(o)),
      key,
      v.status,
      v.estimate,
      v.cost,
      v.data === undefined ? 0 : resultCount(v.data),
      v.data === undefined ? null : JSON.stringify(forLog(v.data)),
      v.detail ? v.detail.slice(0, 500) : null,
      ctx.actorId,
    ],
  );
  return r.id;
}

/** Prices a call and says what would happen, without calling or holding anything. */
export async function quoteCall(deps: MeterDeps, ctx: MeterContext, o: Operation, category: Category = "seo_credits") {
  const now = (deps.now ?? (() => new Date()))();
  const policy = OPERATION_POLICY[o.op];
  const estimate = policy.free ? { micros: 0, basis: "free" as const, explain: "free" } : await deps.provider.estimateCost(o);
  const key = cacheKey(deps.provider.name, o);
  const { hit, state } = await withWorkspace(
    deps.db,
    ctx,
    async (tx) => ({ hit: policy.ttlHours ? await cacheLookup(tx, key, now) : null, state: await readBudgetState(tx, category, periodOf(now)) }),
    { readOnly: true },
  );
  const balance = estimate.micros > 0 && !hit ? await providerBalance(deps.provider, now.getTime()) : null;
  const decision = hit ? ({ ok: true } as const) : decide(state, estimate.micros);
  const refusal: Refusal | "provider_balance" | null = !decision.ok ? decision.reason : balance !== null && balance < estimate.micros ? "provider_balance" : null;
  return {
    operation: o.op,
    label: policy.label,
    provider: deps.provider.name,
    estimate,
    cached: hit ? { createdAt: hit.created_at, expiresAt: hit.expires_at } : null,
    budget: state,
    providerBalanceMicros: balance,
    refusal,
    refusalText: refusal ? REFUSAL_TEXT[refusal] : null,
  };
}
export type Quote = Awaited<ReturnType<typeof quoteCall>>;

export async function meteredCall<K extends OperationName>(deps: MeterDeps, ctx: MeterContext, o: OperationOf<K>, opts: MeterOptions<K> = {}): Promise<MeterResult<K>> {
  const op = o as Operation;
  const clock = deps.now ?? (() => new Date());
  const category = opts.category ?? "seo_credits";
  const policy = OPERATION_POLICY[op.op];
  const p = deps.provider;
  const key = cacheKey(p.name, op);

  // 1. price first
  const estimate = policy.free ? 0 : (await p.estimateCost(op)).micros;
  // 2. the cache: a hit is free, logged, and never reaches the provider
  if (policy.ttlHours) {
    const now = clock();
    const hit = await withWorkspace(deps.db, ctx, async (tx) => {
      const c = await cacheLookup(tx, key, now);
      if (!c) return null;
      await tx.action("research.cached");
      const data = c.result as OperationResults[K];
      const logId = await writeLog(tx, ctx, op, p.name, key, { status: "cached", estimate, cost: 0, data, detail: `from the cache (bought ${c.created_at.toISOString().slice(0, 10)})` });
      const l = await tx.one<{ id: string }>(
        `INSERT INTO usage_ledger (workspace_id, site_id, category, operation, provider, period, status, cached, units, estimate_micros, cost_micros, research_log_id, actor_id, settled_at, detail)
         VALUES ($1, $2, $3, $4, $5, $6, 'settled', true, 0, $7, 0, $8, $9, now(), 'cache hit: no provider call') RETURNING id::text`,
        [ctx.workspaceId, ctx.siteId, category, op.op, p.name, periodOf(now), estimate, logId, ctx.actorId],
      );
      if (opts.onSettled) await opts.onSettled(tx, data, logId);
      return { data, logId, ledgerId: l.id, createdAt: c.created_at };
    });
    if (hit) return { status: "cached", data: hit.data, costMicros: 0, estimateMicros: estimate, ledgerId: hit.ledgerId, logId: hit.logId, cachedAt: hit.createdAt };
  }

  // the person confirmed a price: a fresh estimate above it is refused (a cache hit above was free anyway)
  if (opts.confirmMaxMicros !== undefined && estimate > opts.confirmMaxMicros) {
    await withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action("research.refuse");
      await writeLog(tx, ctx, op, p.name, key, { status: "refused", estimate, cost: 0, detail: REFUSAL_TEXT.price_changed });
    });
    throw new BudgetRefusedError("price_changed", op.op, estimate, null);
  }

  // 3. the provider's own balance, where it can tell
  if (estimate > 0) {
    const bal = await providerBalance(p, clock().getTime());
    if (bal !== null && bal < estimate) {
      await withWorkspace(deps.db, ctx, async (tx) => {
        await tx.action("research.refuse");
        await writeLog(tx, ctx, op, p.name, key, { status: "refused", estimate, cost: 0, detail: REFUSAL_TEXT.provider_balance });
        await tx.event("research.refused", "usage_ledger", null, { operation: op.op, reason: "provider_balance", estimate_micros: estimate });
      });
      throw new BudgetRefusedError("provider_balance", op.op, estimate, null);
    }
  }

  // 4. reserve: lock, check budget and reserve, hold the estimate
  const period = periodOf(clock());
  type Reserved = { kind: "refused"; reason: Refusal; state: BudgetState } | { kind: "held"; ledgerId: string; projectId: string | null };
  const reserved = await withWorkspace(deps.db, ctx, async (tx): Promise<Reserved> => {
    await tx.action("research.hold");
    await tx.exec("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey(ctx.workspaceId, category)]);
    // a hold that was never settled (crash mid-call) counts as spent at its estimate
    await tx.exec(
      `UPDATE usage_ledger SET status = 'settled', settled_at = now(), detail = 'stale hold settled at its estimate (the call may have been billed)'
       WHERE status = 'held' AND category = $1 AND created_at < $2`,
      [category, new Date(clock().getTime() - (deps.staleHoldMs ?? 3_600_000))],
    );
    const state = await readBudgetState(tx, category, period);
    if (deps.afterBudgetRead) await deps.afterBudgetRead();
    const d = decide(state, estimate);
    if (!d.ok) {
      await tx.action("research.refuse");
      await writeLog(tx, ctx, op, p.name, key, { status: "refused", estimate, cost: 0, detail: REFUSAL_TEXT[d.reason] });
      await tx.event("research.refused", "usage_ledger", null, { operation: op.op, reason: d.reason, estimate_micros: estimate, available_micros: state.available, reserve_micros: state.reserve });
      return { kind: "refused", reason: d.reason, state };
    }
    const l = await tx.one<{ id: string }>(
      `INSERT INTO usage_ledger (workspace_id, site_id, category, operation, provider, period, status, estimate_micros, cost_micros, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'held', $7, $7, $8) RETURNING id::text`,
      [ctx.workspaceId, ctx.siteId, category, op.op, p.name, period, estimate, ctx.actorId],
    );
    // OpenSEO: the site's own project (a site setting), read under the workspace's RLS
    const proj = p.name === "openseo" && ctx.siteId ? await tx.maybe<{ id: string | null }>("SELECT openseo_project_id AS id FROM sites WHERE id = $1", [ctx.siteId]) : null;
    return { kind: "held", ledgerId: l.id, projectId: proj?.id ?? null };
  });
  if (reserved.kind === "refused") throw new BudgetRefusedError(reserved.reason, op.op, estimate, reserved.state);
  const ledgerId = reserved.ledgerId;

  // 5. the call, outside any transaction
  let res: Awaited<ReturnType<typeof invoke<K>>>;
  try {
    res = await invoke(p, o, { projectId: reserved.projectId });
  } catch (e) {
    const known = e instanceof ProviderError;
    const billed = known ? Math.max(0, e.opts.billedMicros ?? 0) : estimate;
    const detail = known ? e.message : "the provider call failed unexpectedly; charged at the estimate";
    await withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action("research.fail");
      const logId = await writeLog(tx, ctx, op, p.name, key, { status: "error", estimate, cost: billed, detail });
      await tx.exec(
        `UPDATE usage_ledger SET status = $2, cost_micros = $3, settled_at = now(), research_log_id = $4, detail = $5 WHERE id = $1 AND status = 'held'`,
        [ledgerId, billed > 0 ? "settled" : "released", billed, logId, billed > 0 ? "failed call, billed by the provider" : "failed call, nothing billed"],
      );
    });
    throw e;
  }

  // 6. settle: charge, log, cache and audit in one transaction
  const cost = res.costMicros ?? estimate;
  // the provider's own label wins (e.g. OpenSEO: "provider-reported: … credits" or "estimate: …"), so the ledger says where the number came from
  const over = res.costMicros !== null && res.costMicros > estimate ? "provider charged more than the estimate" : null;
  const detail = res.costDetail ? (over ? `${res.costDetail}; ${over}` : res.costDetail) : res.costMicros === null ? "cost not reported by the provider; charged at the estimate" : over;
  const settled = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("research.settle");
    const logId = await writeLog(tx, ctx, op, p.name, key, { status: "ok", estimate, cost, data: res.data, detail });
    const n = await tx.exec(
      `UPDATE usage_ledger SET status = 'settled', cost_micros = $2, units = $3, settled_at = now(), research_log_id = $4, detail = $5 WHERE id = $1 AND status = 'held'`,
      [ledgerId, cost, Math.max(0, Math.round(res.units)), logId, detail],
    );
    if (n !== 1) {
      // settled meanwhile as stale (a call slower than staleHoldMs): record the real charge beside it
      await tx.exec(
        `INSERT INTO usage_ledger (workspace_id, site_id, category, operation, provider, period, status, units, estimate_micros, cost_micros, research_log_id, actor_id, settled_at, detail)
         VALUES ($1, $2, $3, $4, $5, $6, 'settled', $7, 0, $8, $9, $10, now(), 'difference after a stale hold')`,
        [ctx.workspaceId, ctx.siteId, category, op.op, p.name, period, Math.max(0, Math.round(res.units)), Math.max(0, cost - estimate), logId, ctx.actorId],
      );
    }
    if (policy.ttlHours) {
      const now = clock();
      await tx.exec(
        `INSERT INTO provider_cache (workspace_id, cache_key, operation, provider, params, result, cost_micros, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
         ON CONFLICT (workspace_id, cache_key) DO UPDATE SET result = EXCLUDED.result, cost_micros = EXCLUDED.cost_micros, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`,
        [ctx.workspaceId, key, op.op, p.name, JSON.stringify(canonicalParams(op)), JSON.stringify(res.data), cost, now, new Date(now.getTime() + policy.ttlHours * 3_600_000)],
      );
    }
    if (opts.onSettled) await opts.onSettled(tx, res.data, logId);
    return { logId };
  });
  return { status: "ok", data: res.data, costMicros: cost, estimateMicros: estimate, ledgerId, logId: settled.logId, cachedAt: null };
}
