import type { GoogleCard } from "@/components/google/GoogleConnections";
import type { GoogleConnection } from "./service.ts";
import type { GoogleKind } from "./oauth.ts";

/** Safe, serialisable view of Google connections for the browser (no token, no ciphertext). */
export function googleCards(g: Partial<Record<GoogleKind, GoogleConnection>>): Partial<Record<GoogleKind, GoogleCard>> {
  const out: Partial<Record<GoogleKind, GoogleCard>> = {};
  for (const k of ["search_console", "ga4"] as const) {
    const c = g[k];
    if (c) out[k] = { property: c.property, propertyLabel: c.propertyLabel, status: c.status, detail: c.status_detail, lastTested: c.last_tested_at?.toISOString() ?? null, connectedBy: c.connectedBy, connectedAt: c.connectedAt };
  }
  return out;
}
