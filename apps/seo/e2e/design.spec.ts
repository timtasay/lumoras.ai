import { expect, test, type Page } from "@playwright/test";

type Theme = "dark" | "light";

async function openDesign(page: Page, theme: Theme, width: number) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((t) => localStorage.setItem("lumoras-theme", t), theme);
  await page.goto("/design");
  await expect(page.getByRole("heading", { level: 1, name: "Control room, clean room." })).toBeVisible();
  return errors;
}

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const theme of ["dark", "light"] as const) {
  for (const width of [375, 1440]) {
    test(`/design renders in ${theme} at ${width}px with no errors and no sideways scroll`, async ({ page }) => {
      const errors = await openDesign(page, theme, width);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      // every section of the design system is there
      for (const id of ["color", "type", "space", "motion", "buttons", "forms", "status", "kpis", "cards", "loading", "empty", "table", "tabs", "overlays", "charts", "calendar", "pipeline", "morph", "signin"]) {
        await expect(page.locator(`section#${id}`)).toHaveCount(1);
      }

      // walk the page so lazy parts (pipeline, particle field) start, then measure
      for (const id of ["charts", "pipeline", "signin"]) await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      expect(await noHorizontalOverflow(page)).toBeLessThanOrEqual(0);

      // WCAG 2.2 AA: every text token ≥ 4.5:1 and every graphics token ≥ 3:1 against panels, in this theme
      await expect(page.locator(".swatch[data-role='text'] .sw-ratio[data-pass]")).toHaveCount(await page.locator(".swatch[data-role='text']").count());
      const failing = await page.locator(".swatch:not([data-role='surface']):not([data-role='decor']) .sw-ratio:not([data-pass])").allTextContents();
      expect(failing, `tokens failing contrast in ${theme}`).toEqual([]);

      // charts expose their data to assistive tech
      await expect(page.locator("figure.chart")).toHaveCount(4);
      for (const fig of await page.locator("figure.chart").all()) {
        await expect(fig.locator("table caption")).toHaveCount(1);
        expect(await fig.locator("tbody tr").count()).toBeGreaterThan(0);
      }

      expect(errors, "console errors").toEqual([]);
    });
  }
}

test("theme control switches Light / Dark / Auto, persists it and announces the change", async ({ page }) => {
  await openDesign(page, "dark", 1440);
  await page.evaluate(() => {
    (window as unknown as { __ev: unknown[] }).__ev = [];
    document.addEventListener("lumoras:themechange", (e) => (window as unknown as { __ev: unknown[] }).__ev.push((e as CustomEvent).detail));
  });
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("lumoras-theme"))).toBe("light");
  expect(await page.evaluate(() => (window as unknown as { __ev: unknown[] }).__ev)).toEqual([{ mode: "light", resolved: "light" }]);
  await page.getByRole("radio", { name: "Auto" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("pipeline run: the pulse carries the run to the review gate, approval finishes it", async ({ page }) => {
  await openDesign(page, "dark", 1440);
  await page.locator("#pipeline").scrollIntoViewIfNeeded();
  const gate = page.locator(".pnode").nth(7);
  await expect(gate).toHaveAttribute("data-status", "waiting", { timeout: 30_000 });
  await expect(page.locator(".pnode[data-status='done']")).toHaveCount(7);
  await page.getByRole("button", { name: "Approve and publish" }).click();
  await expect(page.locator(".pnode[data-status='done']")).toHaveCount(10, { timeout: 20_000 });
  await expect(page.locator(".pipe-head .light")).toContainText("run complete");
  // nodes expand to their details
  await page.getByRole("button", { name: /Topic selection/ }).click();
  await expect(page.getByRole("region", { name: "Step details: Topic selection" })).toContainText("ai receptionist for salons");
});

test("⌘K palette opens from the keyboard, filters, and runs a command", async ({ page }) => {
  await openDesign(page, "dark", 1440);
  await page.keyboard.press("Control+K");
  const input = page.getByRole("combobox", { name: "Search sites, pages and actions" });
  await expect(input).toBeFocused();
  await input.fill("theme light");
  await expect(page.getByRole("listbox", { name: "Results" }).getByRole("option").first()).toContainText("Theme: Light");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(input).toBeHidden();
});

test.describe("reduced motion", () => {
  test("everything is still usable and ends in its final state", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = await openDesign(page, "dark", 1440);
    // KPI values are final at once (no count-up)
    await page.locator("#kpis").scrollIntoViewIfNeeded();
    await expect(page.locator(".kpi").first().locator(".kpi-value [aria-hidden]")).toHaveText("12.5K");
    // the run still progresses, but the pulse never travels
    await page.locator("#pipeline").scrollIntoViewIfNeeded();
    await expect(page.locator(".pnode").nth(7)).toHaveAttribute("data-status", "waiting", { timeout: 30_000 });
    expect(await page.locator(".pipe-pulse").evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    // list → detail swaps without a view transition
    await page.locator("#morph").scrollIntoViewIfNeeded();
    await page.locator(".morph-card").first().click();
    await expect(page.locator(".morph-detail")).toBeVisible();
    await page.getByRole("button", { name: "All articles" }).click();
    await expect(page.locator(".morph-card")).toHaveCount(3);
    // the particle field draws a still frame
    await page.locator("#signin").scrollIntoViewIfNeeded();
    await expect(page.locator("#signin .stage canvas")).toHaveCount(1);
    expect(await noHorizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});
