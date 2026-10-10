/**
 * Model usage through OpenRouter on a real PostgreSQL with the app role
 * (owner decision, 10 October 2026): a two-turn tool loop against a scripted
 * OpenRouter (never the real service). Each turn is held at the estimate
 * first, then settled at the cost OpenRouter reported (usage.cost), and the
 * ledger says so; the loop returns the parsed answer.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import * as z from "zod";
import { withWorkspace } from "../../lib/db/tenant.ts";
import { setBudget } from "../../lib/data/research.ts";
import { runToolLoop, type ToolImpl } from "../../lib/llm/loop.ts";
import { OpenRouterLlm } from "../../lib/llm/openrouter.ts";
import { DEFAULT_PRICES } from "../../lib/llm/prices.ts";
import { adminQuery, createTestDatabase, dropAll, skipReason, type TestDb } from "../helpers/db.ts";
import { makeWorkspace, type TestWorkspace } from "../helpers/workspace.ts";

describe("model usage through OpenRouter: held, then settled at the reported cost", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let W: TestWorkspace;

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 4 });
    pool.on("error", () => {});
    W = await makeWorkspace(pool, "routed", "routed.example");
    await withWorkspace(pool, { workspaceId: W.ws, actorId: W.user }, (tx) => setBudget(tx, W.ws, "llm_tokens", 5_000_000, 500_000));
  });
  after(async () => {
    await pool?.end();
    await dropAll();
  });

  it("a tool loop over two turns settles each at OpenRouter's usage.cost", async () => {
    const replies = [
      {
        model: "anthropic/claude-opus-5.5",
        choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "lookup", arguments: '{"q":"salon deposits"}' } }], reasoning_details: [{ type: "reasoning.encrypted", data: "opaque", index: 0 }] } }],
        usage: { prompt_tokens: 2000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 1800 }, cost: 0.011 },
      },
      {
        model: "anthropic/claude-opus-5.5",
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: '{"topic":"Salon deposit policy"}' } }],
        usage: { prompt_tokens: 2300, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1800, cache_write_tokens: 0 }, cost: 0.002 },
      },
    ];
    const bodies: Record<string, unknown>[] = [];
    const f = (async (_u: string | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(replies.shift()), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const tool: ToolImpl = {
      def: { name: "lookup", description: "Look something up", input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false } },
      spends: false,
      untrusted: false,
      maxCalls: 2,
      run: async (input) => ({ text: `results for ${(input as { q: string }).q}`, summary: "ok" }),
    };
    const out = await runToolLoop(
      { db: pool, llm: new OpenRouterLlm({ apiKey: "sk-or-v1-test", fetch: f }), prices: DEFAULT_PRICES },
      { workspaceId: W.ws, actorId: W.user, siteId: W.site },
      { purpose: "topic", model: "anthropic/claude-opus-5.5", system: "Pick a topic.", messages: [{ role: "user", content: "Go." }], maxTokens: 4000 },
      [tool],
      z.object({ topic: z.string() }),
    );
    assert.deepEqual(out.output, { topic: "Salon deposit policy" });
    assert.equal(out.turns, 2);
    assert.equal(out.costMicros, 13_000, "11,000 + 2,000 micro-dollars, as OpenRouter reported");
    assert.deepEqual((bodies[1].messages as { role: string }[]).map((m) => m.role), ["system", "user", "assistant", "tool"]);
    const rows = await adminQuery<{ status: string; cost_micros: string; estimate_micros: string; provider: string; detail: string }>(
      "SELECT status, cost_micros::text, estimate_micros::text, provider, detail FROM usage_ledger WHERE workspace_id = $1 AND category = 'llm_tokens' ORDER BY created_at",
      [W.ws],
      db.name,
    );
    assert.deepEqual(rows.map((r) => [r.status, r.cost_micros, r.provider]), [["settled", "11000", "openrouter"], ["settled", "2000", "openrouter"]]);
    for (const r of rows) {
      assert.match(r.detail, /cost reported by the provider/);
      assert.ok(Number(r.estimate_micros) >= Number(r.cost_micros), "the hold was at least the real cost");
    }
  });
});
