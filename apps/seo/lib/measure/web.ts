/**
 * The web process's side of measurement: it only queues work for the worker
 * (a first sync when a property is chosen, "Run now"), never calls Google or
 * a paid provider itself. Server-side only.
 */
import { randomUUID } from "node:crypto";
import { log } from "../config.ts";
import { enqueue } from "../jobs/client.ts";
import { QUEUE_FOR } from "./scheduler.ts";
import type { RunKind, RunTrigger } from "./runs.ts";

/** A window key of its own: a manual or connect-time run is never confused with the scheduled one. */
export const oneOffWindow = (trigger: Exclude<RunTrigger, "schedule">) => `${trigger}:${randomUUID().slice(0, 13)}`;

export async function queueMeasurement(workspaceId: string, siteId: string, kind: RunKind, trigger: Exclude<RunTrigger, "schedule">): Promise<string> {
  const windowKey = oneOffWindow(trigger);
  await enqueue(QUEUE_FOR[kind], { workspaceId, siteId, windowKey, trigger }, { singletonKey: `${kind}:${siteId}:${windowKey}` });
  return windowKey;
}

/** After a Search Console or GA4 property is chosen: the first sync (and the 16-month backfill) starts in the worker. Best effort. */
export async function queueFirstSync(workspaceId: string, siteId: string, kind: "search_console" | "ga4"): Promise<void> {
  try {
    await queueMeasurement(workspaceId, siteId, kind === "search_console" ? "gsc" : "ga4", "connect");
    if (kind === "search_console") await queueMeasurement(workspaceId, siteId, "inspect", "connect");
  } catch (e) {
    log().warn("could not queue the first sync; the hourly tick will pick it up", { err: e instanceof Error ? e.message : String(e) });
  }
}
