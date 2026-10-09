/** Loads a site for a page, turning "not a uuid" and "not in this workspace" into the same 404. */
import { notFound } from "next/navigation";
import { readWorkspace } from "./actions.ts";
import { isUuid, NotFoundError, type Tx } from "./db/tenant.ts";
import { getSite, type Site } from "./data/sites.ts";
import type { WorkspaceAccess } from "./auth/app.ts";

export async function loadSite<T>(slug: string, siteId: string, more: (tx: Tx, site: Site, a: WorkspaceAccess) => Promise<T>): Promise<{ site: Site; a: WorkspaceAccess } & T> {
  if (!isUuid(siteId)) notFound();
  try {
    return await readWorkspace(slug, async (tx, a) => {
      const site = await getSite(tx, siteId);
      return { site, a, ...(await more(tx, site, a)) };
    });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
