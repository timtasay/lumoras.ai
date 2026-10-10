/**
 * Phase 4 end to end, on the production build with the worker running. The
 * seed synced sonorch.ai's Search Console and GA4 from the local fake Google
 * (realistic Search Analytics / GA4 shapes, 16 months), bought 12 weeks of
 * rank checks, two audits and three backlink snapshots from the fake
 * provider, and connected Northwind's GA4 property whose tag is broken.
 *
 *   - the site dashboard: KPI tiles that count up (and land on the stored
 *     numbers), the 90-day clicks and impressions charts with their data
 *     tables, striking distance, rank movements, open audit issues;
 *   - rankings: the inverted position chart, cluster filter, published/saved;
 *   - audit: an issue's Fix creates one task (in the database), assignable;
 *     a viewer sees no Fix;
 *   - backlinks, search, the GA4 "broken tag reads like zero traffic" warning,
 *     the not-connected and empty states;
 *   - agency home: real health per workspace for a platform admin (audited),
 *     404 for everyone else;
 *   - every screen in both themes at 1440 and 375: no console errors, no
 *     sideways scroll; and a reduced-motion run (final numbers at once).
 */
import { expect, test, type Page } from "@playwright/test";
import { db, overflow, setTheme, shot, signIn, watchConsole, wideElements } from "./helpers";

const P4 = "seo-p4";

async function siteId(domain: string) {
  return (await (await db()).query<{ id: string }>("SELECT id FROM sites WHERE domain = $1", [domain])).rows[0].id;
}

async function check(page: Page, name: string, errors: string[]) {
  const o = await overflow(page);
  expect(o, `${name}: sideways scroll (${(await wideElements(page)).join(", ")})`).toBeLessThanOrEqual(0);
  expect(errors, `${name}: console errors`).toEqual([]);
}

/** Records the first KPI's visible number over time (installed before the page loads). */
async function recordCountUp(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __kpi: string[] };
    w.__kpi = [];
    const tick = () => {
      const el = document.querySelector(".kpi .kpi-value [aria-hidden]");
      if (el) w.__kpi.push(el.textContent ?? "");
      if (w.__kpi.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

test.describe.configure({ mode: "serial" });

test("site dashboard: KPIs count up to the stored Search Console numbers; 90-day charts, striking distance, rank movements, audit issues", async ({ page }) => {
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  await recordCountUp(page);
  const sonorch = await siteId("sonorch.ai");
  await signIn(page, "owner@lumoras.example", `/w/lumoras/sites/${sonorch}`);
  await expect(page.getByRole("heading", { level: 1, name: "sonorch.ai" })).toBeVisible();

  // the 28-day clicks the tile must land on: Search Console's totals as stored by the sync (Pacific days, through yesterday)
  const [want] = (await (await db()).query<{ c: string }>(
    "SELECT coalesce(sum(clicks), 0)::text AS c FROM gsc_daily WHERE site_id = $1 AND day > (now() AT TIME ZONE 'America/Los_Angeles')::date - 29 AND day <= (now() AT TIME ZONE 'America/Los_Angeles')::date - 1",
    [sonorch],
  )).rows;
  expect(Number(want.c)).toBeGreaterThan(100);
  const tile = page.locator(".kpi").filter({ hasText: "Organic clicks" });
  await expect(tile.locator(".sr-only")).toHaveText(Number(want.c).toLocaleString("en-US"));
  await expect(tile.locator(".kpi-value [aria-hidden]")).toHaveText(Number(want.c).toLocaleString("en-US"), { timeout: 5000 });
  const samples = await page.evaluate(() => (window as unknown as { __kpi: string[] }).__kpi);
  const nums = [...new Set(samples)].map((s) => Number(s.replace(/[^0-9.]/g, ""))).filter((n) => Number.isFinite(n));
  expect(nums.length, `the KPI did not count up (samples: ${[...new Set(samples)].slice(0, 6).join(", ")})`).toBeGreaterThan(3);
  expect(Math.min(...nums)).toBeLessThan(Number(want.c));

  for (const label of ["Impressions", "Average position", "Indexed pages", "Articles live", "Runway", "Credits this month"]) {
    await expect(page.locator(".kpi").filter({ hasText: label })).toBeVisible();
  }
  // two charts, 90 days each, with their data tables (provisional days marked)
  const clicks = page.getByRole("group", { name: "Organic clicks" });
  await expect(clicks.locator("svg path.series-line")).toHaveCount(1);
  await expect(clicks.locator("table tbody tr")).toHaveCount(90);
  await expect(clicks.locator("table")).toContainText("(provisional)");
  await expect(page.getByRole("group", { name: "Impressions" }).locator("table tbody tr")).toHaveCount(90);

  const sd = page.getByRole("region", { name: "Striking-distance queries" });
  await expect(sd.getByRole("rowheader", { name: /salon no show policy/ })).toBeVisible();
  await expect(sd.getByRole("rowheader", { name: /salon software/ })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Recent rank movements" }).locator("li")).toHaveCount(7);
  await expect(page.locator(".move").first()).toBeVisible();
  await expect(page.locator(".issues-mini li").first()).toContainText(/broken internal links|titles over 60 characters/);
  await expect(page.locator(".next-up li").first()).toBeVisible();
  await page.waitForTimeout(1300);
  await shot(page, "site-dashboard-dark-1440", P4);
  await check(page, "dashboard", errors);
});

test("rankings: position chart (inverted), cluster filter, published vs saved, movement badges", async ({ page }) => {
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  const sonorch = await siteId("sonorch.ai");
  await signIn(page, "editor@lumoras.example", `/w/lumoras/sites/${sonorch}/rankings`);
  const chart = page.getByRole("group", { name: "Position over time" });
  await expect(chart.locator("path.series-line")).toHaveCount(4);
  await expect(chart.locator("table thead th")).toHaveCount(5); // week + four keywords
  // #1 at the top: the first y tick is "#1"
  await expect(chart.locator("text.axis").first()).toHaveText("#1");
  const rows = page.getByRole("region", { name: "Tracked keywords" }).locator("tbody tr");
  const all = await rows.count();
  expect(all).toBeGreaterThan(5);
  await page.getByRole("radio", { name: /^Published/ }).click();
  await expect(rows.filter({ hasText: "Saved" })).toHaveCount(0);
  const published = await rows.count();
  expect(published).toBeGreaterThan(0);
  expect(published).toBeLessThan(all);
  await page.getByRole("radio", { name: /^All/ }).click();
  await page.getByLabel("Cluster").selectOption("Policies");
  await expect(rows).not.toHaveCount(all);
  for (const r of await rows.all()) await expect(r.locator("td").nth(4)).toHaveText("Policies");
  await page.getByLabel("Cluster").selectOption("");
  await expect(rows).toHaveCount(all);
  // pick a different keyword for the chart from the table
  await rows.nth(5).getByRole("checkbox").check();
  await expect(chart.locator("table thead th")).toContainText([await rows.nth(5).locator("th .q").innerText()]);
  await expect(page.locator(".move[data-dir]").first()).toBeVisible();
  await page.waitForTimeout(1100);
  await shot(page, "rankings-dark-1440", P4);
  await check(page, "rankings", errors);
});

test("audit: issues grouped by type and severity; Fix creates one task (in the database), assignable; a viewer cannot fix", async ({ page, browser }) => {
  const errors = watchConsole(page);
  await setTheme(page, "light");
  await page.setViewportSize({ width: 1440, height: 900 });
  const sonorch = await siteId("sonorch.ai");
  await signIn(page, "editor@lumoras.example", `/w/lumoras/sites/${sonorch}/audit`);
  await expect(page.getByRole("heading", { name: "Links and status codes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Titles and descriptions" })).toBeVisible();
  const issue = page.locator(".audit-issues li").filter({ hasText: "17 titles over 60 characters" });
  await expect(issue.locator(".sev")).toHaveText("Warning");
  await issue.getByRole("button", { name: /Fix: create a task/ }).click();
  await expect(page.getByText("Task created.")).toBeVisible();
  const tasks = page.getByRole("region", { name: "Tasks" });
  await expect(tasks.getByRole("rowheader", { name: /Shorten 17 titles over 60 characters/ })).toBeVisible();
  await expect(issue.getByRole("button", { name: /Fix/ })).toHaveCount(0);
  const pool = await db();
  const t = (await pool.query<{ n: string }>("SELECT count(*) AS n FROM tasks WHERE site_id = $1 AND title = 'Shorten 17 titles over 60 characters' AND status <> 'done'", [sonorch])).rows[0];
  expect(Number(t.n)).toBe(1);
  // assign it to the reviewer (a member)
  await issue.getByLabel(/Assign/).selectOption({ label: "Demo reviewer, Lumoras" });
  await expect(page.getByText("Assigned.")).toBeVisible();
  const a = (await pool.query<{ assignee_id: string | null; action: string }>("SELECT i.assignee_id, (SELECT action FROM audit_log WHERE entity_type = 'audit_issues' AND entity_id = i.id::text ORDER BY id DESC LIMIT 1) AS action FROM audit_issues i JOIN audits au ON au.id = i.audit_id WHERE i.site_id = $1 AND i.issue_type = 'title_too_long' ORDER BY au.started_at DESC LIMIT 1", [sonorch])).rows[0];
  expect(a.assignee_id).not.toBeNull();
  expect(a.action).toBe("task.assign");
  await page.waitForTimeout(600);
  await shot(page, "audit-light-1440", P4);
  await check(page, "audit", errors);

  const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const viewer = await vctx.newPage();
  await signIn(viewer, "viewer@lumoras.example", `/w/lumoras/sites/${sonorch}/audit`);
  await expect(viewer.getByRole("heading", { name: "Titles and descriptions" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: /Fix/ })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: /Audit now/ })).toHaveCount(0);
  await vctx.close();
});

test("backlinks, search and GA4: profile over time, new and lost, competitors; index status; the broken-tag warning", async ({ page }) => {
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  const sonorch = await siteId("sonorch.ai");
  await signIn(page, "owner@lumoras.example", `/w/lumoras/sites/${sonorch}/backlinks`);
  await expect(page.getByRole("group", { name: "Referring domains over time" }).locator("table tbody tr")).toHaveCount(3);
  await expect(page.getByRole("group", { name: "New and lost referring domains" })).toBeVisible();
  const comp = page.getByRole("group", { name: "Against the competitors" });
  await expect(comp.locator("table tbody tr")).toHaveCount(3);
  await expect(comp).toContainText("salon-suite.example");
  await page.waitForTimeout(1000);
  await shot(page, "backlinks-dark-1440", P4);
  await check(page, "backlinks", errors);

  await page.goto(`/w/lumoras/sites/${sonorch}/search`);
  await expect(page.getByRole("region", { name: "Top queries table" }).locator("tbody tr").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Index status of each URL" })).toContainText("Indexed");
  await expect(page.getByRole("region", { name: "Organic landing pages" })).toContainText("/insights/no-show-policy");
  await expect(page.locator(".health-panel")).toHaveAttribute("data-state", "ok");
  await page.waitForTimeout(1000);
  await shot(page, "search-dark-1440", P4);
  await check(page, "search", errors);
});

test("GA4 measurement health: a broken tag is announced as not measuring, next to Search Console's clicks", async ({ page }) => {
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  const nw = await siteId("northwind-dental.example");
  await signIn(page, "owner@northwind-dental.example", `/w/northwind-dental/sites/${nw}`);
  const alert = page.getByRole("alert").filter({ hasText: "GA4 measurement health" });
  await expect(alert).toContainText("zero here does not mean zero traffic");
  await page.waitForTimeout(1100);
  await shot(page, "ga4-health-warning-dark-1440", P4);
  await page.goto(`/w/northwind-dental/sites/${nw}/search`);
  const panel = page.locator(".health-panel");
  await expect(panel).toHaveAttribute("data-state", "error");
  await expect(panel).toContainText("no sessions at all");
  await expect(panel).toContainText(/Search Console counted [0-9,]+ clicks|recorded no sessions/);
  await page.waitForTimeout(1200);
  await shot(page, "ga4-health-warning-search-dark-1440", P4);
  await setTheme(page, "light");
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`/w/northwind-dental/sites/${nw}`);
  await expect(page.getByRole("alert").filter({ hasText: "GA4 measurement health" })).toBeVisible();
  await page.waitForTimeout(1100);
  await shot(page, "ga4-health-warning-light-375", P4);
  await check(page, "ga4 health", errors);
});

test("empty and not-connected states: the next action is the primary button", async ({ page }) => {
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  const seasonx = await siteId("seasonx.ai");
  await signIn(page, "owner@lumoras.example", `/w/lumoras/sites/${seasonx}`);
  await expect(page.getByRole("heading", { name: "Connect Search Console" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect Search Console" })).toHaveClass(/btn-primary/);
  // no Search Console yet: a dash, never a zero that reads like zero traffic
  const clicks = page.locator(".kpi").filter({ has: page.locator(".kpi-label", { hasText: /^Organic clicks$/ }) });
  await expect(clicks.locator(".kpi-value [aria-hidden]")).toHaveText("–");
  await expect(clicks.locator(".kpi-value .sr-only")).toHaveText("No data yet");
  await shot(page, "empty-dashboard-not-connected-dark-1440", P4);
  await page.goto(`/w/lumoras/sites/${seasonx}/rankings`);
  await expect(page.getByRole("heading", { name: "Nothing to track yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Choose keywords to track" })).toHaveClass(/btn-primary/);
  await shot(page, "empty-rankings-dark-1440", P4);
  await page.goto(`/w/lumoras/sites/${seasonx}/search`);
  await expect(page.getByRole("heading", { name: "Connect GA4" })).toBeVisible();
  await setTheme(page, "light");
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`/w/lumoras/sites/${seasonx}/search`);
  await expect(page.getByRole("heading", { name: "Connect Search Console" })).toBeVisible();
  await shot(page, "empty-search-not-connected-light-375", P4);
  await check(page, "empty states", errors);
});

test("agency home: every workspace with real health for a platform admin (audited); 404 for everyone else", async ({ page, browser }) => {
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "staff@lumoras.example", "/agency");
  const lumoras = page.locator(".agency-card").filter({ has: page.getByRole("heading", { name: "Lumoras", exact: true }) });
  await expect(lumoras.locator(".ag-num")).toHaveText(/^[0-9,.]+k?[+−]/);
  await expect(lumoras.getByRole("img", { name: /organic clicks per week/ })).toBeVisible();
  await expect(lumoras.getByRole("list", { name: "Health of Lumoras" })).toContainText("Runway");
  await expect(lumoras.getByRole("list", { name: "Health of Lumoras" })).toContainText("Published this month");
  await expect(lumoras.getByRole("list", { name: "Health of Lumoras" })).toContainText("Awaiting review");
  const nw = page.locator(".agency-card").filter({ hasText: "Northwind Dental (demo)" });
  await expect(nw.getByRole("list", { name: /Health of Northwind/ })).toContainText(/connection/);
  const pool = await db();
  const [audit] = (await pool.query<{ email: string }>("SELECT u.email FROM audit_log a JOIN auth_user u ON u.id::text = a.actor_id WHERE a.action = 'platform.health.read' ORDER BY a.id DESC LIMIT 1")).rows;
  expect(audit.email).toBe("staff@lumoras.example");
  await page.waitForTimeout(1000);
  await shot(page, "agency-home-dark-1440", P4);
  await check(page, "agency", errors);

  const octx = await browser.newContext();
  const owner = await octx.newPage();
  await signIn(owner, "owner@lumoras.example");
  expect((await owner.request.get("/agency")).status()).toBe(404);
  await octx.close();
});

test("reduced motion: KPIs show their final value at once and charts do not animate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  await recordCountUp(page);
  const sonorch = await siteId("sonorch.ai");
  await signIn(page, "owner@lumoras.example", `/w/lumoras/sites/${sonorch}`);
  const tile = page.locator(".kpi").filter({ hasText: "Organic clicks" });
  const final = await tile.locator(".sr-only").innerText();
  await expect(tile.locator(".kpi-value [aria-hidden]")).toHaveText(final);
  const samples = [...new Set(await page.evaluate(() => (window as unknown as { __kpi: string[] }).__kpi))].filter((s) => s !== final);
  expect(samples.length, `values on the way to ${final}: ${samples.join(", ")}`).toBeLessThanOrEqual(1); // at most the server-rendered 0
  const secs = (v: string) => Math.max(...v.split(",").map((x) => (x.trim().endsWith("ms") ? parseFloat(x) / 1000 : parseFloat(x))));
  for (const sel of [".series-line.draw", ".reveal", ".spark-line"]) {
    const d = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationDuration);
    expect(secs(d), sel).toBeLessThanOrEqual(0.001);
  }
  await shot(page, "site-dashboard-reduced-motion-dark-1440", P4);
});

const SCREENS: [string, (ids: Record<string, string>) => string, string][] = [
  ["site-dashboard", (i) => `/w/lumoras/sites/${i.sonorch}`, "owner@lumoras.example"],
  ["rankings", (i) => `/w/lumoras/sites/${i.sonorch}/rankings`, "owner@lumoras.example"],
  ["search", (i) => `/w/lumoras/sites/${i.sonorch}/search`, "owner@lumoras.example"],
  ["audit", (i) => `/w/lumoras/sites/${i.sonorch}/audit`, "owner@lumoras.example"],
  ["backlinks", (i) => `/w/lumoras/sites/${i.sonorch}/backlinks`, "owner@lumoras.example"],
  ["workspace-overview", () => `/w/lumoras`, "owner@lumoras.example"],
  ["site-settings-measurement", (i) => `/w/lumoras/sites/${i.sonorch}/settings#measurement`, "owner@lumoras.example"],
  ["lumoras-dashboard", (i) => `/w/lumoras/sites/${i.lumoras}`, "owner@lumoras.example"],
  ["agency-home", () => `/agency`, "staff@lumoras.example"],
];

for (const theme of ["dark", "light"] as const) {
  for (const width of [1440, 375]) {
    test(`Phase 4 screens, ${theme} at ${width}px: no sideways scroll, no console errors`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 900 });
      const ids = { sonorch: await siteId("sonorch.ai"), lumoras: await siteId("lumoras.ai") };
      let who = "";
      for (const [name, url, email] of SCREENS) {
        if (email !== who) {
          await page.context().clearCookies();
          await signIn(page, email, url(ids));
          who = email;
        } else await page.goto(url(ids));
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1200); // count-ups and draw-ins finish (1.1 s) before the screenshot
        await check(page, `${name} ${theme} ${width}`, errors);
        await shot(page, `${name}-${theme}-${width}`, P4);
      }
    });
  }
}

test("site settings: measurement cadences save (and are audited); the site dashboard's Sync now queues a free sync", async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const lum = await siteId("lumoras.ai");
  await signIn(page, "editor@lumoras.example", `/w/lumoras/sites/${lum}/settings`);
  const form = page.locator(".measure-form");
  await form.getByLabel("How often").selectOption("fortnightly");
  await form.getByLabel("Pages per audit").fill("300");
  await form.getByRole("button", { name: "Save measurement settings" }).click();
  await expect(page.getByText("Measurement settings saved.")).toBeVisible();
  const pool = await db();
  const [s] = (await pool.query<{ rank_cadence: string; audit_max_pages: number }>("SELECT rank_cadence, audit_max_pages FROM sites WHERE id = $1", [lum])).rows;
  expect(s).toEqual({ rank_cadence: "fortnightly", audit_max_pages: 300 });
  expect((await pool.query("SELECT 1 FROM audit_log WHERE action = 'site.measurement' AND entity_id = $1", [lum])).rows.length).toBeGreaterThan(0);
  await form.getByLabel("How often").selectOption("weekly");
  await form.getByRole("button", { name: "Save measurement settings" }).click();
  await expect(page.getByText("Measurement settings saved.")).toBeVisible();
  // the worker runs a manual rank check (priced first) and records it
  await page.goto(`/w/lumoras/sites/${lum}/rankings`);
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByText(/Rank check queued/)).toBeVisible();
  await expect
    .poll(async () => (await pool.query<{ status: string }>("SELECT status FROM measurement_runs WHERE site_id = $1 AND kind = 'rank' AND trigger = 'manual' ORDER BY started_at DESC LIMIT 1", [lum])).rows[0]?.status, { timeout: 30_000 })
    .toBe("succeeded");
  expect(errors).toEqual([]);
});
