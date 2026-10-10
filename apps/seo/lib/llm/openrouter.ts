/**
 * OpenRouter behind LlmProvider (owner decision, 10 October 2026: model
 * usage goes through Lumoras's OpenRouter account instead of an Anthropic
 * API key). OpenRouter's chat completions API (OpenAI-compatible; docs read
 * 10 October 2026, see docs/external-apis.md):
 *
 *   POST {base}/chat/completions   Authorization: Bearer <OPENROUTER_API_KEY>
 *
 *   - Models are OpenRouter slugs: anthropic/claude-sonnet-5.5 (drafting),
 *     anthropic/claude-opus-5.5 (topic choice, fact-checking).
 *   - Reasoning: `reasoning: { effort }`; the assistant message comes back
 *     with `reasoning_details`, and the whole message is replayed unmodified
 *     on the next turn, as OpenRouter requires for Claude tool loops.
 *   - Prompt caching: the system prompt is one text part with
 *     cache_control (ephemeral, 5 minutes); tools are sent in a fixed order.
 *   - Tools: function tools with strict JSON schemas, tool_choice "auto".
 *     Our tool results become `tool` messages right after the assistant turn.
 *   - Structured output: response_format json_schema (strict).
 *   - provider.require_parameters: only providers that honour tools,
 *     response_format and reasoning are routed to.
 *   - Cost: usage.cost (credits = US dollars) is what OpenRouter charged;
 *     the ledger settles at it. Token counts are kept for reporting.
 */
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse, type TextBlock, type ToolUseBlock } from "./types.ts";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export type OpenRouterConfig = {
  apiKey: string;
  baseURL?: string;
  timeoutMs?: number;
  /** Shown in OpenRouter's activity log (HTTP-Referer / X-Title). */
  appUrl?: string;
  appTitle?: string;
  fetch?: typeof fetch;
};

/** Our conversation in OpenRouter's message format. */
export function toOpenRouterMessages(req: Pick<LlmRequest, "system" | "messages">): Json[] {
  const out: Json[] = [{ role: "system", content: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }] }];
  for (const m of req.messages) {
    if (m.role === "assistant") {
      // the provider's own assistant message, replayed unmodified (reasoning_details included)
      for (const r of m.replay) out.push(obj(r));
      continue;
    }
    if (typeof m.content === "string") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    // tool results first (they must follow the assistant's tool calls), then any text
    const texts: string[] = [];
    for (const b of m.content) {
      if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.is_error ? `Error: ${b.content}` : b.content });
      else texts.push(b.text);
    }
    if (texts.length) out.push({ role: "user", content: texts.join("\n\n") });
  }
  return out;
}

export function toOpenRouterRequest(req: LlmRequest): Json {
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    reasoning: { effort: req.effort ?? "high" },
    messages: toOpenRouterMessages(req),
    ...(req.tools?.length
      ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema, strict: true } })), tool_choice: "auto" }
      : {}),
    ...(req.outputSchema ? { response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: req.outputSchema } } } : {}),
    usage: { include: true },
    provider: { require_parameters: true },
  };
}

/** OpenRouter's response in our shape. `cost` is US dollars; it becomes the turn's reported cost. */
export function fromOpenRouterResponse(req: Pick<LlmRequest, "model">, body: unknown): LlmResponse {
  const j = obj(body);
  const choice = obj(Array.isArray(j.choices) ? j.choices[0] : null);
  const err = obj(choice.error);
  if (Object.keys(err).length) throw new LlmError(`The model provider failed: ${String(err.message ?? err.code ?? "error").slice(0, 300)}`, { retryable: true });
  const msg = obj(choice.message);
  const content: (TextBlock | ToolUseBlock)[] = [];
  if (typeof msg.content === "string" && msg.content) content.push({ type: "text", text: msg.content });
  for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
    const t = obj(tc), f = obj(t.function);
    let input: unknown = {};
    try {
      input = typeof f.arguments === "string" && f.arguments.trim() ? JSON.parse(f.arguments) : obj(f.arguments);
    } catch {
      input = { _unparsed: String(f.arguments).slice(0, 2000) };
    }
    content.push({ type: "tool_use", id: String(t.id ?? ""), name: String(f.name ?? ""), input });
  }
  const fr = String(choice.finish_reason ?? ""), native = String(choice.native_finish_reason ?? "");
  const stopReason: LlmResponse["stopReason"] =
    native === "refusal" || fr === "content_filter" ? "refusal" : fr === "tool_calls" ? "tool_use" : fr === "length" ? "max_tokens" : fr === "stop" ? (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn") : "other";
  if (fr === "error") throw new LlmError("The model provider reported an error mid-answer; the step will retry.", { retryable: true });
  const u = obj(j.usage), pd = obj(u.prompt_tokens_details);
  const cacheRead = num(pd.cached_tokens), cacheWrite = num(pd.cache_write_tokens);
  const usage = { input: Math.max(0, num(u.prompt_tokens) - cacheRead - cacheWrite), output: num(u.completion_tokens), cacheRead, cacheWrite };
  const cost = typeof u.cost === "number" && Number.isFinite(u.cost) && u.cost >= 0 ? Math.ceil(u.cost * 1_000_000) : null;
  // replay the assistant message exactly as received (content, tool_calls, reasoning_details)
  const replay = [{ role: "assistant", content: msg.content ?? null, ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}), ...(msg.reasoning_details ? { reasoning_details: msg.reasoning_details } : {}) }];
  return { model: typeof j.model === "string" && j.model ? j.model : req.model, content, replay, stopReason, usage, billed: [{ model: req.model, ...usage }], ...(cost !== null ? { reportedCostMicros: cost } : {}) };
}

export class OpenRouterLlm implements LlmProvider {
  readonly name = "openrouter" as const;
  readonly label = "OpenRouter";
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(private readonly cfg: OpenRouterConfig) {
    this.base = (cfg.baseURL ?? OPENROUTER_BASE_URL).replace(/\/+$/, "");
    this.f = cfg.fetch ?? fetch;
  }

  async turn(req: LlmRequest): Promise<LlmResponse> {
    if (req.maxTokens > 16_000) throw new LlmError("max_tokens above 16,000 needs streaming; keep turns smaller");
    let res: Response;
    try {
      res = await this.f(`${this.base}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          "content-type": "application/json",
          ...(this.cfg.appUrl ? { "HTTP-Referer": this.cfg.appUrl } : {}),
          "X-Title": this.cfg.appTitle ?? "Lumoras Growth",
        },
        body: JSON.stringify(toOpenRouterRequest(req)),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 600_000),
      });
    } catch (e) {
      throw new LlmError(`The model provider could not be reached (${e instanceof Error ? e.name : "error"}); the step will retry.`, { retryable: true });
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const m = String(obj(obj(body).error).message ?? "").slice(0, 300);
      if (res.status === 401 || res.status === 403) throw new LlmError("The OpenRouter API key was rejected (OPENROUTER_API_KEY).");
      if (res.status === 402) throw new LlmError("The OpenRouter account is out of credits. Add credits at openrouter.ai, then retry the step.");
      if (res.status === 408 || res.status === 429 || res.status >= 500) throw new LlmError(`The model provider is busy or unavailable (${res.status}); the step will retry.`, { retryable: true });
      throw new LlmError(`The model provider refused the request (${res.status})${m ? `: ${m}` : ""}`);
    }
    return fromOpenRouterResponse(req, body);
  }
}
