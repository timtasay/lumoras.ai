/**
 * LLM prices and cost accounting (rule 11 for model usage). Integer
 * arithmetic only: prices are micro-US-dollars per million tokens, costs are
 * micro-US-dollars, rounded UP to the next micro once per turn (we never
 * under-count). $4 per million input tokens = 4,000,000 µUSD/MTok = 4 µUSD a
 * token.
 *
 * Defaults are Anthropic's first-party list prices (read 9 October 2026 from
 * the claude-api reference, cached 2026-10-06): Claude Opus 5.5 $4 / $20 per
 * MTok (cache reads $0.20), Claude Sonnet 5.5 $2 / $10 (cache reads $0.20);
 * five-minute cache writes cost 1.25× input. LLM_PRICES_JSON overrides or
 * extends the table without a deploy of code. A model missing from the table
 * is priced at the most expensive entry, so an unknown model can only be
 * over-charged against the budget, never under-charged.
 */
import type { BilledUsage, LlmRequest, LlmUsage } from "./types.ts";

/** µUSD per million tokens. */
export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type PriceTable = Record<string, ModelPrice>;

const usd = (input: number, output: number, cacheRead: number, cacheWrite = input * 1.25): ModelPrice => ({
  input: Math.round(input * 1e6),
  output: Math.round(output * 1e6),
  cacheRead: Math.round(cacheRead * 1e6),
  cacheWrite: Math.round(cacheWrite * 1e6),
});

export const DEFAULT_PRICES: PriceTable = {
  "claude-opus-5-5": usd(4, 20, 0.2),
  "claude-sonnet-5-5": usd(2, 10, 0.2),
  // server-side fallback targets ("default" routing) and earlier models people may configure
  "claude-opus-5": usd(5, 25, 0.5),
  "claude-opus-4-8": usd(5, 25, 0.5),
  "claude-sonnet-5": usd(2, 10, 0.2),
  "claude-haiku-5-5": usd(0.1, 0.5, 0.01),
};

/** LLM_PRICES_JSON: {"model": {"input": 4, "output": 20, "cacheRead": 0.2, "cacheWrite": 5}} in USD per million tokens. */
export function parsePriceTable(raw: string | undefined, problems: string[] = []): PriceTable {
  const table: PriceTable = { ...DEFAULT_PRICES };
  if (!raw?.trim()) return table;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    problems.push("LLM_PRICES_JSON is not valid JSON");
    return table;
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) {
    problems.push("LLM_PRICES_JSON must be an object of model → prices");
    return table;
  }
  for (const [model, p] of Object.entries(j as Record<string, Record<string, unknown>>)) {
    const n = (k: string) => (typeof p?.[k] === "number" && Number.isFinite(p[k] as number) && (p[k] as number) >= 0 ? (p[k] as number) : null);
    const input = n("input"), output = n("output");
    if (input === null || output === null) {
      problems.push(`LLM_PRICES_JSON.${model} needs numeric input and output prices (USD per million tokens)`);
      continue;
    }
    table[model] = usd(input, output, n("cacheRead") ?? input * 0.1, n("cacheWrite") ?? input * 1.25);
  }
  return table;
}

export function priceOf(table: PriceTable, model: string): { price: ModelPrice; known: boolean } {
  const p = table[model];
  if (p) return { price: p, known: true };
  const worst = Object.values(table).reduce((a, b) => (b.output > a.output ? b : a));
  return { price: worst, known: false };
}

/** µUSD for one billed usage, rounded up. */
export function costOf(table: PriceTable, u: BilledUsage): number {
  const { price } = priceOf(table, u.model);
  const millionths = u.input * price.input + u.output * price.output + u.cacheRead * price.cacheRead + u.cacheWrite * price.cacheWrite;
  return Math.ceil(millionths / 1_000_000);
}

export function costOfTurn(table: PriceTable, billed: BilledUsage[]): number {
  return billed.reduce((s, u) => s + costOf(table, u), 0);
}

export const totalTokens = (u: LlmUsage) => u.input + u.output + u.cacheRead + u.cacheWrite;

/** Characters per token used to estimate input before a call: deliberately low (3), so estimates run high. */
const CHARS_PER_TOKEN = 3;

export function estimateInputTokens(req: Pick<LlmRequest, "system" | "messages" | "tools">): number {
  let chars = req.system.length + JSON.stringify(req.tools ?? []).length;
  for (const m of req.messages) chars += m.role === "user" ? (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length) : JSON.stringify(m.replay).length;
  return Math.ceil(chars / CHARS_PER_TOKEN) + 50;
}

/**
 * Upper bound for a turn: every input token at the higher of the input and
 * cache-write rates (the first turn writes the cache), plus max_tokens of output.
 */
export function estimateTurn(table: PriceTable, req: Pick<LlmRequest, "model" | "system" | "messages" | "tools" | "maxTokens">): number {
  const { price } = priceOf(table, req.model);
  const inTok = estimateInputTokens(req);
  return Math.ceil((inTok * Math.max(price.input, price.cacheWrite) + req.maxTokens * price.output) / 1_000_000);
}
