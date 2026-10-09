/**
 * The LlmProvider interface: one model turn in, one response out. Two
 * implementations (lib/llm/registry.ts, LLM_PROVIDER):
 *
 *   anthropic  the Anthropic Messages API through @anthropic-ai/sdk
 *   fake       recorded fixtures (lib/llm/fixtures.ts); tests and development
 *
 * Nothing calls a provider directly: lib/llm/metered.ts prices every turn,
 * holds the estimate against the workspace's llm_tokens budget (refusing
 * below the reserve), calls, and settles at the real usage. The agentic tool
 * loop (lib/llm/loop.ts) sits on top and decides which tools a model may
 * call; there is no tool that publishes, and spending tools close once
 * untrusted content is in the conversation.
 *
 * The block and message types here are deliberately narrow (text, tool use,
 * tool result) so the fake and the real provider share them; the provider's
 * own assistant content is carried opaquely in `replay` so it can be sent
 * back unchanged on the next turn (thinking blocks included, as the API
 * requires).
 */

export type LlmPurpose = "topic" | "brief" | "draft" | "factcheck";

export type JsonSchema = Record<string, unknown>;

export type LlmTool = { name: string; description: string; input_schema: JsonSchema };

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export type LlmMessage =
  | { role: "user"; content: string | (TextBlock | ToolResultBlock)[] }
  /** `replay` is the provider's own content for this turn, echoed back verbatim. */
  | { role: "assistant"; replay: unknown[] };

export type LlmRequest = {
  purpose: LlmPurpose;
  model: string;
  /** Stable instructions (cached by the provider). */
  system: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  /** JSON schema the final answer must follow (structured output). */
  outputSchema?: JsonSchema;
};

export type LlmUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** One billed model's share of a turn (a server-side fallback can bill two models in one turn). */
export type BilledUsage = LlmUsage & { model: string };

export type LlmResponse = {
  /** The model that served the turn (after any fallback). */
  model: string;
  content: (TextBlock | ToolUseBlock)[];
  replay: unknown[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn" | "stop_sequence" | "other";
  usage: LlmUsage;
  /** Per-model usage when the provider reports it (fallbacks); otherwise one entry for `model`. */
  billed: BilledUsage[];
};

export interface LlmProvider {
  readonly name: "anthropic" | "fake";
  readonly label: string;
  turn(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly opts: { retryable?: boolean; billed?: boolean } = {},
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** Model ids from env (LLM_MODEL_DRAFT, LLM_MODEL_REVIEW). */
export type LlmModels = { draft: string; review: string };
export const DEFAULT_MODELS: LlmModels = { draft: "claude-sonnet-5-5", review: "claude-opus-5-5" };

/** Which model each purpose uses: topic selection and fact-checking get the review model (section 3). */
export function modelFor(purpose: LlmPurpose, m: LlmModels): string {
  return purpose === "topic" || purpose === "factcheck" ? m.review : m.draft;
}
