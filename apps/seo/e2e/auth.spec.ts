import { expect, test } from "@playwright/test";
import { overflow, setTheme, shot, signIn, watchConsole } from "./helpers";

test("signed-out visitors are sent to sign-in, keeping where they were going", async ({ page }) => {
  await page.goto("/w/lumoras/settings");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fw%2Flumoras%2Fsettings$/);
});

test("the CSP is strict and nonce-based, and the page still runs with no console errors", async ({ page }) => {
  const errors = watchConsole(page);
  const res = await page.goto("/sign-in");
  const csp = res!.headers()["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toMatch(/unsafe-eval/);
  expect(csp).toContain("frame-ancestors 'none'");
  const nonce = /'nonce-([^']+)'/.exec(csp)![1];
  // every script in the document carries this request's nonce (the theme script included)
  const scripts = await page.locator("script").evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).nonce));
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.every((n) => n === nonce)).toBe(true);
  await page.getByLabel("Work email").fill("csp-check@example.test");
  expect(errors).toEqual([]);
});

for (const theme of ["dark", "light"] as const) {
  for (const width of [375, 1440]) {
    test(`sign-in renders in ${theme} at ${width}px: field behind glass, Google off with a reason`, async ({ page }) => {
      const errors = watchConsole(page);
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/sign-in");
      await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
      await expect(page.locator(".stage canvas")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
      await expect(page.getByText("Google sign-in is not set up on this server yet")).toBeVisible();
      await page.waitForTimeout(600);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await shot(page, `signin-${theme}-${width}`);
      expect(errors).toEqual([]);
    });
  }
}

test("magic-link sign-in: the emailed link signs you in once; a reused link is refused", async ({ page, context }) => {
  await signIn(page, "owner@lumoras.example");
  await expect(page).toHaveURL(/\/w\/lumoras$/);
  await expect(page.getByRole("heading", { level: 1, name: "Lumoras" })).toBeVisible();
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === "lumoras-growth.session_token");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
});

test("validation and errors on the sign-in form are announced", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Enter the email address you use for work")).toBeVisible();
  await page.goto("/sign-in?error=link");
  await expect(page.locator(".form-alert")).toContainText("expired or was already used");
});

test("sign out ends the session", async ({ page }) => {
  await signIn(page, "editor@lumoras.example");
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/w/lumoras");
  await expect(page).toHaveURL(/\/sign-in/);
});
