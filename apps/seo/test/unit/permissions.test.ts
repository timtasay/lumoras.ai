/**
 * The permission map: viewers read and comment only; reviewers also approve,
 * reject or request changes, and cannot edit or spend; editors cannot manage
 * members or billing; owners can do everything.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertCan, betterAuthStatements, can, ForbiddenError, PERMISSIONS, PERMISSION_MAP, WORKSPACE_ROLES } from "../../lib/auth/permissions.ts";

const WRITES = PERMISSIONS.filter((p) => !p.endsWith(":read") && p !== "comment:create");

describe("permission map", () => {
  it("a viewer can read and comment, and nothing else: no write, no approve", () => {
    for (const p of WRITES) assert.equal(can("viewer", p), false, `viewer can ${p}`);
    assert.equal(can("viewer", "content:approve"), false, "viewer can approve");
    for (const p of PERMISSIONS.filter((x) => x.endsWith(":read"))) assert.equal(can("viewer", p), true, `viewer cannot ${p}`);
    assert.equal(can("viewer", "comment:create"), true);
  });

  it("a reviewer can approve and comment, but cannot edit, spend, schedule or manage anything", () => {
    assert.equal(can("reviewer", "content:approve"), true);
    assert.equal(can("reviewer", "comment:create"), true);
    for (const p of PERMISSIONS.filter((x) => x.endsWith(":read"))) assert.equal(can("reviewer", p), true, `reviewer cannot ${p}`);
    const allowed = new Set<string>(["content:approve", "comment:create"]);
    for (const p of WRITES.filter((x) => !allowed.has(x))) assert.equal(can("reviewer", p), false, `reviewer can ${p}`);
    // the owner decision spelled out: no editing, no paid calls, no connections, members, budget or settings
    for (const p of ["content:edit", "pipeline:run", "research:run", "crawl:run", "content:schedule", "connection:manage", "member:manage", "invitation:manage", "budget:manage", "site:update", "brand:update"] as const) {
      assert.throws(() => assertCan("reviewer", p), ForbiddenError, `reviewer may ${p}`);
    }
  });

  it("the viewer/reviewer split is exactly content:approve", () => {
    const diff = [...PERMISSION_MAP.reviewer].filter((p) => !PERMISSION_MAP.viewer.has(p));
    assert.deepEqual(diff, ["content:approve"]);
    assert.throws(() => assertCan("viewer", "content:approve"), ForbiddenError);
    assert.doesNotThrow(() => assertCan("reviewer", "content:approve"));
  });

  it("an editor works on sites and content but cannot manage members, invitations, billing or the workspace", () => {
    for (const p of ["member:manage", "invitation:manage", "billing:manage", "workspace:update", "workspace:delete"] as const) {
      assert.equal(can("editor", p), false, `editor can ${p}`);
    }
    for (const p of ["site:create", "site:update", "brand:update", "author:manage", "connection:manage", "crawl:run", "content:edit", "content:approve"] as const) {
      assert.equal(can("editor", p), true, `editor cannot ${p}`);
    }
  });

  it("an owner can do everything", () => {
    for (const p of PERMISSIONS) assert.equal(can("owner", p), true, `owner cannot ${p}`);
  });

  it("roles nest: viewer ⊂ reviewer ⊂ editor ⊂ owner", () => {
    for (const p of PERMISSION_MAP.viewer) assert.ok(PERMISSION_MAP.reviewer.has(p), `reviewer lacks viewer's ${p}`);
    for (const p of PERMISSION_MAP.reviewer) assert.ok(PERMISSION_MAP.editor.has(p), `editor lacks reviewer's ${p}`);
    for (const p of PERMISSION_MAP.editor) assert.ok(PERMISSION_MAP.owner.has(p), `owner lacks editor's ${p}`);
  });

  it("no role, no permission; assertCan throws a ForbiddenError naming the permission", () => {
    assert.equal(can(null, "site:read"), false);
    assert.throws(() => assertCan("viewer", "site:update"), (e: unknown) => e instanceof ForbiddenError && e.permission === "site:update" && e.role === "viewer");
    assert.doesNotThrow(() => assertCan("owner", "billing:manage"));
  });

  it("Better Auth's organization roles are derived from the same map", () => {
    assert.deepEqual(betterAuthStatements("owner"), { organization: ["update", "delete"], member: ["create", "update", "delete"], invitation: ["create", "cancel"] });
    assert.deepEqual(betterAuthStatements("editor"), { organization: [], member: [], invitation: [] });
    assert.deepEqual(betterAuthStatements("reviewer"), { organization: [], member: [], invitation: [] });
    assert.deepEqual(betterAuthStatements("viewer"), { organization: [], member: [], invitation: [] });
    assert.deepEqual([...WORKSPACE_ROLES], ["owner", "editor", "reviewer", "viewer"]);
  });
});
