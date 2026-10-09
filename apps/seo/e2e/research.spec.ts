/**
 * Phase 2 end to end, on the production build with the fake SEO provider and
 * a fake Google (e2e/serve.ts): research with the cost-confirm step, rule 4
 * (no second purchase), a free cache hit, saving and bulk-changing keywords,
 * the seed backlog, budget refusal, Budget and usage with its CSV, connecting
 * Search Console and GA4 through OAuth (state + PKCE) and the opportunities
 * they unlock, a viewer who cannot run research, every Phase 2 screen in both
 * themes at 375 and 1440 px, and reduced motion. Asserts on data and
 * structure, never on generated wording.
 */
import { expect, test, type Page } from "@playwright/test";
import { db, overflow, setTheme, shot, signIn, watchConsole, wideElements } from "./helpers";

const P2 = "seo-p2";

async function siteIds() {
  const r = await (await db()).query<{ domain: string; id: string; workspace_id: string }>("SELECT domain, id, workspace_id FROM sites WHERE domain IN ('sonorch.ai', 'seasonx.ai', 'lumoras.ai', 'northwind-dental.example')");
  return Object.fromEntries(r.rows.map((x) => [x.domain, x])) as Record<string, { id: string; workspace_id: string }>;
}

/** Ledger rows of one workspace; in the Lumoras workspace, only sonorch.ai's SEO-data rows (the Phase 3 pipeline writes rows for its other sites in parallel). */
async function ledgerCount(workspaceId: string) {
  return Number((await (await db()).query<{ n: string }>(
    "SELECT count(*) AS n FROM usage_ledger WHERE workspace_id = $1 AND (workspace_id <> (SELECT workspace_id FROM sites WHERE domain = 'sonorch.ai') OR (category = 'seo_credits' AND site_id = (SELECT id FROM sites WHERE domain = 'sonorch.ai')))",
    [workspaceId],
  )).rows[0].n);
}

test.describe.configure({ mode: "serial" });

test("keyword research: price first, confirm, results, rule 4, a free cache hit, save and bulk-change", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await siteIds();
  const sonorch = ids["sonorch.ai"];
  await signIn(page, "editor@lumoras.example", `/w/lumoras/sites/${sonorch.id}/keywords`);
  await expect(page.getByRole("heading", { level: 1, name: "sonorch.ai" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Saved keywords/ })).toBeVisible();
  await shot(page, "keywords-dark-1440", P2);

  // 1. price first: nothing is bought until the person confirms
  const before = await ledgerCount(sonorch.workspace_id);
  await page.getByLabel("Seed keyword").fill("Salon Booking Software");
  await page.getByRole("button", { name: "Get the price" }).click();
  const confirm = page.getByRole("button", { name: /Confirm and run · \$0\.0300/ });
  await expect(confirm).toBeVisible();
  await expect(page.getByRole("img", { name: /SEO data budget this month: .* used/ })).toBeVisible();
  expect(await ledgerCount(sonorch.workspace_id), "a quote spent money").toBe(before);
  await shot(page, "research-cost-confirm-dark-1440", P2);
  await confirm.click();

  // 2. results: grouped targets, charged at the provider's actual cost (10 rows: $0.0132)
  const results = page.getByRole("region", { name: "Research results" });
  await expect(results.getByText("Bought · $0.0132")).toBeVisible();
  await expect(results.getByRole("rowheader", { name: /^salon booking software/ })).toBeVisible();
  const pool = await db();
  const led = (await pool.query<{ status: string; cost_micros: string; estimate_micros: string; cached: boolean }>("SELECT status, cost_micros, estimate_micros, cached FROM usage_ledger WHERE workspace_id = $1 AND category = 'seo_credits' AND site_id = $2 ORDER BY id DESC LIMIT 1", [sonorch.workspace_id, sonorch.id])).rows[0];
  expect(led).toEqual({ status: "settled", cost_micros: "13200", estimate_micros: "30000", cached: false });
  await results.getByRole("checkbox", { name: "Select salon booking software" }).check();
  await results.getByRole("checkbox", { name: "Select salon scheduling software" }).check();
  await results.getByRole("button", { name: "Save 2 to keywords" }).click();
  await expect(page.getByText("Saved 2 keywords.")).toBeVisible();
  await shot(page, "research-results-dark-1440", P2);

  // 3. rule 4: the same seed is not bought again inside the site's maximum age
  const afterBuy = await ledgerCount(sonorch.workspace_id);
  await page.getByLabel("Seed keyword").fill("salon booking software");
  await page.getByRole("button", { name: "Get the price" }).click();
  await expect(page.getByText("Already researched")).toBeVisible();
  await page.getByRole("button", { name: "Show the logged results · free" }).click();
  await expect(results.getByText("From the research log · free")).toBeVisible();
  expect(await ledgerCount(sonorch.workspace_id), "a logged seed was bought again").toBe(afterBuy);

  // rule 7 on a logged seed: what the business does not sell is hidden unless asked for
  await page.getByLabel("Seed keyword").fill("salon pos");
  await page.getByRole("button", { name: "Get the price" }).click();
  await page.getByRole("button", { name: "Show the logged results · free" }).click();
  await expect(results.getByRole("rowheader", { name: /restaurant pos system/ })).toHaveCount(0);
  await results.getByRole("button", { name: /Show what the business does not sell/ }).click();
  await expect(results.getByRole("rowheader", { name: /restaurant pos system/ })).toContainText("Does not sell");
  await expect(results.getByRole("checkbox", { name: "Select restaurant pos system" })).toBeDisabled();

  // 4. a repeated SERP within expiry is free: a zero-cost cached ledger entry
  await page.getByRole("radio", { name: "SERP for a keyword" }).click();
  await page.getByLabel("Keyword", { exact: true }).fill("salon no show policy");
  await page.getByRole("button", { name: "Get the price" }).click();
  await expect(page.getByText("from the cache", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show the saved result" }).click();
  await expect(results.getByText("Cache hit · free")).toBeVisible();
  const hit = (await pool.query<{ cached: boolean; cost_micros: string; operation: string }>("SELECT cached, cost_micros, operation FROM usage_ledger WHERE workspace_id = $1 AND category = 'seo_credits' AND site_id = $2 ORDER BY id DESC LIMIT 1", [sonorch.workspace_id, sonorch.id])).rows[0];
  expect(hit).toEqual({ cached: true, cost_micros: "0", operation: "serp" });

  // 5. the research log: costs, cache hits
  await page.reload();
  await page.getByRole("tab", { name: /Research log/ }).click();
  const log = page.getByRole("region", { name: "Research log for this site" });
  await expect(log.getByText("Cache hit").first()).toBeVisible();
  await expect(log.getByRole("row", { name: /salon booking software/ }).first()).toContainText("$0.0132");
  await shot(page, "research-log-dark-1440", P2);

  // 6. saved keywords: filter and bulk status change
  await page.getByRole("tab", { name: /Saved keywords/ }).click();
  const table = page.getByRole("region", { name: /Saved keywords/ });
  await table.getByRole("checkbox", { name: "Select salon booking software" }).check();
  await table.getByRole("checkbox", { name: "Select salon scheduling software" }).check();
  await page.getByLabel("New status").selectOption("targeted");
  await page.getByRole("button", { name: "Set status" }).click();
  await expect(page.getByText("Marked targeted: 2 keywords.")).toBeVisible();
  const st = (await pool.query<{ keyword: string; status: string }>("SELECT keyword, status FROM keywords WHERE site_id = $1 AND keyword IN ('salon booking software', 'salon scheduling software') ORDER BY keyword", [sonorch.id])).rows;
  expect(st).toEqual([{ keyword: "salon booking software", status: "targeted" }, { keyword: "salon scheduling software", status: "targeted" }]);

  // 7. the seed backlog: add, then it shows as up next
  await page.getByRole("tab", { name: /Seed backlog/ }).click();
  await page.getByLabel("Seeds to research").fill("Barbershop booking app\nsalon pos");
  await page.getByRole("button", { name: "Add to the backlog" }).click();
  await expect(page.getByText("Added 1 seed (1 already in the backlog).")).toBeVisible();
  await expect(page.getByRole("list", { name: "Seed backlog" })).toContainText("barbershop booking app");
  await shot(page, "seed-backlog-dark-1440", P2);
  expect(errors).toEqual([]);
});

test("budget refusal: a lookup that would cross the reserve is refused before anything is bought", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchConsole(page);
  await setTheme(page, "light");
  await page.setViewportSize({ width: 1440, height: 900 });
  const nw = (await siteIds())["northwind-dental.example"];
  await signIn(page, "owner@northwind-dental.example", "/w/northwind-dental/settings/budget");
  await expect(page.getByRole("heading", { level: 1, name: "Budget and usage" })).toBeVisible();

  // the owner lowers the SEO budget: $0.05 a month with a $0.03 reserve leaves $0.02, below a $0.03 lookup
  const card = page.getByRole("region", { name: "SEO data" });
  await card.getByLabel("Monthly ceiling (US$)").fill("0.05");
  await card.getByLabel("Reserve (US$)").fill("0.06");
  await card.getByRole("button", { name: "Save seo data" }).click();
  await expect(card.getByText("The reserve cannot be more than the monthly ceiling")).toBeVisible();
  await card.getByLabel("Reserve (US$)").fill("0.03");
  await card.getByRole("button", { name: "Save seo data" }).click();
  await expect(page.getByText("Budget saved.")).toBeVisible();

  await page.goto(`/w/northwind-dental/sites/${nw.id}/keywords`);
  await page.getByLabel("Seed keyword").fill("dental implants");
  await page.getByRole("button", { name: "Get the price" }).click();
  const refusal = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "This lookup would cross the reserve" }) });
  await expect(refusal).toBeVisible();
  await expect(refusal.getByText("Nothing was bought and nothing was charged.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Confirm and run/ })).toHaveCount(0);
  await shot(page, "budget-refusal-light-1440", P2);
  expect(await ledgerCount(nw.workspace_id)).toBe(0);
  await page.setViewportSize({ width: 375, height: 900 });
  await shot(page, "budget-refusal-light-375", P2);
  expect(errors).toEqual([]);
});

test("Budget and usage: chart with a data table, ledger, CSV export", async ({ page }) => {
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "owner@lumoras.example", "/w/lumoras/settings/budget");
  await expect(page.getByRole("heading", { level: 1, name: "Budget and usage" })).toBeVisible();
  await expect(page.getByRole("table", { name: "SEO data spend per day, this month" })).toBeAttached();
  await expect(page.getByRole("region", { name: "Usage ledger, this month" })).toContainText("cache hit");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Export .* as CSV/ }).click()]);
  const csv = await (await download.createReadStream())!.toArray().then((c) => Buffer.concat(c).toString("utf8"));
  const lines = csv.trim().split("\r\n");
  expect(lines[0]).toBe("id,created_at,site,category,operation,provider,status,cached,units,estimate_micros,cost_micros,cost_usd,actor,detail");
  expect(lines.length).toBeGreaterThan(3);
  expect(csv).toContain("sonorch.ai,seo_credits,keywordIdeas,fake,settled,false");
  await shot(page, "budget-usage-dark-1440", P2);
  expect(errors).toEqual([]);
});

test("connect Search Console and GA4 through Google OAuth (state + PKCE), then see opportunities", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = (await siteIds())["sonorch.ai"];
  const base = `/w/lumoras/sites/${s.id}`;
  await signIn(page, "editor@lumoras.example", `${base}/connections`);
  const gsc = page.getByRole("region", { name: "Google Search Console" });
  const ga = page.getByRole("region", { name: "Google Analytics 4" });
  await expect(gsc.getByText("Not connected")).toBeVisible();
  await shot(page, "connections-google-disconnected-dark-1440", P2);

  // a callback without the flow cookie is refused and connects nothing
  const forged = await page.request.get("/api/google/callback?state=forged&code=4%2Fstolen", { maxRedirects: 0 });
  expect(forged.status()).toBe(303);
  expect(forged.headers().location).toMatch(/\?google=error&reason=missing$/);
  expect((await (await db()).query("SELECT 1 FROM connections WHERE site_id = $1 AND kind = 'search_console'", [s.id])).rows).toEqual([]);

  // the real flow: our server → fake Google consent → callback (state checked, code exchanged with the PKCE verifier)
  await page.goto(`${base}/connections`);
  await gsc.getByRole("button", { name: "Connect Search Console" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/connections\\?google=connected&kind=search_console$`));
  await expect(gsc.getByText("Working")).toBeVisible();
  await expect(gsc).toContainText("sc-domain:sonorch.ai");
  await gsc.getByRole("button", { name: "Test" }).click();
  await expect(page.getByText(/Reading sc-domain:sonorch\.ai/).first()).toBeVisible();

  await ga.getByRole("button", { name: "Connect GA4" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/connections\\?google=connected&kind=ga4$`));
  await page.waitForLoadState("load");
  await expect(ga.getByText("Working")).toBeVisible();
  await shot(page, "connections-google-connected-dark-1440", P2);

  // the refresh token is stored encrypted and never reaches the page
  const read = async () => (await (await db()).query<{ kind: string; c: string }>("SELECT kind, credentials_ciphertext AS c FROM connections WHERE site_id = $1 AND kind IN ('search_console', 'ga4') ORDER BY kind", [s.id])).rows;
  await expect.poll(async () => (await read()).map((r) => r.kind)).toEqual(["ga4", "search_console"]);
  const rows = await read();
  for (const r of rows) expect(r.c).toMatch(/^v1\./);
  await page.waitForLoadState("load");
  const html = await page.content();
  expect(html).not.toContain("fake-refresh");
  for (const r of rows) expect(html).not.toContain(r.c);

  // a different property for GA4 whose tag is broken: the light turns red
  await ga.getByRole("button", { name: "Change property" }).click();
  await ga.getByLabel("GA4 property").selectOption("properties/333333333");
  await ga.getByRole("button", { name: "Use this property" }).click();
  await expect(ga.getByText("Failing")).toBeVisible();
  await expect(ga).toContainText("tag may be missing or broken");
  await shot(page, "connections-google-states-dark-1440", P2);
  await page.setViewportSize({ width: 375, height: 900 });
  await shot(page, "connections-google-states-dark-375", P2);
  await page.setViewportSize({ width: 1440, height: 900 });

  // the site overview shows striking-distance queries (positions 4–20) from Search Console
  await page.goto(base);
  const opp = page.getByRole("region", { name: "Striking-distance queries" });
  await expect(opp.getByRole("rowheader", { name: /salon no show policy/ })).toBeVisible();
  await expect(opp.getByRole("rowheader", { name: /salon software/ })).toHaveCount(0); // position 34: not striking distance
  await shot(page, "site-overview-opportunities-dark-1440", P2);

  // disconnect revokes and removes
  await page.goto(`${base}/connections`);
  await ga.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText(/Disconnected, and access revoked at Google/)).toBeVisible();
  await expect(ga.getByText("Not connected")).toBeVisible();
  const actions = (await (await db()).query<{ action: string }>("SELECT DISTINCT action FROM audit_log WHERE workspace_id = $1 AND action LIKE 'connection.%'", [s.workspace_id])).rows.map((r) => r.action);
  expect(actions).toEqual(expect.arrayContaining(["connection.google_connect", "connection.google_property", "connection.test", "connection.google_disconnect"]));
  expect(errors).toEqual([]);
});

test("a viewer sees research, costs and the budget, and cannot run, save or change anything", async ({ page }) => {
  const errors = watchConsole(page);
  const s = (await siteIds())["sonorch.ai"];
  await signIn(page, "viewer@lumoras.example", `/w/lumoras/sites/${s.id}/keywords`);
  await expect(page.getByText("Your role can see research and its costs. Editors and owners run it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Get the price" })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("tab", { name: /Seed backlog/ }).click();
  await expect(page.getByText("Your role can see the backlog.")).toBeVisible();
  await page.goto("/w/lumoras/settings/budget");
  await expect(page.getByText("Owners change the ceilings and reserves.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Save / })).toHaveCount(0);
  await page.goto(`/w/lumoras/sites/${s.id}/connections`);
  await expect(page.getByRole("button", { name: /Connect (Search Console|GA4)/ })).toHaveCount(0);
  const viewer = (await (await db()).query<{ id: string }>("SELECT id FROM auth_user WHERE email = 'viewer@lumoras.example'")).rows[0];
  expect((await (await db()).query("SELECT 1 FROM research_log WHERE actor_id = $1", [viewer.id])).rows).toEqual([]);
  expect(errors).toEqual([]);
});

const visit = async (page: Page, path: string, heading: string | RegExp, name: string, theme: string, width: number) => {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await page.waitForTimeout(400);
  expect(await overflow(page), `${path}: sideways scroll at ${width}px in ${theme}: ${(await wideElements(page)).join(" | ")}`).toBeLessThanOrEqual(0);
  await shot(page, `${name}-${theme}-${width}`, P2);
};

for (const theme of ["dark", "light"] as const) {
  for (const width of [375, 1440]) {
    test(`Phase 2 screens in ${theme} at ${width}px: no errors, no sideways scroll`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 900 });
      const s = (await siteIds())["sonorch.ai"];
      await signIn(page, "owner@lumoras.example");
      await visit(page, `/w/lumoras/sites/${s.id}/keywords`, "sonorch.ai", "keywords", theme, width);
      await page.getByRole("tab", { name: /Research log/ }).click();
      expect(await overflow(page), (await wideElements(page)).join(" | ")).toBeLessThanOrEqual(0);
      await shot(page, `research-log-${theme}-${width}`, P2);
      await page.getByRole("tab", { name: /Seed backlog/ }).click();
      expect(await overflow(page), (await wideElements(page)).join(" | ")).toBeLessThanOrEqual(0);
      await shot(page, `seed-backlog-${theme}-${width}`, P2);
      await page.getByRole("tab", { name: /Saved keywords/ }).click();
      await page.getByLabel("Seed keyword").fill(`lash lift ${theme} ${width}`);
      await page.getByRole("button", { name: "Get the price" }).click();
      await expect(page.getByRole("button", { name: /Confirm and run/ })).toBeVisible();
      expect(await overflow(page), (await wideElements(page)).join(" | ")).toBeLessThanOrEqual(0);
      await shot(page, `research-cost-confirm-${theme}-${width}`, P2);
      await visit(page, "/w/lumoras/settings/budget", "Budget and usage", "budget-usage", theme, width);
      await visit(page, `/w/lumoras/sites/${s.id}/connections`, "sonorch.ai", "connections", theme, width);
      await visit(page, `/w/lumoras/sites/${s.id}`, "sonorch.ai", "site-overview", theme, width);
      expect(errors).toEqual([]);
    });
  }
}

test("reduced motion: research, budget and connections render their final state at once", async ({ page }) => {
  const errors = watchConsole(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const s = (await siteIds())["sonorch.ai"];
  await signIn(page, "owner@lumoras.example", `/w/lumoras/sites/${s.id}/keywords`);
  await page.getByLabel("Seed keyword").fill("lash lift reduced");
  await page.getByRole("button", { name: "Get the price" }).click();
  const cost = page.locator(".cost");
  await expect(cost).toBeVisible();
  // the confirm card is fully opaque straight away (no fade in flight)
  expect(await cost.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  const fill = page.locator(".bmeter-fill").first();
  const durations = await fill.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(durations.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
  await page.goto("/w/lumoras/settings/budget");
  await expect(page.getByRole("heading", { level: 1, name: "Budget and usage" })).toBeVisible();
  await shot(page, "budget-usage-reduced-motion", P2);
  expect(errors).toEqual([]);
});
