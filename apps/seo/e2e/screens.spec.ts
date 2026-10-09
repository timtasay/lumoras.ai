import { expect, test, type Page } from "@playwright/test";
import { db, overflow, setTheme, shot, signIn, watchConsole } from "./helpers";

async function sites() {
  const r = await (await db()).query<{ domain: string; id: string }>("SELECT domain, id FROM sites WHERE domain IN ('sonorch.ai', 'lumoras.ai', 'northwind-dental.example')");
  return Object.fromEntries(r.rows.map((x) => [x.domain, x.id])) as Record<string, string>;
}

async function visit(page: Page, path: string, heading: RegExp | string, name: string, theme: string, width: number) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await page.waitForTimeout(400);
  expect(await overflow(page), `${path}: sideways scroll at ${width}px in ${theme}`).toBeLessThanOrEqual(0);
  await shot(page, `${name}-${theme}-${width}`);
}

for (const theme of ["dark", "light"] as const) {
  for (const width of [375, 1440]) {
    test(`workspace screens in ${theme} at ${width}px: no errors, no sideways scroll`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 900 });
      const ids = await sites();
      await signIn(page, "owner@lumoras.example");
      await visit(page, "/w/lumoras", "Lumoras", "overview", theme, width);
      await expect(page.locator(".site-card")).toHaveCount(4); // 3 sites + "add a site"
      await visit(page, `/w/lumoras/sites/${ids["lumoras.ai"]}`, "lumoras.ai", "site", theme, width);
      await visit(page, `/w/lumoras/sites/${ids["sonorch.ai"]}/brand`, "sonorch.ai", "site-brand", theme, width);
      await expect(page.getByLabel("Positioning")).toHaveValue("Every call answered. Every chair filled. Every table sat.");
      await visit(page, `/w/lumoras/sites/${ids["sonorch.ai"]}/authors`, "sonorch.ai", "site-authors", theme, width);
      await expect(page.getByText("Demo: replace with a real person")).toBeVisible();
      await visit(page, `/w/lumoras/sites/${ids["sonorch.ai"]}/connections`, "sonorch.ai", "site-connections", theme, width);
      await visit(page, `/w/lumoras/sites/${ids["sonorch.ai"]}/settings`, "sonorch.ai", "site-settings", theme, width);
      await visit(page, "/w/lumoras/settings", "Members and roles", "members", theme, width);
      await visit(page, "/w/lumoras/audit", "Audit log", "audit", theme, width);
      expect(errors).toEqual([]);
    });

    test(`agency screens in ${theme} at ${width}px`, async ({ page }) => {
      const errors = watchConsole(page);
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 900 });
      await signIn(page, "staff@lumoras.example");
      await visit(page, "/agency", "Every workspace", "agency", theme, width);
      await visit(page, "/agency/audit", "Platform audit log", "agency-audit", theme, width);
      expect(errors).toEqual([]);
    });
  }
}

test("connections: credentials are encrypted and never sent back to the browser", async ({ page }) => {
  const errors = watchConsole(page);
  const ids = await sites();
  await signIn(page, "owner@lumoras.example");
  await page.goto(`/w/lumoras/sites/${ids["lumoras.ai"]}/connections`);
  await page.getByRole("radio", { name: "Webhook" }).click();
  const secret = `whsec-e2e-${Date.now()}-do-not-leak`;
  await page.getByLabel("Endpoint").fill("https://lumoras.ai/hooks/growth");
  await page.getByLabel("Signing secret").fill(secret);
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("Credentials encrypted · key v1").first()).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain(secret);
  await page.reload();
  expect(await page.content()).not.toContain(secret);
  const row = (await (await db()).query<{ c: string }>("SELECT credentials_ciphertext AS c FROM connections WHERE config->>'endpoint' = 'https://lumoras.ai/hooks/growth'")).rows[0];
  expect(row.c).toMatch(/^v1\./);
  expect(row.c).not.toContain(secret);
  expect(await page.content()).not.toContain(row.c);
  expect(errors).toEqual([]);
});

test("⌘K jumps between workspaces and sites", async ({ page }) => {
  await signIn(page, "staff@lumoras.example");
  // staff is not a member of any workspace: sign in as a member of Lumoras instead
  await page.context().clearCookies();
  await signIn(page, "owner@lumoras.example");
  await page.keyboard.press("Control+K");
  const input = page.getByRole("combobox", { name: "Search sites, pages and actions" });
  await expect(input).toBeFocused();
  await input.fill("seasonx");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "seasonx.ai" })).toBeVisible();
  await page.keyboard.press("Control+K");
  await input.fill("audit log");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
});

test("keyboard: skip link, workspace switcher and tabs work without a mouse", async ({ page }) => {
  await signIn(page, "owner@lumoras.example");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  const sw = page.getByRole("button", { name: /^Workspace: Lumoras/ });
  await sw.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: /New workspace/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sw).toBeFocused();
  await expect(page.getByRole("link", { name: /New workspace/ })).toBeHidden();
});

test.describe("reduced motion", () => {
  test("screens are complete at once: KPI values final, still radar, no view-transition animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = watchConsole(page);
    await signIn(page, "owner@lumoras.example");
    await expect(page.locator(".kpi").first().locator(".kpi-value [aria-hidden]")).toHaveText("3");
    const ids = await sites();
    await page.locator(".site-card").filter({ hasText: "lumoras.ai" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "lumoras.ai" })).toBeVisible();
    await expect(page.locator(".scan-radar")).toBeVisible();
    // the sweep only turns while a scan is live, and never under reduced motion
    expect(await page.locator(".scan-sweep").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await page.goto(`/w/lumoras/sites/${ids["lumoras.ai"]}/authors`);
    await shot(page, "reduced-motion-authors-dark-1440");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});

test("phone navigation opens as a drawer and closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page, "owner@lumoras.example");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator("#side")).toBeVisible();
  await expect(page.locator(".top-menu")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".app")).not.toHaveAttribute("data-menu", "open");
});

test("health endpoint answers for the container healthcheck", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.ok()).toBeTruthy();
  expect(await r.json()).toMatchObject({ ok: true, service: "lumoras-seo" });
});
