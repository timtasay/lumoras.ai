import { expect, test } from "@playwright/test";
import { db, shot, signIn, watchConsole } from "./helpers";

test("platform admin: agency home lists every workspace; impersonation is visible, scoped and recorded in the audit log", async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "staff@lumoras.example");
  await expect(page).toHaveURL(/\/agency$/);
  await expect(page.getByRole("heading", { name: "Every workspace" })).toBeVisible();
  const card = page.locator(".agency-card").filter({ hasText: "Northwind Dental (demo)" });
  await expect(card).toBeVisible();
  await expect(page.locator(".agency-card").filter({ hasText: "Lumoras" }).first()).toBeVisible();

  // the platform admin is not a member, so the workspace itself is a 404 without impersonation
  expect((await page.request.get("/w/northwind-dental")).status()).toBe(404);

  await card.getByRole("button", { name: /Enter Northwind Dental \(demo\) as a member/ }).click();
  await card.getByRole("button", { name: /owner@northwind-dental.example/ }).click();
  await expect(page).toHaveURL(/\/w\/northwind-dental$/);
  const banner = page.getByRole("status").filter({ hasText: "Viewing as owner@northwind-dental.example" });
  await expect(banner).toContainText("staff@lumoras.example");
  await shot(page, "impersonating-dark-1440");

  // act as the owner: add an author
  await page.getByRole("link", { name: "northwind-dental.example: open site" }).click();
  await page.getByRole("link", { name: "Authors" }).click();
  await page.getByLabel("Full name").fill("Impersonation Test Author");
  await page.getByRole("button", { name: "Add author" }).click();
  await expect(page.locator(".author-name").filter({ hasText: "Impersonation Test Author" })).toBeVisible();

  // the workspace audit log shows who really did it
  await page.goto("/w/northwind-dental/audit");
  const row = page.locator(".audit-row").filter({ hasText: "author.create" }).first();
  await expect(row).toContainText("owner@northwind-dental.example");
  await expect(row).toContainText("impersonated by staff@lumoras.example");

  await page.getByRole("button", { name: "Stop impersonating" }).click();
  await expect(page).toHaveURL(/\/agency$/);
  await expect(page.getByText("Viewing as")).toHaveCount(0);

  await page.goto("/agency/audit");
  await expect(page.locator(".audit-row").filter({ hasText: "impersonation.start" }).first()).toBeVisible();
  await expect(page.locator(".audit-row").filter({ hasText: "impersonation.stop" }).first()).toBeVisible();
  await expect(page.locator(".audit-row").filter({ hasText: "platform.workspaces.read" }).first()).toBeVisible();

  const pool = await db();
  const trail = (await pool.query<{ action: string; actor: string; imp: string | null }>(
    `SELECT a.action, au.email AS actor, iu.email AS imp FROM audit_log a
     LEFT JOIN auth_user au ON au.id::text = a.actor_id LEFT JOIN auth_user iu ON iu.id = a.impersonator_id
     WHERE a.action IN ('impersonation.start', 'author.create', 'impersonation.stop') AND a.at > now() - interval '5 minutes'
     ORDER BY a.id`,
  )).rows.filter((r) => r.action !== "author.create" || r.imp);
  expect(trail.slice(-3)).toEqual([
    { action: "impersonation.start", actor: "staff@lumoras.example", imp: "staff@lumoras.example" },
    { action: "author.create", actor: "owner@northwind-dental.example", imp: "staff@lumoras.example" },
    { action: "impersonation.stop", actor: "staff@lumoras.example", imp: "staff@lumoras.example" },
  ]);
  expect(errors).toEqual([]);
});

test("non-admins cannot open the agency pages", async ({ page }) => {
  await signIn(page, "owner@lumoras.example");
  expect((await page.goto("/agency"))?.status()).toBe(404);
  expect((await page.goto("/agency/audit"))?.status()).toBe(404);
});
