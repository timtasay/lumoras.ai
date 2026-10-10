/**
 * Demo data consistency (owner request, 10 October 2026): every screen must
 * agree. A keyword is labelled "Published" in Rankings (its latest rank
 * snapshot, and the tracked list) only when a published article exists for
 * it, which is what the dashboard's "Articles live" counts.
 */
import assert from "node:assert/strict";
import { adminQuery } from "./db.ts";

export type SiteAgreement = { domain: string; live: number; publishedLabels: number };

export async function assertScreensAgree(dbName: string): Promise<SiteAgreement[]> {
  const sites = await adminQuery<{ id: string; domain: string; live: number }>(
    "SELECT s.id, s.domain, (SELECT count(*)::int FROM content_items c WHERE c.site_id = s.id AND c.status = 'published') AS live FROM sites s ORDER BY s.domain",
    [],
    dbName,
  );
  const out: SiteAgreement[] = [];
  for (const s of sites) {
    // what Rankings shows: the latest snapshot of each keyword
    const latest = await adminQuery<{ keyword: string; source: string; item_status: string | null }>(
      `SELECT DISTINCT ON (r.keyword) r.keyword, r.source, c.status AS item_status
         FROM rank_snapshots r LEFT JOIN content_items c ON c.id = r.item_id
        WHERE r.site_id = $1 ORDER BY r.keyword, r.captured_at DESC`,
      [s.id],
      dbName,
    );
    const labelled = latest.filter((r) => r.source === "published");
    for (const r of labelled) assert.equal(r.item_status, "published", `${s.domain}: Rankings labels "${r.keyword}" Published but no published article exists for it (Articles live ${s.live})`);
    assert.ok(labelled.length <= s.live, `${s.domain}: ${labelled.length} keywords labelled Published, ${s.live} articles live`);
    // the queue that labels future checks
    const queued = await adminQuery<{ keyword: string }>(
      "SELECT q.keyword FROM rank_tracking_queue q LEFT JOIN content_items c ON c.id = q.item_id WHERE q.site_id = $1 AND q.status <> 'removed' AND (c.id IS NULL OR c.status <> 'published')",
      [s.id],
      dbName,
    );
    assert.deepEqual(queued.map((q) => q.keyword), [], `${s.domain}: queued as published targets without a published article`);
    out.push({ domain: s.domain, live: s.live, publishedLabels: labelled.length });
  }
  return out;
}
