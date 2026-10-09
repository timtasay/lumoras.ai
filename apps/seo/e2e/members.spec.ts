import { expect, test } from "@playwright/test";
import { db, signIn, uniqueEmail, waitForMail, watchConsole } from "./helpers";

test("invite and accept: the owner invites a client reviewer by email; the invitee signs in, accepts and lands in the workspace", async ({ browser }) => {
  const errors: string[] = [];
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  errors.push(...watchConsole(owner));
  await signIn(owner, "owner@northwind-dental.example");
  await owner.goto("/w/northwind-dental/settings");
  const email = uniqueEmail("client");
  const since = Date.now() - 1;
  const form = owner.locator(".invite-form");
  await form.getByLabel("Email", { exact: true }).fill(email);
  await form.getByLabel("Role").selectOption("reviewer");
  await owner.getByRole("button", { name: "Send invitation" }).click();
  await expect(owner.getByText(`Invitation sent to ${email}.`)).toBeVisible();
  await expect(owner.locator(".pending-row").filter({ hasText: email })).toBeVisible();
  const mail = await waitForMail(email, "invitation", since);
  expect(new URL(mail.link).pathname).toMatch(/^\/accept-invitation\/[0-9a-f-]{36}$/);

  const inviteeCtx = await browser.newContext();
  const invitee = await inviteeCtx.newPage();
  errors.push(...watchConsole(invitee));
  await invitee.goto(mail.link);
  await expect(invitee.getByRole("heading", { name: "Join Northwind Dental (demo)" })).toBeVisible();
  await expect(invitee.locator(".badge").filter({ hasText: /^Reviewer$/ })).toBeVisible();
  await expect(invitee.getByText(/approves, rejects or requests changes on articles awaiting review\. Cannot edit or spend\./)).toBeVisible();
  await invitee.getByRole("link", { name: `Sign in as ${email} to accept` }).click();
  await expect(invitee.getByLabel("Work email")).toHaveValue(email);
  const since2 = Date.now() - 1;
  await invitee.getByRole("button", { name: "Email me a sign-in link" }).click();
  const login = await waitForMail(email, "magic-link", since2);
  await invitee.goto(login.link);
  await expect(invitee).toHaveURL(/\/accept-invitation\//);
  await invitee.getByRole("button", { name: /Accept and open/ }).click();
  await expect(invitee).toHaveURL(/\/w\/northwind-dental$/);
  await expect(invitee.getByText("Workspace · Reviewer")).toBeVisible();

  // the owner sees the new member; the acceptance is in the audit log with the invitee as actor
  await owner.reload();
  await expect(owner.getByRole("rowheader").filter({ hasText: email })).toBeVisible();
  const pool = await db();
  const rows = (await pool.query<{ action: string; email: string }>(
    "SELECT a.action, u.email FROM audit_log a JOIN auth_user u ON u.id::text = a.actor_id WHERE a.entity_type = 'auth_member' AND a.after->>'role' = 'reviewer' ORDER BY a.id DESC LIMIT 1",
  )).rows;
  expect(rows[0]).toEqual({ action: "invitation.accept", email });
  expect(errors).toEqual([]);
  await ownerCtx.close();
  await inviteeCtx.close();
});

test("a viewer sees everything but cannot change anything, in the UI or by calling the server directly", async ({ page }) => {
  const errors = watchConsole(page);
  await signIn(page, "viewer@lumoras.example");
  await expect(page).toHaveURL(/\/w\/lumoras$/);
  await expect(page.getByRole("link", { name: "Add a site" })).toHaveCount(0);
  await page.getByRole("link", { name: "lumoras.ai: open site" }).click();
  // no scan button for viewers
  await expect(page.getByRole("button", { name: /Scan/ })).toHaveCount(0);
  await expect(page.getByText("Only editors and owners can run a scan.")).toBeVisible();
  // the brand profile is read-only
  await page.getByRole("link", { name: "Brand profile" }).click();
  await expect(page.getByText("Your role can read the brand profile")).toBeVisible();
  await expect(page.getByLabel("Business overview")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save brand profile" })).toHaveCount(0);
  // authors and connections: no add forms
  await page.getByRole("link", { name: "Authors" }).click();
  await expect(page.getByRole("heading", { name: "Add an author" })).toHaveCount(0);
  await page.getByRole("link", { name: "Connections" }).click();
  await expect(page.getByRole("heading", { name: "Add a publishing connection" })).toHaveCount(0);
  // members: no invite form, no role controls
  await page.goto("/w/lumoras/settings");
  await expect(page.getByText("Only owners manage members")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invitation" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /Role for/ })).toHaveCount(0);
  // onboarding is for editors and owners
  await page.goto("/w/lumoras/onboarding/brand");
  await expect(page).toHaveURL(/\/w\/lumoras$/);

  // and the server refuses the viewer even when the UI is bypassed
  const siteId = (await (await db()).query<{ id: string }>("SELECT id FROM sites WHERE domain = 'lumoras.ai'")).rows[0].id;
  const r = await page.request.post(`/api/w/lumoras/sites/${siteId}/crawl`, { headers: { "content-type": "application/json", origin: new URL(page.url()).origin }, data: {} });
  expect(r.status()).toBe(403);
  expect((await r.json()).error).toMatch(/cannot run a crawl/);
  expect(errors).toEqual([]);
});

test("an editor cannot manage members", async ({ page }) => {
  await signIn(page, "editor@lumoras.example");
  await page.goto("/w/lumoras/settings");
  await expect(page.getByText("Only owners manage members")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invitation" })).toHaveCount(0);
  // but can edit the brand profile
  await page.getByRole("link", { name: "lumoras.ai" }).first().click();
  await page.getByRole("link", { name: "Brand profile" }).click();
  await expect(page.getByLabel("Business overview")).toBeEnabled();
});

test("a member of one workspace gets a 404 for another workspace's pages and APIs", async ({ page }) => {
  await signIn(page, "owner@northwind-dental.example");
  const res = await page.goto("/w/lumoras");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Nothing at this address" })).toBeVisible();
  const siteId = (await (await db()).query<{ id: string }>("SELECT id FROM sites WHERE domain = 'sonorch.ai'")).rows[0].id;
  expect((await page.goto(`/w/northwind-dental/sites/${siteId}`))?.status()).toBe(404);
  const r = await page.request.post(`/api/w/lumoras/sites/${siteId}/crawl`, { headers: { "content-type": "application/json", origin: new URL(page.url()).origin }, data: {} });
  expect(r.status()).toBe(404);
});

test("a cross-site POST to the crawl API is refused (CSRF)", async ({ page }) => {
  await signIn(page, "owner@lumoras.example");
  const siteId = (await (await db()).query<{ id: string }>("SELECT id FROM sites WHERE domain = 'lumoras.ai'")).rows[0].id;
  const r = await page.request.post(`/api/w/lumoras/sites/${siteId}/crawl`, { headers: { "content-type": "application/json", origin: "https://evil.example" }, data: {} });
  expect(r.status()).toBe(403);
  expect((await r.json()).error).toMatch(/Cross-origin request refused/);
});
