/**
 * Which model each pipeline step uses (owner request, 10 October 2026).
 * Platform admins choose per step on Agency → Models; the choice is one
 * platform-wide row read through llm_model_settings() (migration 0011), so a
 * change applies from the next step without a deploy. A step left unset uses
 * the env defaults (LLM_MODEL_DRAFT for brief and draft, LLM_MODEL_REVIEW
 * for topic choice and fact-checking).
 *
 * The chosen models' list prices are stored with the choice, so the budget
 * hold before each turn is sized right; OpenRouter turns still settle at the
 * cost OpenRouter reports.
 */
import type pg from "pg";
import { usd, type PriceTable } from "./prices.ts";
import { modelFor, type LlmModels, type LlmPurpose } from "./types.ts";

export const PURPOSES: { key: LlmPurpose; label: string; hint: string }[] = [
  { key: "topic", label: "Topic choice", hint: "Picks the next article from research. Default: the review model." },
  { key: "brief", label: "Brief", hint: "Plans the article. Default: the draft model." },
  { key: "draft", label: "Draft", hint: "Writes the article. Default: the draft model." },
  { key: "factcheck", label: "Fact-check", hint: "Checks every claim against its source. Default: the review model." },
];

/** USD per million tokens, as the provider lists them. */
export type ListedPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type ModelChoice = { models: Partial<Record<LlmPurpose, string>>; prices: Record<string, ListedPrice> };

const SLUG = /^[a-z0-9-]{1,40}\/[a-z0-9._:-]{1,80}$|^claude-[a-z0-9.-]{1,60}$/;
const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** A stored choice, read defensively: anything malformed is ignored, never guessed at. */
export function parseModelChoice(v: unknown): ModelChoice {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const m = o.models && typeof o.models === "object" ? (o.models as Record<string, unknown>) : {};
  const models: ModelChoice["models"] = {};
  for (const { key } of PURPOSES) if (typeof m[key] === "string" && SLUG.test(m[key] as string)) models[key] = m[key] as string;
  const prices: ModelChoice["prices"] = {};
  const pr = o.prices && typeof o.prices === "object" ? (o.prices as Record<string, Record<string, unknown>>) : {};
  for (const [id, p] of Object.entries(pr)) {
    const input = finite(p?.input), output = finite(p?.output);
    if (!SLUG.test(id) || input === null || output === null) continue;
    prices[id] = { input, output, cacheRead: finite(p.cacheRead) ?? input * 0.1, cacheWrite: finite(p.cacheWrite) ?? input * 1.25 };
  }
  return { models, prices };
}

export async function loadModelChoice(db: Pick<pg.Pool, "query">): Promise<ModelChoice> {
  const r = await db.query<{ v: unknown }>("SELECT llm_model_settings() AS v");
  return parseModelChoice(r.rows[0]?.v);
}

/** The model a step uses: the admin's choice, else the env default for its role. */
export const chosenModel = (choice: ModelChoice, purpose: LlmPurpose, env: LlmModels) => choice.models[purpose] ?? modelFor(purpose, env);

/** The price table with the chosen models' listed prices merged in (they win over the defaults). */
export function pricesWith(base: PriceTable, choice: ModelChoice): PriceTable {
  const t = { ...base };
  for (const [id, p] of Object.entries(choice.prices)) t[id] = usd(p.input, p.output, p.cacheRead, p.cacheWrite);
  return t;
}
