/**
 * Research inside the web app: the access checks every research action makes
 * (member, permission, rate limit, the site, its brand lists and market),
 * then the metered path with the configured provider.
 */
import { requireWorkspace, type WorkspaceAccess } from "../auth/app.ts";
import { assertCan, type Permission } from "../auth/permissions.ts";
import { webEnv } from "../config.ts";
import { pool } from "../db/pool.ts";
import { isUuid, NotFoundError, withWorkspace } from "../db/tenant.ts";
import { getBrand, getSite, type Site } from "../data/sites.ts";
import type { MeterContext, MeterDeps } from "../metering/metered.ts";
import { provider } from "../providers/registry.ts";
import type { Market } from "../providers/types.ts";
import { hit, LIMITS } from "../rate-limit.ts";
import { marketFor } from "./market.ts";
import type { BrandLists, SiteForResearch } from "./service.ts";

export class ProviderMissingError extends Error {
  constructor() {
    super("No SEO data provider is configured, so paid research is unavailable. Lumoras staff set SEO_PROVIDER.");
    this.name = "ProviderMissingError";
  }
}

export type ResearchScope = {
  a: WorkspaceAccess;
  site: Site & SiteForResearch;
  brand: BrandLists;
  market: Market;
  ctx: MeterContext;
  /** Null only when called with needProvider: false and no provider is configured. */
  deps: MeterDeps;
};

/** Member + permission + (for paid work) rate limits; then the site, its brand lists and its market. */
export async function researchScope(slug: string, siteId: string, permission: Permission, opts: { rateLimit?: boolean; needProvider?: boolean } = {}): Promise<ResearchScope> {
  if (!isUuid(siteId)) throw new NotFoundError("site");
  const a = await requireWorkspace(slug);
  assertCan(a.role, permission);
  const p = provider();
  if (!p && opts.needProvider !== false) throw new ProviderMissingError();
  if (opts.rateLimit) {
    const scale = webEnv().rateLimitScale;
    await hit(pool(), LIMITS.researchPerUser, a.viewer.user.id, scale);
    await hit(pool(), LIMITS.researchPerWorkspace, a.workspace.id, scale);
  }
  const { site, brand } = await withWorkspace(pool(), a.ctx, async (tx) => ({ site: await getSite(tx, siteId), brand: await getBrand(tx, siteId) }), { readOnly: true });
  return {
    a,
    site: site as Site & SiteForResearch,
    brand: { sells: brand.sells, does_not_sell: brand.does_not_sell },
    market: marketFor(site),
    ctx: { ...a.ctx, siteId },
    // without a provider (needProvider: false) the deps are unusable for calls; callers that pass it only read
    deps: { db: pool(), provider: p! },
  };
}
