/**
 * OpenRouter behind LlmProvider (owner decision, 10 October 2026), against a
 * scripted fetch: never the real service.
 *   - the request: model slug, cached system prompt, strict function tools,
 *     json_schema output, reasoning effort, routing that honours them,
 *     usage accounting, the key only in the Authorization header;
 *   - tool loops: tool results become `tool` messages; the assistant
 *     message (reasoning_details included) is replayed unmodified;
 *   - usage and cost: cached and cache-write tokens split out; usage.cost
 *     (US dollars) becomes the turn's reported cost in micro-dollars;
 *   - errors: a bad key, no credits, rate limits and outages (retryable).
 *   - env: LLM_PROVIDER=openrouter needs OPENROUTER_API_KEY, defaults to the
 *     OpenRouter Claude slugs, and pins the API host.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OpenRouterLlm, OPENROUTER_BASE_URL, toOpenRouterRequest } from "../../lib/llm/openrouter.ts";
import { LlmError, OPENROUTER_DEFAULT_MODELS, type LlmRequest } from "../../lib/llm/types.ts";
import { readWebEnv } from "../../lib/env.ts";

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function scripted(replies: { status?: number; body: unknown }[]) {
  const sent: Sent[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    sent.push({ url: String(url), headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), body: JSON.parse(String(init?.body)) });
    const r = replies.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, sent };
}

const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  purpose: "draft",
  model: "anthropic/claude-sonnet-5.5",
  system: "You write articles.",
  messages: [{ role: "user", content: "Write one." }],
  tools: [{ name: "fetch_page", description: "Fetch a page", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } }],
  maxTokens: 8000,
  effort: "high",
  outputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
  ...over,
});

const toolCallReply = {
  id: "gen-1",
  model: "anthropic/claude-sonnet-5.5",
  choices: [
    {
      finish_reason: "tool_calls",
      native_finish_reason: "tool_use",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "fetch_page", arguments: '{"url":"https://example.com/a"}' } }],
        reasoning_details: [{ type: "reasoning.text", text: "I should read the page.", signature: "sig-abc", format: "anthropic-claude-v1", index: 0 }],
      },
    },
  ],
  usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 1000 }, cost: 0.004012 },
};
const finalReply = {
  id: "gen-2",
  model: "anthropic/claude-sonnet-5.5",
  choices: [{ finish_reason: "stop", native_finish_reason: "end_turn", message: { role: "assistant", content: '{"title":"Walk-ins"}' } }],
  usage: { prompt_tokens: 1500, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 1000, cache_write_tokens: 0 }, cost: 0.0013 },
};

describe("OpenRouterLlm", () => {
  it("sends the model slug, a cached system prompt, strict tools, json_schema output, reasoning and usage accounting; the key only as a Bearer header", async () => {
    const { f, sent } = scripted([{ body: toolCallReply }]);
    const llm = new OpenRouterLlm({ apiKey: "sk-or-v1-test-key", appUrl: "https://growth.lumoras.ai", fetch: f });
    await llm.turn(req());
    const s = sent[0];
    assert.equal(s.url, `${OPENROUTER_BASE_URL}/chat/completions`);
    assert.equal(s.headers.authorization, "Bearer sk-or-v1-test-key");
    assert.equal(s.headers["http-referer"], "https://growth.lumoras.ai");
    assert.equal(s.headers["x-title"], "Lumoras Growth");
    assert.ok(!JSON.stringify(s.body).includes("sk-or-v1-test-key"), "the key is never in the body");
    assert.equal(s.body.model, "anthropic/claude-sonnet-5.5");
    assert.deepEqual(s.body.reasoning, { effort: "high" });
    assert.deepEqual((s.body.messages as unknown[])[0], { role: "system", content: [{ type: "text", text: "You write articles.", cache_control: { type: "ephemeral" } }] });
    assert.deepEqual(s.body.tools, [{ type: "function", function: { name: "fetch_page", description: "Fetch a page", parameters: req().tools![0].input_schema, strict: true } }]);
    assert.equal(s.body.tool_choice, "auto");
    assert.deepEqual(s.body.response_format, { type: "json_schema", json_schema: { name: "answer", strict: true, schema: req().outputSchema } });
    assert.deepEqual(s.body.usage, { include: true });
    assert.deepEqual(s.body.provider, { require_parameters: true });
  });

  it("a tool call comes back as tool_use; the next turn replays the assistant message unmodified (reasoning_details) and sends the result as a tool message", async () => {
    const { f, sent } = scripted([{ body: toolCallReply }, { body: finalReply }]);
    const llm = new OpenRouterLlm({ apiKey: "sk-or-v1-test-key", fetch: f });
    const r1 = await llm.turn(req());
    assert.equal(r1.stopReason, "tool_use");
    assert.deepEqual(r1.content, [{ type: "tool_use", id: "call_1", name: "fetch_page", input: { url: "https://example.com/a" } }]);
    assert.deepEqual(r1.usage, { input: 200, output: 80, cacheRead: 0, cacheWrite: 1000 });
    assert.equal(r1.reportedCostMicros, 4012);
    const r2 = await llm.turn(req({ messages: [...req().messages, { role: "assistant", replay: r1.replay }, { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "<untrusted_data>page</untrusted_data>" }] }] }));
    const msgs = sent[1].body.messages as Record<string, unknown>[];
    assert.deepEqual(msgs.map((m) => m.role), ["system", "user", "assistant", "tool"]);
    assert.deepEqual(msgs[2], { role: "assistant", content: null, tool_calls: toolCallReply.choices[0].message.tool_calls, reasoning_details: toolCallReply.choices[0].message.reasoning_details });
    assert.deepEqual(msgs[3], { role: "tool", tool_call_id: "call_1", content: "<untrusted_data>page</untrusted_data>" });
    assert.equal(r2.stopReason, "end_turn");
    assert.deepEqual(r2.content, [{ type: "text", text: '{"title":"Walk-ins"}' }]);
    assert.deepEqual(r2.usage, { input: 500, output: 40, cacheRead: 1000, cacheWrite: 0 });
    assert.equal(r2.reportedCostMicros, 1300);
    assert.deepEqual(r2.billed, [{ model: "anthropic/claude-sonnet-5.5", input: 500, output: 40, cacheRead: 1000, cacheWrite: 0 }]);
  });

  it("refusals, truncation and a missing cost are reported as such", async () => {
    const { f } = scripted([
      { body: { choices: [{ finish_reason: "stop", native_finish_reason: "refusal", message: { role: "assistant", content: "" } }], usage: {} } },
      { body: { choices: [{ finish_reason: "length", message: { role: "assistant", content: "{" } }], usage: { prompt_tokens: 10, completion_tokens: 8000 } } },
    ]);
    const llm = new OpenRouterLlm({ apiKey: "k", fetch: f });
    assert.equal((await llm.turn(req())).stopReason, "refusal");
    const t = await llm.turn(req());
    assert.equal(t.stopReason, "max_tokens");
    assert.equal(t.reportedCostMicros, undefined, "no usage.cost: the ledger prices it from the table");
  });

  it("errors: a bad key and no credits are final; rate limits, outages and mid-answer errors retry", async () => {
    const cases: [number, unknown, RegExp, boolean][] = [
      [401, { error: { message: "No auth credentials found" } }, /OPENROUTER_API_KEY/, false],
      [402, { error: { message: "Insufficient credits" } }, /out of credits/, false],
      [400, { error: { message: "bad schema" } }, /refused the request \(400\): bad schema/, false],
      [429, { error: { message: "slow down" } }, /busy or unavailable \(429\)/, true],
      [503, {}, /busy or unavailable \(503\)/, true],
      [200, { choices: [{ error: { code: 502, message: "upstream died" } }] }, /upstream died/, true],
      [200, { choices: [{ finish_reason: "error", message: { role: "assistant", content: "" } }] }, /reported an error mid-answer/, true],
    ];
    for (const [status, body, re, retryable] of cases) {
      const { f } = scripted([{ status, body }]);
      await assert.rejects(new OpenRouterLlm({ apiKey: "k", fetch: f }).turn(req()), (e: unknown) => e instanceof LlmError && re.test(e.message) && !!e.opts.retryable === retryable, `${status}`);
    }
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await assert.rejects(new OpenRouterLlm({ apiKey: "k", fetch: down }).turn(req()), (e: unknown) => e instanceof LlmError && !!e.opts.retryable);
  });

  it("no tools and no schema: neither field is sent", () => {
    const b = toOpenRouterRequest(req({ tools: [], outputSchema: undefined }));
    assert.equal("tools" in b, false);
    assert.equal("response_format" in b, false);
  });
});

describe("LLM_PROVIDER=openrouter", () => {
  const base = { DATABASE_URL: "postgres://seo_app:a@db:5432/seo", BETTER_AUTH_SECRET: "x".repeat(40), ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") };
  it("defaults to the OpenRouter Claude slugs and needs the key", () => {
    const e = readWebEnv({ ...base, LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-v1-abc" });
    assert.equal(e.llm.provider, "openrouter");
    assert.deepEqual(e.llm.models, OPENROUTER_DEFAULT_MODELS);
    assert.equal(e.llm.baseURL, OPENROUTER_BASE_URL);
    assert.throws(() => readWebEnv({ ...base, LLM_PROVIDER: "openrouter" }), /OPENROUTER_API_KEY is required/);
  });
  it("pins the API host and checks model slugs", () => {
    assert.throws(() => readWebEnv({ ...base, LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k", OPENROUTER_BASE_URL: "https://evil.example/api/v1" }), /OPENROUTER_BASE_URL must be/);
    assert.equal(readWebEnv({ ...base, LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k", OPENROUTER_BASE_URL: "http://127.0.0.1:4599" }).llm.baseURL, "http://127.0.0.1:4599");
    assert.throws(() => readWebEnv({ ...base, LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k", LLM_MODEL_DRAFT: "claude-sonnet-5-5" }), /OpenRouter model slug/);
    assert.equal(readWebEnv({ ...base, LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k", LLM_MODEL_REVIEW: "anthropic/claude-sonnet-5.5" }).llm.models.review, "anthropic/claude-sonnet-5.5");
  });
});
