/**
 * FakeLlm: the LlmProvider for tests and development. Answers from recorded
 * fixtures (lib/llm/fixtures.ts), shaped exactly like the real model's
 * answers, never touching the network. Token usage is computed from the text
 * (about four characters a token) and later turns of a tool loop read the
 * system prompt from the "cache", so cost accounting runs on realistic,
 * deterministic numbers. Tests can script any turn (`script`) or switch a
 * fixture into a failure scenario (`scenarios`).
 */
import { readInput, BRAND_SOURCE, type BriefInput, type DraftInput, type FactInput, type TopicInput } from "../pipeline/prompts.ts";
import { briefAnswer, draftAnswer, factAnswer, topicAnswer, type Scenario } from "./fixtures.ts";
import type { LlmProvider, LlmPurpose, LlmRequest, LlmResponse, TextBlock, ToolUseBlock } from "./types.ts";

type Script = (req: LlmRequest, turn: number) => Pick<LlmResponse, "content" | "stopReason"> | null;

const tok = (s: string) => Math.ceil(s.length / 4);

export class FakeLlm implements LlmProvider {
  readonly name = "fake" as const;
  readonly label = "Demo model (recorded fixtures)";
  readonly calls: LlmRequest[] = [];
  private seq = 0;

  constructor(private readonly opts: { scenarios?: Partial<Record<LlmPurpose, Scenario>>; script?: Script; latencyMs?: number } = {}) {}

  async turn(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    if (this.opts.latencyMs) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    const turn = req.messages.filter((m) => m.role === "assistant").length;
    const scripted = this.opts.script?.(req, turn) ?? null;
    const { content, stopReason } = scripted ?? this.fixture(req, turn);
    const inputText = req.system + JSON.stringify(req.tools ?? []) + JSON.stringify(req.messages);
    const sys = tok(req.system);
    const input = tok(inputText);
    const output = tok(JSON.stringify(content)) + 40;
    // the first turn writes the system prompt to the cache; later turns read it
    const usage = turn === 0 ? { input: input - sys, output, cacheRead: 0, cacheWrite: sys } : { input: input - sys, output, cacheRead: sys, cacheWrite: 0 };
    return { model: req.model, content, replay: content, stopReason, usage, billed: [{ model: req.model, ...usage }] };
  }

  private id() {
    return `toolu_fake_${(++this.seq).toString(36).padStart(4, "0")}`;
  }

  private fixture(req: LlmRequest, turn: number): Pick<LlmResponse, "content" | "stopReason"> {
    const scenario: Scenario = this.opts.scenarios?.[req.purpose] ?? "default";
    const final = (o: unknown) => ({ content: [{ type: "text", text: JSON.stringify(o) } as TextBlock], stopReason: "end_turn" as const });
    switch (req.purpose) {
      case "topic": {
        const input = readInput<TopicInput>(req);
        const top = input.candidates.slice(0, 3).map((c) => c.keyword);
        if (turn === 0 && top.length && req.tools?.some((t) => t.name === "keyword_metrics")) {
          const uses: ToolUseBlock[] = [{ type: "tool_use", id: this.id(), name: "keyword_metrics", input: { keywords: top } }];
          if (req.tools.some((t) => t.name === "serp")) uses.push({ type: "tool_use", id: this.id(), name: "serp", input: { keyword: top[0] } });
          return { content: [{ type: "text", text: "Checking the top candidates before choosing." }, ...uses], stopReason: "tool_use" };
        }
        if (scenario === "greedy_tools" && turn === 1) {
          // tries to buy more after reading a SERP: the loop must refuse
          return { content: [{ type: "tool_use", id: this.id(), name: "keyword_metrics", input: { keywords: ["anything else"] } }], stopReason: "tool_use" };
        }
        return final(topicAnswer(input, scenario));
      }
      case "brief":
        return final(briefAnswer(readInput<BriefInput>(req), scenario));
      case "draft":
        return final(draftAnswer(readInput<DraftInput>(req)));
      case "factcheck": {
        const input = readInput<FactInput>(req);
        const fetched = new Map<string, string>();
        for (const m of req.messages) if (m.role === "user" && typeof m.content !== "string") for (const b of m.content) if (b.type === "tool_result" && !b.is_error) fetched.set("seen", b.content);
        if (turn === 0 && scenario === "unverifiable" && req.tools?.some((t) => t.name === "fetch_source")) {
          return { content: [{ type: "tool_use", id: this.id(), name: "fetch_source", input: { url: "https://sources.example/missed-calls-study" } }], stopReason: "tool_use" };
        }
        if (fetched.size) fetched.set("https://sources.example/missed-calls-study", fetched.get("seen")!);
        return final(factAnswer(input, scenario, fetched));
      }
    }
  }
}

export { BRAND_SOURCE };
