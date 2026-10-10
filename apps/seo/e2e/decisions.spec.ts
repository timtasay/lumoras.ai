/**
 * Owner decisions of 10 October 2026 in the browser (screenshots prefixed seo-dec-):
 *   1. lumoras.ai is signed by its organization ("Lumoras team"); the author form chooses a
 *      person or an organization and explains when to use each.
 *   2. lumoras.ai's Git publisher points at timtasay/lumoras.ai (base dev, pull requests); a
 *      connection without its token shows "token needed" with instructions, the Test says what
 *      is missing, and adding the token (the fake GitHub's) makes it work.
 *   3. The SEO data provider card for platform admins: hosted OpenSEO with its terms note
 *      (run with E2E_OPENSEO=hosted; the default run checks the fake provider has no terms note).
 *   4. Demo data agrees: sonorch.ai shows no article live and no keyword labelled Published.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./config";
import { db, overflow, setTheme, shot, signIn, watchConsole, wideElements } from "./helpers";

const P = "seo-dec";
const siteId = async (domain: string) => (await (await db()).query<{ id: string }>("SELECT id FROM sites WHERE domain = $1", [domain])).rows[0].id;
const noSideways = async (page: Page) => expect(await overflow(page), `sideways scroll: ${(await wideElements(page)).join(", ")}`).toBeLessThanOrEqual(0);

for (const theme of ["dark", "light"] as const) {
  test(`authors: lumoras.ai signs as the organization "Lumoras team"; the form explains person vs organization (${theme})`, async ({ page }) => {
    const errors = watchConsole(page);
    await setTheme(page, theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, "owner@lumoras.example", `/w/lumoras/sites/${await siteId("lumoras.ai")}/authors`);
    const team = page.locator(".author").filter({ hasText: "Lumoras team" });
    await expect(team.locator(".badge").filter({ hasText: "Organization" })).toBeVisible();
    await expect(team).toContainText("published as schema.org Organization");
    await expect(team.getByText(/Demo:/)).toHaveCount(0);
    // the add form: a person by default, with a role; an organization has none
    const add = page.locator(".author-add");
    await expect(add.getByRole("radio", { name: "A person" })).toHaveAttribute("aria-checked", "true");
    await expect(add.getByLabel("Role")).toBeVisible();
    await add.getByRole("radio", { name: "An organization" }).click();
    await expect(add.getByText(/Published as schema\.org Organization\. Use it when no single person signs/)).toBeVisible();
    await expect(add.getByLabel("Role")).toHaveCount(0);
    await expect(add.getByLabel("Organization name")).toHaveAttribute("placeholder", "Lumoras team");
    // editing the organization byline round-trips its kind
    await team.getByRole("button", { name: "Edit" }).click();
    await expect(team.getByRole("radio", { name: "An organization" })).toHaveAttribute("aria-checked", "true");
    await team.getByRole("button", { name: "Save author" }).click();
    await expect(page.locator(".author").filter({ hasText: "Lumoras team" }).locator(".badge").filter({ hasText: "Organization" })).toBeVisible();
    const row = (await (await db()).query<{ kind: string; role: string; is_demo: boolean }>("SELECT a.kind, a.role, a.is_demo FROM authors a JOIN sites s ON s.id = a.site_id WHERE s.domain = 'lumoras.ai' AND a.name = 'Lumoras team'")).rows;
    expect(row).toEqual([{ kind: "organization", role: "", is_demo: false }]);
    await add.getByRole("radio", { name: "An organization" }).click();
    await shot(page, `authors-organization-${theme}-1440`, P);
    await page.setViewportSize({ width: 375, height: 800 });
    await noSideways(page);
    expect(errors).toEqual([]);
  });
}

test("lumoras.ai Git connection: token needed → the Test explains → the token is added → it works (fake GitHub)", async ({ page }) => {
  const errors = watchConsole(page);
  const state = JSON.parse(await readFile(E2E.stateFile, "utf8")) as { github: string };
  const site = await siteId("lumoras.ai");
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "owner@lumoras.example", `/w/lumoras/sites/${site}/connections`);
  // the lumoras.ai preset fills the real repository, base branch dev and the content-spec folder
  const form = page.locator(".conn-add");
  await expect(form.getByLabel("Repository")).toHaveValue("https://github.com/timtasay/lumoras.ai");
  await expect(form.getByLabel("Base branch")).toHaveValue("dev");
  await expect(form.getByLabel("Content folder")).toHaveValue("apps/web/content/insights");
  await expect(form.getByLabel("How it publishes")).toHaveValue("pr");
  await form.getByLabel("Label").fill("lumoras.ai repository");
  // development only: the API at the local fake GitHub (the real one would be api.github.com)
  await form.getByLabel("API address (optional)").fill(state.github);
  await form.getByRole("button", { name: "Save connection" }).click();
  const conn = page.locator(".conn").filter({ has: page.locator(".conn-name", { hasText: /^lumoras\.ai repository Git/ }) });
  await expect(conn.locator(".light")).toContainText("Token needed");
  const note = conn.locator(".conn-token");
  await expect(note).toContainText("Token needed to publish to timtasay/lumoras.ai");
  await expect(note).toContainText("Fine-grained tokens");
  await expect(note).toContainText("Only select repositories");
  await expect(note).toContainText("Contents read and write, Pull requests read and write");
  await expect(note).toContainText("Pull requests target dev");
  await expect(conn.locator(".conn-sum")).toContainText("base dev");
  await shot(page, "connection-token-needed-dark-1440", P);
  // the Test explains what is missing, without contacting the repository
  const before = (await (await db()).query<{ n: number }>("SELECT count(*)::int n FROM audit_log WHERE action = 'connection.test'")).rows[0].n;
  await conn.getByRole("button", { name: "Test" }).click();
  await expect(conn.locator(".conn-test")).toContainText("Token needed: lumoras.ai repository has no access token yet, so the repository was not contacted.");
  await expect(conn.locator(".conn-test li").filter({ hasText: "Access token" })).toHaveAttribute("data-warn", "");
  await expect(conn.locator(".conn-test li").filter({ hasText: "Base branch" })).toContainText("dev: pull requests target it");
  await expect.poll(async () => (await (await db()).query<{ n: number }>("SELECT count(*)::int n FROM audit_log WHERE action = 'connection.test'")).rows[0].n).toBeGreaterThan(before);
  await shot(page, "connection-token-needed-test-dark-1440", P);
  // light theme, same state
  await page.evaluate(() => localStorage.setItem("lumoras-theme", "light"));
  await page.reload();
  await expect(conn.locator(".light")).toContainText("Token needed");
  await shot(page, "connection-token-needed-light-1440", P);
  await page.setViewportSize({ width: 375, height: 800 });
  await noSideways(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  // the owner pastes the token: sealed, never shown again; the Test now reaches the (fake) repository
  await conn.getByLabel("Access token").fill("fake-token-0123456789");
  await conn.getByRole("button", { name: "Save token" }).click();
  await expect(conn.locator(".conn-token")).toHaveCount(0);
  await expect(conn.getByText(/Credentials encrypted · key v/)).toBeVisible();
  await conn.getByRole("button", { name: "Test" }).click();
  await expect(conn.locator(".conn-test")).toContainText("Ready: opens a pull request on dev.");
  const sealed = (await (await db()).query<{ c: string; detail: string | null }>("SELECT credentials_ciphertext AS c, status_detail AS detail FROM connections WHERE label = 'lumoras.ai repository' AND site_id = $1", [site])).rows[0];
  expect(sealed.c).not.toContain("fake-token");
  // clean up: the seeded connection stays the one that publishes
  await conn.getByRole("button", { name: "Remove" }).click();
  await expect(conn).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("sonorch.ai on Gitea: its site format comes first and fills MDX, author keys and the format check; the seeded connection needs a token", async ({ page }) => {
  const errors = watchConsole(page);
  const site = await siteId("sonorch.ai");
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "owner@lumoras.example", `/w/lumoras/sites/${site}/connections`);
  const form = page.locator(".conn-add");
  await expect(form.getByLabel("Site format")).toHaveValue("sonorch");
  await expect(form.getByLabel("Host")).toHaveValue("gitea");
  await expect(form.getByLabel("Repository")).toHaveValue("https://gitea.timdatinh.com/lumoras/sonorch.ai");
  await expect(form.getByLabel("Base branch")).toHaveValue("main");
  await expect(form.getByLabel("Content folder")).toHaveValue("src/content/posts");
  await expect(form.getByLabel("File name")).toHaveValue("{{slug}}.mdx");
  await expect(form.getByLabel("Body format")).toHaveValue("mdx");
  await expect(form.getByLabel("Format check (optional)")).toHaveValue("src/content/post-schema.ts");
  await expect(form.getByLabel("Author keys (for {{author.key}})")).toHaveValue("Tim = tim\nTran = tran\nAlex = alex\nJayden = jayden");
  await expect(form.getByLabel("Frontmatter template")).toHaveValue(/author: \{\{author\.key\}\}/);
  // switching format refills the fields
  await form.getByLabel("Site format").selectOption("generic");
  await expect(form.getByLabel("Body format")).toHaveValue("markdown");
  await expect(form.getByLabel("Author keys (for {{author.key}})")).toHaveValue("");
  await form.getByLabel("Site format").selectOption("sonorch");
  // the seeded connection: Gitea, no token, nothing contacted
  const conn = page.locator(".conn").filter({ has: page.locator(".conn-name", { hasText: /^sonorch\.ai repository \(Gitea\)/ }) });
  await expect(conn.locator(".light")).toContainText("Token needed");
  await expect(conn.locator(".conn-token")).toContainText("In Gitea: Settings → Applications → Generate new token");
  await expect(conn.locator(".conn-sum")).toContainText("src/content/posts/{{slug}}.mdx · opens a pull request into main · MDX · waits for src/content/post-schema.ts");
  await shot(page, "connection-sonorch-gitea-dark-1440", P);
  await page.setViewportSize({ width: 375, height: 800 });
  await noSideways(page);
  expect(errors).toEqual([]);
});

for (const theme of ["dark", "light"] as const) {
  test(`sonorch.ai: "Articles live" and Rankings agree, nothing labelled Published (${theme})`, async ({ page }) => {
    const errors = watchConsole(page);
    await setTheme(page, theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    const sonorch = await siteId("sonorch.ai");
    await signIn(page, "owner@lumoras.example", `/w/lumoras/sites/${sonorch}`);
    const live = page.locator(".kpi").filter({ has: page.locator(".kpi-label", { hasText: "Articles live" }) });
    await expect(live.locator(".sr-only")).toHaveText("0");
    await expect(live).toContainText("Nothing published yet");
    await expect(page.locator("main .badge").filter({ hasText: /^Published$/ })).toHaveCount(0);
    await shot(page, `sonorch-dashboard-${theme}-1440`, P);
    await page.goto(`/w/lumoras/sites/${sonorch}/rankings`);
    await expect(page.getByRole("radio", { name: /^Published/ })).toHaveText("Published 0");
    // lumoras.ai: every keyword labelled Published has its article live
    const lum = await siteId("lumoras.ai");
    await page.goto(`/w/lumoras/sites/${lum}/rankings`);
    const label = await page.getByRole("radio", { name: /^Published/ }).innerText();
    const n = Number(/Published (\d+)/.exec(label)?.[1] ?? "-1");
    const liveLum = (await (await db()).query<{ n: number }>("SELECT count(*)::int n FROM content_items WHERE site_id = $1 AND status = 'published'", [lum])).rows[0].n;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(liveLum);
    expect(errors).toEqual([]);
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`provider card for platform admins: ${E2E.openseoHosted ? "hosted OpenSEO with its terms note and credits" : "the fake provider, no terms note"} (${theme})`, async ({ page }) => {
    const errors = watchConsole(page);
    await setTheme(page, theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, "staff@lumoras.example", "/agency");
    const card = page.locator(".provider-status");
    if (E2E.openseoHosted) {
      await expect(card).toContainText("OpenSEO (hosted, MCP)");
      await expect(card.locator(".mono").first()).toContainText("/mcp");
      await expect(card).toContainText("$8.41");
      await expect(card).toContainText("8,412 credits on the hosted account");
      await expect(card.locator(".prov-terms")).toContainText("Use it for Lumoras's own sites and staff-run client work now");
      await expect(card.locator(".prov-terms")).toContainText("get OpenSEO's written OK or move to self-hosted OpenSEO");
      await expect(card).not.toContainText("oseo_");
      await card.scrollIntoViewIfNeeded();
      await shot(page, `provider-openseo-hosted-${theme}-1440`, P);
    } else {
      await expect(card).toContainText("Demo data (fake provider)");
      await expect(card.locator(".prov-terms")).toHaveCount(0);
    }
    await page.setViewportSize({ width: 375, height: 800 });
    await noSideways(page);
    expect(errors).toEqual([]);
  });
}
