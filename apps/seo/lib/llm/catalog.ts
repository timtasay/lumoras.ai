/**
 * The models an admin can choose from (Agency → Models).
 *
 * OpenRouter: its public model list (GET {base}/models, no key needed), kept
 * to models that support everything the pipeline sends: tools, a JSON-schema
 * answer and reasoning. Prices come back in USD per token; we show and store
 * USD per million. Cached for an hour per process.
 *
 * Anthropic: the Claude models in our price table. Fake: none (the recorded
 * fixtures ignore the model).
 */
import { DEFAULT_PRICES } from "./prices.ts";
import type { ListedPrice } from "./model-settings.ts";
import { OPENROUTER_BASE_URL } from "./openrouter.ts";

export type CatalogModel = { id: string; name: string; contextLength: number | null; price: ListedPrice };

const REQUIRED = ["tools", "response_format", "reasoning"];
const perMillion = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e6) / 1e6 : null;
};

export function parseOpenRouterModels(body: unknown): CatalogModel[] {
  const data = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data) ? ((body as { data: unknown[] }).data) : [];
  const out: CatalogModel[] = [];
  for (const raw of data) {
    const m = raw as { id?: unknown; name?: unknown; context_length?: unknown; pricing?: Record<string, unknown>; supported_parameters?: unknown };
    if (typeof m.id !== "string" || !/^[a-z0-9-]{1,40}\/[a-z0-9._-]{1,80}$/.test(m.id)) continue; // no ":free" / ":batch" variants
    const params = Array.isArray(m.supported_parameters) ? m.supported_parameters.map(String) : [];
    if (!REQUIRED.every((p) => params.includes(p))) continue;
    const input = perMillion(m.pricing?.prompt), output = perMillion(m.pricing?.completion);
    if (input === null || output === null) continue;
    out.push({
      id: m.id,
      name: typeof m.name === "string" ? m.name.slice(0, 120) : m.id,
      contextLength: typeof m.context_length === "number" ? m.context_length : null,
      price: { input, output, cacheRead: perMillion(m.pricing?.input_cache_read) ?? input, cacheWrite: perMillion(m.pricing?.input_cache_write) ?? input },
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

let cache: { at: number; base: string; models: CatalogModel[] } | null = null;

export async function openRouterCatalog(opts: { baseURL?: string; fetch?: typeof fetch; now?: number } = {}): Promise<CatalogModel[]> {
  const base = (opts.baseURL ?? OPENROUTER_BASE_URL).replace(/\/+$/, "");
  const now = opts.now ?? Date.now();
  if (cache && cache.base === base && now - cache.at < 3_600_000) return cache.models;
  const res = await (opts.fetch ?? fetch)(`${base}/models`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`OpenRouter's model list answered ${res.status}`);
  const models = parseOpenRouterModels(await res.json());
  cache = { at: now, base, models };
  return models;
}

export function anthropicCatalog(): CatalogModel[] {
  return Object.entries(DEFAULT_PRICES)
    .filter(([id]) => id.startsWith("claude-"))
    .map(([id, p]) => ({ id, name: id, contextLength: null, price: { input: p.input / 1e6, output: p.output / 1e6, cacheRead: p.cacheRead / 1e6, cacheWrite: p.cacheWrite / 1e6 } }));
}

/** The catalog for the configured provider, and a note for people when the choice does not apply yet. */
export async function catalogFor(provider: "none" | "fake" | "anthropic" | "openrouter", opts: { baseURL?: string | null; fetch?: typeof fetch } = {}): Promise<{ models: CatalogModel[]; note: string | null }> {
  switch (provider) {
    case "openrouter":
      return { models: await openRouterCatalog({ baseURL: opts.baseURL ?? undefined, fetch: opts.fetch }), note: null };
    case "none":
      return { models: await openRouterCatalog({ fetch: opts.fetch }), note: "No model provider is configured yet (LLM_PROVIDER). These are OpenRouter's models; the choice applies once LLM_PROVIDER=openrouter is set." };
    case "anthropic":
      return { models: anthropicCatalog(), note: "The Anthropic provider is configured, so only Claude models are offered. Switch LLM_PROVIDER to openrouter for every vendor's models." };
    case "fake":
      return { models: anthropicCatalog(), note: "Development: the fake provider answers from recorded fixtures whatever model is chosen. The choice is still saved and shown in each step." };
  }
}

const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2).replace(/\.00$/, "")}` : `$${n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`);
/** "$2 in / $10 out per million tokens" */
export const priceLabel = (p: { input: number; output: number }) => `${usd(p.input)} in / ${usd(p.output)} out per million tokens`;
