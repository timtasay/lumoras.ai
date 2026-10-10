/**
 * Choosing models (Agency → Models): which OpenRouter models are offered
 * (tools, JSON-schema answers and reasoning required; no :free or :batch
 * variants), prices per million tokens, and a stored choice read defensively.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { anthropicCatalog, parseOpenRouterModels } from "../../lib/llm/catalog.ts";
import { chosenModel, parseModelChoice, pricesWith } from "../../lib/llm/model-settings.ts";
import { DEFAULT_PRICES } from "../../lib/llm/prices.ts";
import { DEFAULT_MODELS } from "../../lib/llm/types.ts";

const ALL = ["tools", "tool_choice", "response_format", "structured_outputs", "reasoning", "max_tokens"];
const listing = {
  data: [
    { id: "anthropic/claude-sonnet-5.5", name: "Anthropic: Claude Sonnet 5.5", context_length: 1000000, pricing: { prompt: "0.000002", completion: "0.00001", input_cache_read: "0.0000001", input_cache_write: "0.0000025" }, supported_parameters: ALL },
    { id: "openai/gpt-6", name: "OpenAI: GPT-6", context_length: 400000, pricing: { prompt: "0.000003", completion: "0.000012" }, supported_parameters: ALL },
    { id: "anthropic/claude-sonnet-5.5:batch", name: "batch", pricing: { prompt: "0.000001", completion: "0.000005" }, supported_parameters: ALL },
    { id: "meta/llama-9:free", name: "free", pricing: { prompt: "0", completion: "0" }, supported_parameters: ALL },
    { id: "tiny/no-tools", name: "No tools", pricing: { prompt: "0.0000001", completion: "0.0000001" }, supported_parameters: ["response_format", "reasoning"] },
    { id: "tiny/no-reasoning", name: "No reasoning", pricing: { prompt: "0.0000001", completion: "0.0000001" }, supported_parameters: ["tools", "response_format"] },
    { id: "bad id with spaces", name: "x", pricing: { prompt: "0", completion: "0" }, supported_parameters: ALL },
    { id: "odd/no-price", name: "No price", pricing: {}, supported_parameters: ALL },
  ],
};

describe("the models offered", () => {
  it("OpenRouter: only models with tools, JSON-schema answers and reasoning; no :free or :batch variants; prices per million tokens", () => {
    const m = parseOpenRouterModels(listing);
    assert.deepEqual(m.map((x) => x.id), ["anthropic/claude-sonnet-5.5", "openai/gpt-6"]);
    assert.deepEqual(m[0].price, { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 });
    assert.deepEqual(m[1].price, { input: 3, output: 12, cacheRead: 3, cacheWrite: 3 }, "no cache prices listed: priced at the input rate (never under-held)");
    assert.equal(m[0].contextLength, 1000000);
    assert.deepEqual(parseOpenRouterModels({ nope: true }), []);
  });
  it("Anthropic: the Claude models in the price table", () => {
    const ids = anthropicCatalog().map((m) => m.id);
    assert.ok(ids.includes("claude-opus-5-5") && ids.includes("claude-sonnet-5-5"));
    assert.ok(ids.every((i) => i.startsWith("claude-")));
  });
});

describe("a stored choice", () => {
  it("is read defensively: unknown steps, bad ids and bad prices are ignored", () => {
    const c = parseModelChoice({ models: { draft: "openai/gpt-6", topic: "Robert'); DROP", publish: "x/y", brief: 3 }, prices: { "openai/gpt-6": { input: 3, output: 12 }, "x/bad": { input: "free" } } });
    assert.deepEqual(c.models, { draft: "openai/gpt-6" });
    assert.deepEqual(c.prices, { "openai/gpt-6": { input: 3, output: 12, cacheRead: 3 * 0.1, cacheWrite: 3 * 1.25 } });
    assert.deepEqual(parseModelChoice(null), { models: {}, prices: {} });
  });
  it("a chosen step uses its model; the rest use the env defaults by role", () => {
    const c = parseModelChoice({ models: { draft: "openai/gpt-6" } });
    assert.equal(chosenModel(c, "draft", DEFAULT_MODELS), "openai/gpt-6");
    assert.equal(chosenModel(c, "brief", DEFAULT_MODELS), DEFAULT_MODELS.draft);
    assert.equal(chosenModel(c, "topic", DEFAULT_MODELS), DEFAULT_MODELS.review);
    assert.equal(chosenModel(c, "factcheck", DEFAULT_MODELS), DEFAULT_MODELS.review);
  });
  it("the chosen models' listed prices size the hold", () => {
    const t = pricesWith(DEFAULT_PRICES, parseModelChoice({ prices: { "openai/gpt-6": { input: 3, output: 12, cacheRead: 0.3, cacheWrite: 3 } } }));
    assert.deepEqual(t["openai/gpt-6"], { input: 3_000_000, output: 12_000_000, cacheRead: 300_000, cacheWrite: 3_000_000 });
    assert.equal(t["claude-opus-5-5"], DEFAULT_PRICES["claude-opus-5-5"]);
  });
});
