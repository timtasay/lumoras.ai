/**
 * The Anthropic Messages API behind LlmProvider (@anthropic-ai/sdk 0.133.0;
 * usage taken from the claude-api reference, read 9 October 2026, see
 * docs/external-apis.md). Never called in tests or development: no key exists
 * there and LLM_PROVIDER defaults to the fake.
 *
 *   - Models from env: LLM_MODEL_DRAFT (claude-sonnet-5-5) and
 *     LLM_MODEL_REVIEW (claude-opus-5-5). Thinking is adaptive (the only mode
 *     on these models); depth is set with output_config.effort, explicitly,
 *     because Opus 5.5 defaults to "medium".
 *   - Prompt caching: the system prompt is one block with cache_control, and
 *     tool definitions are emitted in a fixed order, so every turn of a tool
 *     loop reads the cached prefix (usage.cache_read_input_tokens).
 *   - Tool use: our own tools only (no server-side web fetch: pages are
 *     fetched by our SSRF-guarded fetcher), strict schemas, tool_choice auto
 *     (forced tool choice is refused by these models). The assistant turn is
 *     replayed verbatim, thinking blocks included, as the API requires.
 *   - Structured output: output_config.format with a JSON schema for the
 *     final answer.
 *   - Refusals: the server-side fallback ("default" routing, beta
 *     server-side-fallback-2026-07-01) re-runs a declined turn on a fallback
 *     model inside the same call; usage.iterations bills each model at its
 *     own price, and we price each entry with its own model. A final
 *     stop_reason of "refusal" means the whole chain declined; the step fails
 *     with that reason.
 *   - Non-streaming: max_tokens stays at or below 16,000 per turn (the SDK's
 *     request timeout is sized for it); the SDK retries 408/409/429/5xx twice.
 */
import Anthropic from "@anthropic-ai/sdk";
import { LlmError, type BilledUsage, type LlmProvider, type LlmRequest, type LlmResponse, type TextBlock, type ToolUseBlock } from "./types.ts";

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AnthropicLlm implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly label = "Anthropic (Claude)";
  private readonly client: Anthropic;

  constructor(opts: { apiKey: string; baseURL?: string; timeoutMs?: number }) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 2, timeout: opts.timeoutMs ?? 600_000 });
  }

  async turn(req: LlmRequest): Promise<LlmResponse> {
    if (req.maxTokens > 16_000) throw new LlmError("max_tokens above 16,000 needs streaming; keep turns smaller");
    const messages = req.messages.map((m) => (m.role === "assistant" ? { role: "assistant" as const, content: m.replay as Anthropic.Beta.BetaContentBlockParam[] } : { role: "user" as const, content: m.content as Anthropic.Beta.BetaMessageParam["content"] }));
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.client.beta.messages.create({
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        model: req.model,
        max_tokens: req.maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: req.effort ?? "high", ...(req.outputSchema ? { format: { type: "json_schema", schema: req.outputSchema } } : {}) },
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        ...(req.tools?.length
          ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema, strict: true })) }
          : {}),
        messages,
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new LlmError("The model API is rate limiting us; the step will retry.", { retryable: true });
      if (e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) throw new LlmError("The model API is unavailable; the step will retry.", { retryable: true });
      if (e instanceof Anthropic.AuthenticationError) throw new LlmError("The model API key was rejected (ANTHROPIC_API_KEY).");
      if (e instanceof Anthropic.BadRequestError) throw new LlmError(`The model API refused the request: ${e.message.slice(0, 300)}`);
      if (e instanceof Anthropic.APIError) throw new LlmError(`Model API error ${e.status ?? ""}: ${e.message.slice(0, 300)}`, { retryable: (e.status ?? 0) >= 500 });
      throw e;
    }
    const content: (TextBlock | ToolUseBlock)[] = [];
    for (const b of res.content) {
      if (b.type === "text") content.push({ type: "text", text: b.text });
      else if (b.type === "tool_use") content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    }
    const u = res.usage;
    const usage = { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
    const iterations = Array.isArray(u.iterations) ? u.iterations : [];
    const billed: BilledUsage[] = iterations.length
      ? iterations.map((it) => ({
          model: ("model" in it && it.model ? String(it.model) : res.model) as string,
          input: "input_tokens" in it ? Number(it.input_tokens) : 0,
          output: "output_tokens" in it ? Number(it.output_tokens) : 0,
          cacheRead: "cache_read_input_tokens" in it ? Number(it.cache_read_input_tokens ?? 0) : 0,
          cacheWrite: "cache_creation_input_tokens" in it ? Number(it.cache_creation_input_tokens ?? 0) : 0,
        }))
      : [{ model: res.model, ...usage }];
    const sr = res.stop_reason;
    const stopReason: LlmResponse["stopReason"] =
      sr === "end_turn" || sr === "tool_use" || sr === "max_tokens" || sr === "refusal" || sr === "pause_turn" || sr === "stop_sequence" ? sr : "other";
    return { model: res.model, content, replay: res.content as unknown[], stopReason, usage, billed };
  }
}
