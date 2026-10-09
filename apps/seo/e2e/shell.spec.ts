import { expect, test } from "@playwright/test";

test("overview renders the Phase 0 placeholder with the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lumoras Growth");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(1);
  await expect(page.getByText("Phase 0", { exact: false }).first()).toBeVisible();
});

test("phone navigation opens as a drawer and closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Open navigation" });
  await toggle.click();
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
