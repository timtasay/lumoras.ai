import { expect, test } from "@playwright/test";

test("homepage renders, draws the particle field and switches theme without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // the Spectrum field (from @lumoras/ui-field) mounts after load + idle
  await expect(page.locator("canvas#field")).toHaveCount(1, { timeout: 15_000 });
  // the theme control (from @lumoras/ui-tokens) still works
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("lumoras-theme"))).toBe("light");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
