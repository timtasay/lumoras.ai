/** A workspace with one owner and one site, made through the same audited paths the app uses. */
import type pg from "pg";
import { withWorkspace } from "../../lib/db/tenant.ts";
import { createSite } from "../../lib/data/sites.ts";

export type TestWorkspace = { ws: string; user: string; site: string; domain: string };

export async function makeWorkspace(pool: pg.Pool, slug: string, domain = `${slug}.example`): Promise<TestWorkspace> {
  const [u] = (await pool.query<{ id: string }>("INSERT INTO auth_user (name, email) VALUES ($1, $2) RETURNING id", [slug, `${slug}@example.test`])).rows;
  const c = await pool.connect();
  let ws: string;
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.actor_id', $1, true)", [u.id]);
    ws = (await c.query<{ id: string }>("INSERT INTO auth_organization (name, slug) VALUES ($1, $2) RETURNING id", [slug, slug])).rows[0].id;
    await c.query("INSERT INTO auth_member (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [ws, u.id]);
    await c.query("COMMIT");
  } finally {
    c.release();
  }
  const site = await withWorkspace(pool, { workspaceId: ws, actorId: u.id }, (tx) =>
    createSite(tx, ws, { domain, name: slug, industry: "", locale: "en-US", country: "US", serpLocation: "United States", timezone: "UTC" }),
  );
  return { ws, user: u.id, site: site.id, domain };
}
