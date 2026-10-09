import { expect, test, type Page } from "@playwright/test";
import { FAKE_PAGES } from "../test/helpers/fake-site";
import { E2E } from "./config";
import { db, overflow, shot, signIn, uniqueEmail, watchConsole } from "./helpers";

const step = async (page: Page, name: string, width: number, theme: string) => {
  expect(await overflow(page), `${name}: sideways scroll at ${width}px`).toBeLessThanOrEqual(0);
  if (width === 1440 || name === "scan" || name === "site") await shot(page, `onboarding-${name}-${theme}-${width}`);
};

for (const [theme, width] of [["dark", 1440], ["light", 375]] as const) {
  test(`onboarding end to end (${theme}, ${width}px): workspace → site → scan of a fake site → brand pre-filled → authors → coming-next steps → done`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors = watchConsole(page);
    await page.addInitScript((t) => localStorage.setItem("lumoras-theme", t), theme);
    await page.setViewportSize({ width, height: 900 });
    const email = uniqueEmail(`founder-${theme}`);
    await signIn(page, email);

    // a brand-new user has no workspace: onboarding starts
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Name the workspace" })).toBeVisible();
    await expect(page.locator(".onb-field canvas")).toHaveCount(1);
    await step(page, "workspace", width, theme);
    const slug = `harbor-${theme}-${Date.now().toString(36)}`;
    await page.getByLabel("Workspace name").fill(`Harbor Dental ${theme}`);
    await page.getByLabel("Address").fill(slug);
    await page.getByRole("button", { name: "Create the workspace" }).click();

    // first site: the domain is normalised (scheme and www stripped)
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/onboarding/site$`));
    await expect(page.locator(".onb-rail li[data-state='done']")).toHaveCount(1);
    await page.getByLabel("Domain").fill(`https://www.${E2E.fakeDomain}/`);
    await expect(page.getByLabel("Site name")).toHaveValue("Northwind Dental");
    await page.getByLabel("Time zone").selectOption("America/Los_Angeles");
    await step(page, "site", width, theme);
    await page.getByRole("button", { name: "Add the site and scan it" }).click();

    // the scan streams from the server, through the SSRF guard, to the fake site
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/onboarding/scan$`));
    await expect(page.getByRole("heading", { name: `Scanning ${E2E.fakeDomain}` })).toBeVisible();
    await expect(page.locator(".scan")).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
    await expect(page.locator(".scan-tally dd").nth(1)).toContainText("7");
    await expect(page.locator(".scan-log")).toContainText("sitemap-blog.xml.gz: 1 URLs");
    await expect(page.locator(".scan-tally dd").first()).toHaveText("3");
    // the domain overview is real now (fake provider): priced first, and refused here because a new
    // workspace has no budget yet; nothing is bought
    const dov = page.getByRole("region", { name: "Domain overview" });
    await expect(dov).toBeVisible();
    await dov.getByRole("button", { name: "Get the price" }).click();
    await expect(page.getByRole("heading", { name: "No budget set for paid SEO data" })).toBeVisible();
    await expect(page.getByText("Nothing was bought and nothing was charged.")).toBeVisible();
    await step(page, "scan", width, theme);
    if (width === 1440) await shot(page, `onboarding-scan-overview-refused-${theme}-${width}`, "seo-p2");
    await page.getByRole("button", { name: "Continue to the brand profile" }).click();

    // brand profile pre-filled from the homepage, for the client to correct
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/onboarding/brand$`));
    await expect(page.getByLabel("Business overview")).toHaveValue(FAKE_PAGES["/"].description);
    await expect(page.getByLabel("Positioning")).toHaveValue(FAKE_PAGES["/"].h1);
    await expect(page.getByText("Pre-filled from the site's own pages")).toBeVisible();
    await page.getByRole("textbox", { name: "What we sell" }).fill("Cleanings\nInvisalign\nCrowns");
    await page.getByRole("textbox", { name: "What we do not sell" }).fill("Orthodontic surgery");
    await page.getByLabel("Competitors").fill("not a domain!");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.locator(".form-alert").first()).toContainText("Check the highlighted fields");
    await expect(page.getByText('"not a domain!" is not a domain')).toBeVisible();
    await page.getByLabel("Competitors").fill("https://www.rival-dental.example/");
    await step(page, "brand", width, theme);
    await page.getByRole("button", { name: "Save and continue" }).click();

    // authors: real people only
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/onboarding/authors$`));
    await page.getByLabel("Full name").fill("Dr. Ana Ruiz");
    await page.getByLabel("Role").fill("Lead dentist");
    await page.getByRole("button", { name: "Add author" }).click();
    await expect(page.locator(".author-name").filter({ hasText: "Dr. Ana Ruiz" })).toBeVisible();
    await step(page, "authors", width, theme);
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Search Console & GA4 (real now: connect buttons, skippable), publishing, schedule
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/onboarding/search$`));
    await expect(page.getByRole("button", { name: "Connect Search Console" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect GA4" })).toBeVisible();
    await shot(page, `onboarding-search-${theme}-${width}`, "seo-p2");
    for (const [path, heading] of [
      ["search", "Connect Search Console and GA4"],
      ["publishing", "Choose how articles get published"],
      ["schedule", "Set a schedule and a budget"],
    ]) {
      await expect(page).toHaveURL(new RegExp(`/w/${slug}/onboarding/${path}$`));
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await step(page, path, width, theme);
      await page.getByRole("button", { name: "Skip for now" }).click();
    }

    await expect(page).toHaveURL(new RegExp(`/w/${slug}/onboarding/done$`));
    await expect(page.getByText("7 routes on northwind-dental.test")).toBeVisible();
    await expect(page.locator(".done-cal .cal")).toBeVisible();
    await step(page, "done", width, theme);
    await page.getByRole("link", { name: "Open the workspace" }).click();

    // the workspace overview shows the site as a card
    await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));
    const card = page.getByRole("link", { name: `${E2E.fakeDomain}: open site` });
    await expect(card).toContainText("7");
    await card.click();
    await expect(page.getByRole("heading", { level: 1, name: E2E.fakeDomain })).toBeVisible();
    await expect(page.getByRole("region", { name: "Routes found in the sitemaps" })).toContainText("/services/invisalign");

    // the data and its audit trail are in the database, under this workspace only
    const pool = await db();
    const ws = (await pool.query<{ id: string; status: string }>("SELECT w.id, w.status FROM workspaces w JOIN auth_organization o ON o.id = w.id WHERE o.slug = $1", [slug])).rows[0];
    expect(ws.status).toBe("active");
    const brand = (await pool.query<{ competitors: string[]; sells: string[] }>("SELECT competitors, sells FROM brand_profiles WHERE workspace_id = $1", [ws.id])).rows[0];
    expect(brand).toEqual({ competitors: ["rival-dental.example"], sells: ["Cleanings", "Invisalign", "Crowns"] });
    const actions = (await pool.query<{ action: string }>("SELECT DISTINCT action FROM audit_log WHERE workspace_id = $1", [ws.id])).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["workspace.create", "site.create", "crawl.start", "crawl.finish", "brand_profile.update", "author.create", "workspace.onboarding"]));
    const spent = (await pool.query("SELECT 1 FROM usage_ledger WHERE workspace_id = $1", [ws.id])).rows;
    expect(spent, "the refused domain overview was charged").toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("a scan of a domain that does not resolve fails cleanly and says why", async ({ page }) => {
  // the seeded Northwind site is on a reserved .example domain: DNS fails before anything is fetched
  await signIn(page, "editor@northwind-dental.example");
  await page.getByRole("link", { name: "northwind-dental.example: open site" }).click();
  await page.getByRole("button", { name: "Scan the sitemap" }).click();
  await expect(page.locator(".scan")).toHaveAttribute("data-state", "failed", { timeout: 30_000 });
  await expect(page.locator(".scan-log")).toContainText(/could not resolve|refusing|ENOTFOUND|EAI_AGAIN/);
});
