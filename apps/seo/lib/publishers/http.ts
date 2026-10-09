/**
 * JSON over the SSRF guard, for publishers. Every request to a client's Git
 * host or webhook goes through safeFetch: DNS checked on every hop,
 * connection pinned to the vetted address, size and time capped, writes
 * never redirected. Credentials go in headers built by the caller and never
 * appear in errors or logs.
 */
import { safeFetch, SsrfError, type SafeFetchPolicy } from "../net/safe-fetch.ts";
import { PublishError } from "./types.ts";

export type HttpDeps = { policy?: SafeFetchPolicy; timeoutMs?: number; userAgent?: string };
export type JsonResponse = { status: number; json: unknown; text: string; headers: Record<string, string | string[] | undefined> };

export const PUBLISHER_UA = "LumorasGrowth-Publisher/1.0 (+https://lumoras.ai)";

export async function requestJson(
  deps: HttpDeps,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown; rawBody?: string } = {},
): Promise<JsonResponse> {
  const body = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  let r;
  try {
    r = await safeFetch(url, {
      method,
      body,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers },
      accept: "application/json",
      userAgent: deps.userAgent ?? PUBLISHER_UA,
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: deps.timeoutMs ?? 20_000,
      maxRedirects: 3,
      policy: deps.policy,
    });
  } catch (e) {
    if (e instanceof SsrfError) throw new PublishError(`${new URL(url).host} is not reachable from here: ${e.message}`, { retryable: e.code === "timeout" || e.code === "network" });
    throw new PublishError(`request to ${new URL(url).host} failed`, { retryable: true });
  }
  const text = r.body.toString("utf8");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: r.status, json, text, headers: r.headers };
}

export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A message for people from an error response (provider text is untrusted: trimmed and length-capped). */
export function remoteMessage(r: JsonResponse): string {
  const m = str(obj(r.json).message) || r.text;
  return m.replace(/\s+/g, " ").slice(0, 200);
}
