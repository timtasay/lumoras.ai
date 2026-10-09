/**
 * Runs a content pipeline: ten persisted steps, executed in order, each
 * resumable and retryable from any step.
 *
 *   startRun()   creates the run and its ten pending steps, moves the item to
 *                "generating" and queues the run.
 *   executeRun() claims the run and works through pending steps until the run
 *                finishes, waits (review gate; publish before its slot), or a
 *                step fails. A step is claimed with a conditional UPDATE
 *                (pending → running), so two workers can never run the same
 *                step; a step stuck in "running" for 15 minutes (a crashed
 *                worker) is put back to pending.
 *   retryFrom()  puts a step and every later step back to pending (the
 *                earlier steps' outputs stay) and queues the run again.
 *
 * Every step row records its input, output, model, tokens, cost, duration and
 * error. A retryable failure (rate limits, a 5xx) puts the step back and
 * throws, so the job queue retries it with backoff; anything else fails the
 * step and the run, and a person decides.
 */
import { withWorkspace, type TenantContext } from "../db/tenant.ts";
import { createRun, getItem, getRun, listSteps, setStatus, type RunRow, type StepRow } from "../data/content.ts";
import { getSiteSettings } from "../data/sites.ts";
import { LlmBudgetRefusedError } from "../llm/metered.ts";
import { LlmError } from "../llm/types.ts";
import { BudgetRefusedError } from "../metering/metered.ts";
import { TransitionError, type ContentStatus } from "../content/status.ts";
import { QUEUES, StepError, type PipelineDeps } from "./deps.ts";
import { STEP_FNS, type StepContext, type StepResult } from "./run-steps.ts";
import { STEP_KEYS, stepIndex, type StepKey } from "./steps.ts";

const STALE_RUNNING_MS = 15 * 60_000;
/** Steps before the review gate: a failure here fails the article. */
const WRITING: readonly StepKey[] = ["context", "scan", "topic", "brief", "draft", "factcheck", "lint"];

export type RunOutcome = { status: RunRow["status"]; step: StepKey | null; deferUntil?: Date; error?: string };

export class RetryableStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableStepError";
  }
}

const enqueueRun = (deps: PipelineDeps, ctx: TenantContext, runId: string, startAfter?: Date) =>
  deps.enqueue(QUEUES.run, { workspaceId: ctx.workspaceId, runId }, { singletonKey: `run:${runId}${startAfter ? `:${startAfter.getTime()}` : ""}`, startAfter });

/** Starts a run for an item (from planned, failed or changes requested). */
export async function startRun(deps: PipelineDeps, ctx: TenantContext, itemId: string, trigger: "schedule" | "manual" | "retry" | "batch"): Promise<string> {
  const runId = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("pipeline.start");
    const item = await getItem(tx, itemId, { lock: true });
    if (item.current_run_id) {
      const r = await tx.maybe<{ status: string }>("SELECT status FROM pipeline_runs WHERE id = $1", [item.current_run_id]);
      if (r && (r.status === "queued" || r.status === "running")) return item.current_run_id;
    }
    await setStatus(tx, itemId, "generating", "Writing has started.");
    return createRun(tx, ctx.workspaceId, item.site_id, itemId, trigger, ctx.actorId);
  });
  await enqueueRun(deps, ctx, runId);
  return runId;
}

function classify(e: unknown): { message: string; retryable: boolean } {
  if (e instanceof StepError) return { message: e.message, retryable: e.retryable };
  if (e instanceof LlmBudgetRefusedError || e instanceof BudgetRefusedError) return { message: e.message, retryable: false };
  if (e instanceof LlmError) return { message: e.message, retryable: !!e.opts.retryable };
  if (e instanceof TransitionError) return { message: e.message, retryable: false };
  const code = (e as { code?: string }).code;
  if (code === "23505") return { message: "Another article already holds this slot, slug or head term (rule 5).", retryable: false };
  return { message: e instanceof Error ? e.message : String(e), retryable: false };
}

async function markStep(deps: PipelineDeps, ctx: TenantContext, stepId: string, sql: string, params: unknown[]) {
  await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("pipeline.step");
    await tx.exec(sql, [stepId, ...params]);
  });
}

/** Executes (or resumes) a run until it finishes, waits or fails. */
export async function executeRun(deps: PipelineDeps, ctx: TenantContext, runId: string): Promise<RunOutcome> {
  const start = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("pipeline.resume");
    const run = await getRun(tx, runId);
    if (run.status === "succeeded" || run.status === "canceled") return { run, steps: [] as StepRow[], skip: true };
    await tx.exec("UPDATE pipeline_steps SET status = 'pending', error = 'interrupted (worker stopped); resumed' WHERE run_id = $1 AND status = 'running' AND started_at < $2", [runId, new Date(deps.now().getTime() - STALE_RUNNING_MS)]);
    await tx.exec("UPDATE pipeline_runs SET status = 'running', error = NULL, started_at = coalesce(started_at, $2) WHERE id = $1", [runId, deps.now()]);
    return { run, steps: await listSteps(tx, runId), skip: false };
  });
  if (start.skip) return { status: start.run.status, step: start.run.current_step };
  const run = start.run;
  const outputs: StepContext["outputs"] = {};
  for (const st of start.steps) if (st.output && (st.status === "succeeded" || st.status === "skipped")) outputs[st.step] = st.output;

  for (const key of STEP_KEYS) {
    const st = start.steps.find((x) => x.step === key)!;
    if (st.status === "succeeded" || st.status === "skipped") continue;
    if (st.status === "running") return { status: "running", step: key }; // another worker has it
    if (st.status === "failed") {
      // a failed step stays failed until someone retries it
      await withWorkspace(deps.db, ctx, (tx) => tx.exec("UPDATE pipeline_runs SET status = 'failed', current_step = $2 WHERE id = $1", [runId, key]));
      return { status: "failed", step: key, error: st.error ?? "failed" };
    }
    // claim: pending (or waiting) → running, exactly once
    const claimed = await withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action("pipeline.step");
      const n = await tx.exec(
        "UPDATE pipeline_steps SET status = 'running', attempt = attempt + 1, started_at = $2, finished_at = NULL, error = NULL WHERE id = $1 AND status IN ('pending', 'waiting')",
        [st.id, deps.now()],
      );
      if (n) await tx.exec("UPDATE pipeline_runs SET current_step = $2, status = 'running' WHERE id = $1", [runId, key]);
      return n === 1;
    });
    if (!claimed) return { status: "running", step: key };

    const fresh = await withWorkspace(deps.db, ctx, async (tx) => ({ item: await getItem(tx, run.item_id), site: await getSiteSettings(tx, run.site_id) }), { readOnly: true });
    const t0 = Date.now();
    let res: StepResult;
    try {
      res = await STEP_FNS[key]({ deps, ctx, run, item: fresh.item, site: fresh.site, outputs });
    } catch (e) {
      const { message, retryable } = classify(e);
      const ms = Date.now() - t0;
      if (retryable) {
        await markStep(deps, ctx, st.id, "UPDATE pipeline_steps SET status = 'pending', error = $2, duration_ms = $3, finished_at = $4 WHERE id = $1", [`will retry: ${message}`.slice(0, 2000), ms, deps.now()]);
        await withWorkspace(deps.db, ctx, (tx) => tx.exec("UPDATE pipeline_runs SET status = 'queued', error = $2 WHERE id = $1", [runId, message.slice(0, 2000)]));
        throw new RetryableStepError(message);
      }
      await withWorkspace(deps.db, ctx, async (tx) => {
        await tx.action("pipeline.fail");
        await tx.exec("UPDATE pipeline_steps SET status = 'failed', error = $2, duration_ms = $3, finished_at = $4 WHERE id = $1", [st.id, message.slice(0, 2000), ms, deps.now()]);
        await tx.exec("UPDATE pipeline_runs SET status = 'failed', error = $2, finished_at = $3 WHERE id = $1", [runId, `${key}: ${message}`.slice(0, 2000), deps.now()]);
        if ((WRITING as readonly string[]).includes(key)) {
          const cur = await tx.one<{ status: ContentStatus }>("SELECT status FROM content_items WHERE id = $1", [run.item_id]);
          if (cur.status === "generating") await setStatus(tx, run.item_id, "failed", `${key}: ${message}`.slice(0, 500));
        }
      });
      deps.log.warn("pipeline step failed", { runId, step: key, err: message });
      return { status: "failed", step: key, error: message };
    }

    const ms = Date.now() - t0;
    const u = res.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const status = res.status ?? "succeeded";
    await withWorkspace(deps.db, ctx, async (tx) => {
      await tx.action("pipeline.step_done");
      await tx.exec(
        `UPDATE pipeline_steps SET status = $2, input = coalesce($3::jsonb, input), output = $4::jsonb, model = $5, input_tokens = input_tokens + $6, output_tokens = output_tokens + $7,
           cache_read_tokens = cache_read_tokens + $8, cache_write_tokens = cache_write_tokens + $9, cost_micros = cost_micros + $10, duration_ms = $11, finished_at = $12
         WHERE id = $1`,
        [st.id, status, res.input ? JSON.stringify(res.input) : null, JSON.stringify(res.output), res.model ?? null, u.input, u.output, u.cacheRead, u.cacheWrite, res.costMicros ?? 0, ms, status === "waiting" ? null : deps.now()],
      );
      await tx.exec("UPDATE pipeline_runs SET cost_micros = cost_micros + $2, tokens = tokens + $3 WHERE id = $1", [runId, res.costMicros ?? 0, u.input + u.output + u.cacheRead + u.cacheWrite]);
      if (status === "waiting") await tx.exec("UPDATE pipeline_runs SET status = 'waiting', current_step = $2 WHERE id = $1", [runId, key]);
    });
    if (status === "waiting") {
      if (res.deferUntil) await enqueueRun(deps, ctx, runId, res.deferUntil);
      return { status: "waiting", step: key, deferUntil: res.deferUntil };
    }
    outputs[key] = res.output;
  }
  await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("pipeline.done");
    await tx.exec("UPDATE pipeline_runs SET status = 'succeeded', current_step = NULL, finished_at = $2 WHERE id = $1", [runId, deps.now()]);
  });
  return { status: "succeeded", step: null };
}

/** Retry or resume from a step: it and every later step go back to pending; earlier outputs are kept. */
export async function retryFrom(deps: PipelineDeps, ctx: TenantContext, runId: string, from: StepKey): Promise<void> {
  await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("pipeline.retry");
    const run = await getRun(tx, runId);
    if (run.status === "running") throw new StepError("This run is working right now. Wait for the current step to finish.");
    const item = await getItem(tx, run.item_id, { lock: true });
    const idx = stepIndex(from);
    const writing = idx <= stepIndex("lint");
    if (writing && ["published", "publishing"].includes(item.status)) throw new StepError("This article is already published; start a refresh instead of rewriting it.");
    if (writing && item.status !== "generating") await setStatus(tx, item.id, "generating", `Retrying from ${from}.`);
    if (from === "review" && item.status !== "awaiting_review" && item.status !== "approved") await setStatus(tx, item.id, "generating", "Re-entering the review gate.");
    await tx.exec("UPDATE pipeline_steps SET status = 'pending', error = NULL, finished_at = NULL WHERE run_id = $1 AND position >= $2", [runId, idx + 1]);
    await tx.exec("UPDATE pipeline_runs SET status = 'queued', error = NULL, finished_at = NULL, current_step = $2 WHERE id = $1", [runId, from]);
    await tx.exec("UPDATE content_items SET current_run_id = $2 WHERE id = $1", [item.id, runId]);
  });
  await enqueueRun(deps, ctx, runId);
}

/** After a reviewer approves: mark the gate passed and schedule publishing at the slot. */
export async function afterApproval(deps: PipelineDeps, ctx: TenantContext, itemId: string): Promise<void> {
  const r = await withWorkspace(deps.db, ctx, async (tx) => {
    await tx.action("pipeline.approved");
    const item = await getItem(tx, itemId);
    if (!item.current_run_id) return null;
    await tx.exec("UPDATE pipeline_steps SET status = 'succeeded', finished_at = $2, output = coalesce(output, '{}'::jsonb) || $3::jsonb WHERE run_id = $1 AND step = 'review'", [
      item.current_run_id,
      deps.now(),
      JSON.stringify({ decision: "approved" }),
    ]);
    await tx.exec("UPDATE pipeline_runs SET status = 'queued', current_step = 'publish' WHERE id = $1 AND status IN ('waiting', 'failed', 'queued')", [item.current_run_id]);
    return { runId: item.current_run_id, slot: item.slot_at };
  });
  if (r) await enqueueRun(deps, ctx, r.runId, r.slot > deps.now() ? r.slot : undefined);
}

export { createRun };
