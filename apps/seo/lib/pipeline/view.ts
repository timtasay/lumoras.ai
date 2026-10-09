/**
 * The pipeline run as the run view shows it: the run, its article and its ten
 * persisted steps, serialised for the browser (dates as ISO strings, money as
 * numbers of micro-USD). The page renders the first snapshot; the event
 * stream (app/api/w/[slug]/runs/[runId]/events) sends the next ones.
 */
import { localParts } from "../content/schedule.ts";
import type { Tx } from "../db/tenant.ts";
import { getRun, listSteps } from "../data/content.ts";
import { STEP_META, type StepKey, type StepKind } from "./steps.ts";

export type StepView = {
  key: StepKey;
  label: string;
  kind: StepKind;
  summary: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "waiting";
  attempt: number;
  model: string | null;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costMicros: number;
  durationMs: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
};

export type RunView = {
  id: string;
  status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "canceled";
  currentStep: StepKey | null;
  trigger: string;
  costMicros: number;
  tokens: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** slotLabel: the slot in the site's time zone, formatted on the server (no Intl in the browser: hydration-safe). */
  item: { id: string; title: string; keyword: string | null; status: string; slotAt: string; slotLabel: string; slug: string | null };
  domain: string;
  steps: StepView[];
  /** Changes whenever anything on the run or a step changed (the stream sends only then). */
  version: string;
};

export async function runView(tx: Tx, runId: string): Promise<RunView> {
  const run = await getRun(tx, runId);
  const steps = await listSteps(tx, runId);
  const meta = await tx.one<{ title: string; primary_keyword: string | null; status: string; slot_at: Date; slug: string | null; domain: string; timezone: string; updated_at: Date }>(
    "SELECT c.title, c.primary_keyword, c.status, c.slot_at, c.slug, s.domain, s.timezone, c.updated_at FROM content_items c JOIN sites s ON s.id = c.site_id WHERE c.id = $1",
    [run.item_id],
  );
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const version = [run.updated_at.getTime(), meta.updated_at.getTime(), ...steps.map((s) => `${s.status}:${s.updated_at.getTime()}`)].join("|");
  return {
    id: run.id,
    status: run.status,
    currentStep: run.current_step,
    trigger: run.trigger,
    costMicros: Number(run.cost_micros),
    tokens: run.tokens,
    error: run.error,
    createdAt: run.created_at.toISOString(),
    startedAt: iso(run.started_at),
    finishedAt: iso(run.finished_at),
    item: { id: run.item_id, title: meta.title, keyword: meta.primary_keyword, status: meta.status, slotAt: meta.slot_at.toISOString(), slotLabel: slotLabel(meta.slot_at, meta.timezone), slug: meta.slug },
    domain: meta.domain,
    steps: steps.map((s) => ({
      key: s.step,
      label: STEP_META[s.step].label,
      kind: STEP_META[s.step].kind,
      summary: STEP_META[s.step].summary,
      status: s.status,
      attempt: s.attempt,
      model: s.model,
      tokens: { input: s.input_tokens, output: s.output_tokens, cacheRead: s.cache_read_tokens, cacheWrite: s.cache_write_tokens },
      costMicros: Number(s.cost_micros),
      durationMs: s.duration_ms,
      error: s.error,
      startedAt: iso(s.started_at),
      finishedAt: iso(s.finished_at),
      input: s.input,
      output: s.output,
    })),
    version,
  };
}

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri 9 Oct, 09:00 (America/New York)" */
export function slotLabel(at: Date, tz: string): string {
  const l = localParts(at, tz);
  const d = new Date(`${l.date}T12:00:00Z`);
  return `${WD[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${l.time} (${tz.replace(/_/g, " ")})`;
}
