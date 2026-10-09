/**
 * Model usage on the same budget, reserve and ledger as paid SEO data
 * (rule 11; lib/metering/metered.ts is the SEO twin of this file).
 *
 * Every model turn:
 *   1. is priced first: an upper bound from the price table (input at the
 *      higher of input and cache-write rates, plus max_tokens of output);
 *   2. reserves under the per-workspace, per-category advisory lock
 *      (category llm_tokens): this month's settled + held usage, refused
 *      below or across the reserve, else a HOLD for the estimate;
 *   3. calls the provider with no transaction open;
 *   4. settles in one transaction at the real usage (each billed model at its
 *      own price, rounded up to the micro), or releases the hold if the call
 *      failed without being billed.
 * A refusal is written to the audit log and thrown as LlmBudgetRefusedError
 * before anything is called.
 */
import type pg from "pg";
import { withWorkspace, type TenantContext } from "../db/tenant.ts";
import { decide, type BudgetState, type Refusal } from "../metering/budget.ts";
import { readBudgetState } from "../metering/metered.ts";
import { periodOf } from "../providers/operations.ts";
import { costOfTurn, estimateTurn, totalTokens, type PriceTable } from "./prices.ts";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types.ts";

export type LlmDeps = {
  db: pg.Pool;
  llm: LlmProvider;
  prices: PriceTable;
  now?: () => Date;
  staleHoldMs?: number;
};

export type LlmMeterContext = TenantContext & { siteId: string };

export const LLM_REFUSAL_TEXT: Record<Refusal, string> = {
  no_budget: "No monthly budget is set for model usage in this workspace. An owner sets one under Budget and usage.",
  below_reserve: "This workspace is at or below its model-usage reserve for the month, so writing is paused until next month or until an owner raises the budget.",
  would_cross_reserve: "This step would take the workspace below its model-usage reserve. An owner can raise the budget.",
  over_ceiling: "This step would go over the workspace's monthly model-usage ceiling.",
};

export class LlmBudgetRefusedError extends Error {
  constructor(
    public readonly reason: Refusal,
    public readonly estimateMicros: number,
    public readonly state: BudgetState,
  ) {
    super(LLM_REFUSAL_TEXT[reason]);
    this.name = "LlmBudgetRefusedError";
  }
}

export type MeteredTurn = LlmResponse & { costMicros: number; estimateMicros: number; ledgerId: string; tokens: number };

const lockKey = (ws: string) => `budget:${ws}:llm_tokens`;

export async function meteredTurn(deps: LlmDeps, ctx: LlmMeterContext, req: LlmRequest): Promise<MeteredTurn> {
  const clock = deps.now ?? (() => new Date());
  const estimate = estimateTurn(deps.prices, req);
  const period = periodOf(clock());
  const operation = `llm.${req.purpose}`;

  const reserved = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("llm.hold");
    await tx.exec("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey(ctx.workspaceId)]);
    await tx.exec(
      `UPDATE usage_ledger SET status = 'settled', settled_at = now(), detail = 'stale hold settled at its estimate (the call may have been billed)'
       WHERE status = 'held' AND category = 'llm_tokens' AND created_at < $1`,
      [new Date(clock().getTime() - (deps.staleHoldMs ?? 3_600_000))],
    );
    const state = await readBudgetState(tx, "llm_tokens", period);
    const d = decide(state, estimate);
    if (!d.ok) {
      await tx.action("llm.refuse");
      await tx.event("llm.refused", "usage_ledger", null, { operation, model: req.model, reason: d.reason, estimate_micros: estimate, available_micros: state.available, reserve_micros: state.reserve });
      return { kind: "refused" as const, reason: d.reason, state };
    }
    const l = await tx.one<{ id: string }>(
      `INSERT INTO usage_ledger (workspace_id, site_id, category, operation, provider, period, status, estimate_micros, cost_micros, actor_id, detail)
       VALUES ($1, $2, 'llm_tokens', $3, $4, $5, 'held', $6, $6, $7, $8) RETURNING id::text`,
      [ctx.workspaceId, ctx.siteId, operation, deps.llm.name, period, estimate, ctx.actorId, req.model],
    );
    return { kind: "held" as const, ledgerId: l.id };
  });
  if (reserved.kind === "refused") throw new LlmBudgetRefusedError(reserved.reason, estimate, reserved.state);

  let res: LlmResponse;
  try {
    res = await deps.llm.turn(req);
  } catch (e) {
    const billed = e instanceof LlmError && e.opts.billed;
    await withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action("llm.fail");
      await tx.exec(
        `UPDATE usage_ledger SET status = $2, cost_micros = $3, settled_at = now(), detail = $4 WHERE id = $1 AND status = 'held'`,
        [reserved.ledgerId, billed ? "settled" : "released", billed ? estimate : 0, billed ? "failed turn, billed: charged at the estimate" : "failed turn, nothing billed"],
      );
    });
    throw e;
  }

  const cost = costOfTurn(deps.prices, res.billed);
  const tokens = totalTokens(res.usage);
  const models = [...new Set(res.billed.map((b) => b.model))].join(" + ");
  await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("llm.settle");
    const n = await tx.exec(
      `UPDATE usage_ledger SET status = 'settled', cost_micros = $2, units = $3, settled_at = now(), detail = $4 WHERE id = $1 AND status = 'held'`,
      [reserved.ledgerId, cost, tokens, `${models}${cost > estimate ? " · charged more than the estimate" : ""}`.slice(0, 300)],
    );
    if (n !== 1) {
      await tx.exec(
        `INSERT INTO usage_ledger (workspace_id, site_id, category, operation, provider, period, status, units, estimate_micros, cost_micros, actor_id, settled_at, detail)
         VALUES ($1, $2, 'llm_tokens', $3, $4, $5, 'settled', $6, 0, $7, $8, now(), 'difference after a stale hold')`,
        [ctx.workspaceId, ctx.siteId, operation, deps.llm.name, period, tokens, Math.max(0, cost - estimate), ctx.actorId],
      );
    }
  });
  return { ...res, costMicros: cost, estimateMicros: estimate, ledgerId: reserved.ledgerId, tokens };
}
