/**
 * Budget and reserve (rule 11), as pure arithmetic. Amounts are in the
 * category's unit: micro-USD for seo_credits and llm_tokens, posts for
 * social_posts (lib/research/money.ts).
 *
 *   used       = this month's settled charges + open holds
 *   available  = ceiling − used
 *   spendable  = ceiling − reserve − used   (what may still be spent)
 *
 * A paid call is allowed only if, after it, `available` would still be at
 * least the reserve: estimate ≤ spendable. A workspace whose available amount
 * is at or below its reserve cannot spend at all. Free calls (estimate 0) are
 * always allowed: they spend nothing.
 */
import type { Category } from "../providers/operations.ts";

export type BudgetRow = { category: Category; monthly_ceiling: number; reserve: number };
export type BudgetState = {
  category: Category;
  ceiling: number;
  reserve: number;
  settled: number;
  held: number;
  used: number;
  available: number;
  spendable: number;
  /** No budget row, or a ceiling of 0. */
  unset: boolean;
};

export function budgetState(category: Category, row: BudgetRow | null, settled: number, held: number): BudgetState {
  const ceiling = row?.monthly_ceiling ?? 0, reserve = row?.reserve ?? 0;
  const used = settled + held;
  return { category, ceiling, reserve, settled, held, used, available: ceiling - used, spendable: Math.max(0, ceiling - reserve - used), unset: ceiling === 0 };
}

export type Refusal = "no_budget" | "below_reserve" | "would_cross_reserve" | "over_ceiling";
export type Decision = { ok: true } | { ok: false; reason: Refusal };

export function decide(s: BudgetState, estimate: number): Decision {
  if (!Number.isFinite(estimate) || estimate < 0) throw new RangeError(`bad estimate ${estimate}`);
  if (estimate === 0) return { ok: true };
  if (s.unset) return { ok: false, reason: "no_budget" };
  if (s.available <= s.reserve) return { ok: false, reason: s.reserve > 0 ? "below_reserve" : "over_ceiling" };
  if (estimate > s.spendable) return { ok: false, reason: s.reserve > 0 ? "would_cross_reserve" : "over_ceiling" };
  return { ok: true };
}

export const REFUSAL_TEXT: Record<Refusal | "provider_balance" | "price_changed", string> = {
  no_budget: "No monthly budget is set for paid SEO data in this workspace. An owner sets one under Budget and usage.",
  below_reserve: "This workspace is at or below its reserve for the month, so paid lookups are paused until next month or until an owner raises the budget.",
  would_cross_reserve: "This lookup would take the workspace below its reserve. Choose a smaller lookup or ask an owner to raise the budget.",
  over_ceiling: "This lookup would go over the workspace's monthly ceiling.",
  provider_balance: "The SEO data provider's account balance is too low for this lookup. Lumoras staff have to top it up.",
  price_changed: "The price went up since you confirmed it. Check the new estimate and confirm again.",
};
