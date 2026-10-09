/**
 * Better Auth against the real migrations (PostgreSQL): the schema matches
 * what Better Auth 1.7.7 expects; magic-link sign-in; creating a workspace
 * creates the workspaces row and audit rows in the same transaction;
 * invitations; the role map is enforced on Better Auth's own endpoints;
 * impersonation is recorded with the platform admin as the actor.
 * No email leaves the process: the mailer is a capture.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createAuth, type Auth } from "../../lib/auth/server.ts";
import { runWithAudit } from "../../lib/auth/audit-context.ts";
import { createTestDatabase, dropAll, skipReason, adminQuery, type TestDb } from "../helpers/db.ts";

const BASE = "http://localhost:3999";

/** Applies Set-Cookie headers to a Cookie header the way a browser would (last write wins, Max-Age=0 deletes). */
function cookieJar(current: string, setCookies: string[]): string {
  const jar = new Map(current.split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf("=")), c] as const));
  for (const sc of setCookies) {
    const pair = sc.split(";")[0];
    const name = pair.slice(0, pair.indexOf("="));
    if (/max-age=0/i.test(sc) || pair.endsWith("=")) jar.delete(name);
    else jar.set(name, pair);
  }
  return [...jar.values()].join("; ");
}

type Mail = { kind: string; to: string; url: string; role?: string };

describe("Better Auth on the real schema", { skip: skipReason ?? false }, () => {
  let db: TestDb;
  let pool: pg.Pool;
  let auth: Auth;
  const outbox: Mail[] = [];

  before(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 5 });
    auth = createAuth({
      pool,
      baseUrl: BASE,
      secret: "x".repeat(40),
      secure: false,
      google: null,
      rateLimitScale: 100,
      mail: {
        magicLink: async (to, url) => void outbox.push({ kind: "magic-link", to, url }),
        invitation: async (to, url, _ws, _inviter, role) => void outbox.push({ kind: "invitation", to, url, role }),
      },
    });
  });
  after(async () => {
    await pool?.end();
    await dropAll();
  });

  async function signIn(email: string): Promise<Headers> {
    await auth.api.signInMagicLink({ body: { email, callbackURL: "/" }, headers: new Headers() });
    const mail = outbox.filter((m) => m.kind === "magic-link" && m.to === email).at(-1);
    assert.ok(mail, `a sign-in link was emailed to ${email}`);
    const res = await auth.handler(new Request(mail.url));
    assert.equal(res.status, 302, "the link redirects after signing in");
    const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
    const session = cookies.find((c) => c.startsWith("lumoras-growth.session_token="));
    assert.ok(session, `session cookie set (got ${cookies.join(", ")})`);
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("lumoras-growth.session_token="))!;
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    return new Headers({ cookie: session, origin: BASE });
  }

  it("matches the schema Better Auth expects (no pending migrations)", async () => {
    const { toBeCreated, toBeAdded } = await getMigrations(auth.options);
    assert.deepEqual(
      { toBeCreated: toBeCreated.map((t) => t.table), toBeAdded: toBeAdded.map((t) => `${t.table}: ${Object.keys(t.fields).join(", ")}`) },
      { toBeCreated: [], toBeAdded: [] },
    );
  });

  it("signs in with a magic link, stores the token hashed, and uses it once", async () => {
    const h = await signIn("owner@northwind.test");
    const s = await auth.api.getSession({ headers: h });
    assert.equal(s?.user.email, "owner@northwind.test");
    const link = outbox.filter((m) => m.kind === "magic-link").at(-1)!;
    const token = new URL(link.url).searchParams.get("token")!;
    const rows = await adminQuery<{ identifier: string }>("SELECT identifier FROM auth_verification", [], db.name);
    assert.ok(rows.every((r) => !r.identifier.includes(token)), "the raw token is not stored");
    const again = await auth.handler(new Request(link.url));
    assert.equal(again.status, 302);
    assert.match(again.headers.get("location") ?? "", /error=/, "a used link fails");
  });

  it("creating a workspace creates its workspaces row and audit rows with the actor, in one go", async () => {
    const h = await signIn("founder@acme.test");
    const user = (await auth.api.getSession({ headers: h }))!.user;
    const org = await runWithAudit({ actorId: user.id, action: "workspace.create", requestId: "req-1" }, () =>
      auth.api.createOrganization({ body: { name: "Acme", slug: "acme" }, headers: h }),
    );
    assert.ok(org?.id);
    const ws = await adminQuery<{ id: string; status: string }>("SELECT id, status FROM workspaces WHERE id = $1", [org.id], db.name);
    assert.deepEqual(ws, [{ id: org.id, status: "onboarding" }]);
    const audit = await adminQuery<{ action: string; entity_type: string; actor_id: string; request_id: string }>(
      "SELECT action, entity_type, actor_id, request_id FROM audit_log WHERE workspace_id = $1 ORDER BY id",
      [org.id],
      db.name,
    );
    assert.deepEqual(
      audit.map((a) => a.entity_type).sort(),
      ["auth_member", "auth_organization", "workspaces"],
    );
    for (const a of audit) {
      assert.equal(a.actor_id, user.id, `${a.entity_type} audit row names the actor`);
      assert.equal(a.action, "workspace.create");
      assert.equal(a.request_id, "req-1");
    }
    const [m] = await adminQuery<{ role: string }>("SELECT role FROM auth_member WHERE organization_id = $1", [org.id], db.name);
    assert.equal(m.role, "owner");
  });

  it("invitations: owner invites a viewer; the viewer accepts; the viewer cannot invite; an editor cannot change roles", async () => {
    const owner = await signIn("boss@initech.test");
    const ownerUser = (await auth.api.getSession({ headers: owner }))!.user;
    const org = await runWithAudit({ actorId: ownerUser.id }, () => auth.api.createOrganization({ body: { name: "Initech", slug: "initech" }, headers: owner }));
    const inv = await runWithAudit({ actorId: ownerUser.id, action: "invitation.create" }, () =>
      auth.api.createInvitation({ body: { email: "client@initech.test", role: "viewer", organizationId: org!.id }, headers: owner }),
    );
    const mail = outbox.find((m) => m.kind === "invitation" && m.to === "client@initech.test");
    assert.ok(mail && mail.url.endsWith(`/accept-invitation/${inv.id}`), "invitation email carries the accept link");
    assert.equal(mail.role, "viewer");

    const viewer = await signIn("client@initech.test");
    await auth.api.acceptInvitation({ body: { invitationId: inv.id }, headers: viewer });
    const members = await adminQuery<{ email: string; role: string }>(
      "SELECT u.email, m.role FROM auth_member m JOIN auth_user u ON u.id = m.user_id WHERE m.organization_id = $1 ORDER BY u.email",
      [org!.id],
      db.name,
    );
    assert.deepEqual(members, [
      { email: "boss@initech.test", role: "owner" },
      { email: "client@initech.test", role: "viewer" },
    ]);

    await auth.api.setActiveOrganization({ body: { organizationId: org!.id }, headers: viewer });
    await assert.rejects(
      auth.api.createInvitation({ body: { email: "x@initech.test", role: "editor", organizationId: org!.id }, headers: viewer }),
      (e: unknown) => (e as { statusCode?: number }).statusCode === 403,
      "a viewer cannot invite",
    );

    // promote to editor, then check the editor still cannot manage members
    const viewerMember = (await adminQuery<{ id: string }>("SELECT m.id FROM auth_member m JOIN auth_user u ON u.id = m.user_id WHERE u.email = 'client@initech.test'", [], db.name))[0];
    await auth.api.updateMemberRole({ body: { memberId: viewerMember.id, role: "editor", organizationId: org!.id }, headers: owner });
    const ownerMember = (await adminQuery<{ id: string }>("SELECT m.id FROM auth_member m JOIN auth_user u ON u.id = m.user_id WHERE u.email = 'boss@initech.test'", [], db.name))[0];
    await assert.rejects(
      auth.api.updateMemberRole({ body: { memberId: ownerMember.id, role: "viewer", organizationId: org!.id }, headers: viewer }),
      (e: unknown) => (e as { statusCode?: number }).statusCode === 403,
      "an editor cannot change roles",
    );
    await assert.rejects(
      auth.api.createInvitation({ body: { email: "y@initech.test", role: "viewer", organizationId: org!.id }, headers: viewer }),
      (e: unknown) => (e as { statusCode?: number }).statusCode === 403,
      "an editor cannot invite",
    );
  });

  it("the database refuses roles outside owner/editor/viewer", async () => {
    await assert.rejects(
      adminQuery("INSERT INTO auth_member (organization_id, user_id, role) SELECT o.id, u.id, 'admin' FROM auth_organization o, auth_user u LIMIT 1", [], db.name),
      /auth_member_role_check/,
    );
  });

  it("impersonation starts and stops with an audit trail naming the platform admin", async () => {
    const staff = await signIn("staff@lumoras.test");
    const staffUser = (await auth.api.getSession({ headers: staff }))!.user;
    await adminQuery("UPDATE auth_user SET role = 'admin' WHERE id = $1", [staffUser.id], db.name);
    const target = (await adminQuery<{ id: string }>("SELECT id FROM auth_user WHERE email = 'founder@acme.test'", [], db.name))[0];
    const acme = (await adminQuery<{ id: string }>("SELECT id FROM auth_organization WHERE slug = 'acme'", [], db.name))[0];

    const res = await runWithAudit({ actorId: staffUser.id, workspaceId: acme.id, action: "impersonation.start" }, () =>
      auth.api.impersonateUser({ body: { userId: target.id }, headers: staff, returnHeaders: true }),
    );
    const jar = cookieJar(staff.get("cookie")!, res.headers.getSetCookie());
    const cookie = jar.split("; ").find((c) => c.startsWith("lumoras-growth.session_token="))!;
    assert.ok(jar.includes("lumoras-growth.admin_session="), "the admin's own session is kept aside");
    const asTarget = new Headers({ cookie: jar, origin: BASE });
    const s = await auth.api.getSession({ headers: asTarget });
    assert.equal(s?.user.email, "founder@acme.test");
    assert.equal((s?.session as { impersonatedBy?: string }).impersonatedBy, staffUser.id);

    // the admin cannot impersonate another admin
    await assert.rejects(auth.api.impersonateUser({ body: { userId: staffUser.id }, headers: staff }));

    await runWithAudit({ actorId: target.id, impersonatorId: staffUser.id, workspaceId: acme.id }, () =>
      auth.api.stopImpersonating({ headers: asTarget }),
    );
    const trail = await adminQuery<{ action: string; actor_id: string; impersonator_id: string; entity_id: string; workspace_id: string }>(
      "SELECT action, actor_id, impersonator_id, entity_id, workspace_id FROM audit_log WHERE action LIKE 'impersonation.%' ORDER BY id",
      [],
      db.name,
    );
    assert.deepEqual(
      trail.map((t) => [t.action, t.actor_id, t.impersonator_id, t.entity_id, t.workspace_id]),
      [
        ["impersonation.start", staffUser.id, staffUser.id, target.id, acme.id],
        ["impersonation.stop", staffUser.id, staffUser.id, target.id, acme.id],
      ],
    );
    const tokens = await adminQuery<{ n: string }>("SELECT count(*) AS n FROM audit_log WHERE after::text LIKE '%' || $1 || '%'", [cookie.split("=")[1].split(".")[0]], db.name);
    assert.equal(Number(tokens[0].n), 0, "the session token never reaches the audit log");
  });

  it("rate-limits sign-in links per email address", async () => {
    const strict = createAuth({
      pool,
      baseUrl: BASE,
      secret: "y".repeat(40),
      secure: false,
      google: null,
      rateLimitScale: 1,
      mail: { magicLink: async () => {}, invitation: async () => {} },
    });
    const email = "spam-target@example.test";
    for (let i = 0; i < 5; i++) await strict.api.signInMagicLink({ body: { email }, headers: new Headers() });
    await assert.rejects(
      strict.api.signInMagicLink({ body: { email }, headers: new Headers() }),
      (e: unknown) => (e as { statusCode?: number }).statusCode === 429,
    );
  });

  it("Better Auth's own per-IP limit on sign-in links works on the auth_rate_limit table", async () => {
    const strict = createAuth({
      pool,
      baseUrl: BASE,
      secret: "z".repeat(40),
      secure: false,
      google: null,
      rateLimitScale: 1,
      mail: { magicLink: async () => {}, invitation: async () => {} },
    });
    const send = (i: number) =>
      strict.handler(
        new Request(`${BASE}/api/auth/sign-in/magic-link`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "203.0.113.7" },
          body: JSON.stringify({ email: `ip-limit-${i}@example.test` }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await send(i)).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
    const [row] = await adminQuery<{ key: string; count: number }>("SELECT key, count FROM auth_rate_limit WHERE key LIKE '%magic-link%'", [], db.name);
    assert.ok(row, "the counter lives in auth_rate_limit");
  });

  it("refuses a cross-origin POST (CSRF): Better Auth's origin check", async () => {
    const res = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example", cookie: "lumoras-growth.session_token=x" },
        body: JSON.stringify({ email: "victim@example.test" }),
      }),
    );
    assert.equal(res.status, 403);
  });
});
