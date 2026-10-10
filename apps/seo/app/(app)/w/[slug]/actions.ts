"use server";
/**
 * Workspace server actions. Each one: membership (404 otherwise), the
 * permission map, input validation, then one audited transaction scoped to the
 * workspace (lib/actions.ts). Better Auth calls (members, invitations) run in
 * an audit context so its writes are attributed too.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { inWorkspace, toActionError, formObject, type ActionState } from "@/lib/actions";
import { auth, auditFor, requireWorkspace } from "@/lib/auth/app";
import { runWithAudit } from "@/lib/auth/audit-context";
import { assertCan, isWorkspaceRole } from "@/lib/auth/permissions";
import { keyring, webEnv } from "@/lib/config";
import { pool } from "@/lib/db/pool";
import { isUuid } from "@/lib/db/tenant";
import { createConnection, deleteConnection } from "@/lib/data/connections";
import { createAuthor, createSite, deleteAuthor, deleteSite, getSite, updateAuthor, updateBrand, updateSite } from "@/lib/data/sites";
import { advanceOnboarding, listMembers, ONBOARDING_STEPS, type OnboardingStep } from "@/lib/data/workspaces";
import { hit, LIMITS } from "@/lib/rate-limit";
import { authorInput, brandInput, connectionInput, DEFAULT_SEO_RULES, inviteInput, siteInput, workspaceInput } from "@/lib/validation";

const bad = (field: string, msg: string): ActionState => ({ ok: false, error: "Check the highlighted fields.", fieldErrors: { [field]: msg }, at: Date.now() });

// ---------------------------------------------------------------- sites
export async function createSiteAction(slug: string, onboarding: boolean, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let siteId: string;
  try {
    const input = siteInput.parse(formObject(fd));
    siteId = await inWorkspace(slug, "site:create", "site.create", async (tx, a) => {
      const site = await createSite(tx, a.workspace.id, input);
      if (onboarding) await advanceOnboarding(tx, "scan", site.id);
      return site.id;
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/w/${slug}`, "layout");
  redirect(onboarding ? `/w/${slug}/onboarding/scan` : `/w/${slug}/sites/${siteId}/routes?crawl=1`);
}

export async function updateSiteAction(slug: string, siteId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = siteInput.omit({ domain: true }).parse(formObject(fd));
    await inWorkspace(slug, "site:update", "site.update", (tx) => updateSite(tx, siteId, input));
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true, message: "Site details saved.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteSiteAction(slug: string, siteId: string, confirmDomain: string): Promise<ActionState> {
  try {
    await inWorkspace(slug, "site:delete", "site.delete", async (tx) => {
      const site = await getSite(tx, siteId);
      if (site.domain !== confirmDomain.trim().toLowerCase()) throw Object.assign(new Error("Type the domain exactly to confirm."), { statusCode: 400, body: { message: "Type the domain exactly to confirm." } });
      await deleteSite(tx, siteId);
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/w/${slug}`, "layout");
  redirect(`/w/${slug}`);
}

// ---------------------------------------------------------------- brand profile
/** The brand form posts list fields as text areas and key pages as parallel arrays. */
function brandFromForm(fd: FormData) {
  const o = formObject(fd);
  const arr = (k: string) => ([] as unknown[]).concat(o[k] ?? []).map(String);
  const urls = arr("keyPageUrl"), titles = arr("keyPageTitle"), descs = arr("keyPageDescription");
  const keyPages = urls.map((url, i) => ({ url: url.trim(), title: titles[i] ?? "", description: descs[i] ?? "" })).filter((k) => k.url);
  const n = (k: keyof typeof DEFAULT_SEO_RULES) => o[`seo.${k}`] ?? DEFAULT_SEO_RULES[k];
  // checkboxes post "on" when ticked and nothing otherwise
  const f = (k: keyof typeof DEFAULT_SEO_RULES) => o[`seo.${k}`] === "on";
  const kinds = String(o["seo.coverKinds"] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return {
    ...o,
    keyPages,
    seoRules: {
      titleMax: n("titleMax"),
      descriptionMin: n("descriptionMin"),
      descriptionMax: n("descriptionMax"),
      bodyMinWords: n("bodyMinWords"),
      bodyMaxWords: n("bodyMaxWords"),
      internalLinksMin: n("internalLinksMin"),
      internalLinksMax: n("internalLinksMax"),
      minSections: n("minSections"),
      introMinSentences: n("introMinSentences"),
      introMaxSentences: n("introMaxSentences"),
      coverChips: n("coverChips"),
      coverChipMax: n("coverChipMax"),
      coverKinds: kinds,
      noH1InBody: f("noH1InBody"),
      noEmDash: f("noEmDash"),
      noEmoji: f("noEmoji"),
    },
  };
}

export async function saveBrandAction(slug: string, siteId: string, onboarding: boolean, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = brandInput.parse(brandFromForm(fd));
    await inWorkspace(slug, "brand:update", "brand_profile.update", async (tx) => {
      await updateBrand(tx, siteId, input);
      if (onboarding) await advanceOnboarding(tx, "authors");
    });
  } catch (e) {
    return toActionError(e);
  }
  if (onboarding) redirect(`/w/${slug}/onboarding/authors`);
  revalidatePath(`/w/${slug}/sites/${siteId}`, "layout");
  return { ok: true, message: "Brand profile saved.", at: Date.now() };
}

// ---------------------------------------------------------------- authors
export async function saveAuthorAction(slug: string, siteId: string, authorId: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = authorInput.parse(formObject(fd));
    await inWorkspace(slug, "author:manage", authorId ? "author.update" : "author.create", (tx, a) =>
      authorId ? updateAuthor(tx, authorId, input) : createAuthor(tx, a.workspace.id, siteId, input),
    );
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true, message: authorId ? "Author updated." : `${input.name} added.`, at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteAuthorAction(slug: string, authorId: string): Promise<ActionState> {
  try {
    await inWorkspace(slug, "author:manage", "author.delete", (tx) => deleteAuthor(tx, authorId));
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true, message: "Author removed.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------- connections
export async function createConnectionAction(slug: string, siteId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = connectionInput.parse(formObject(fd));
    const ring = keyring();
    await inWorkspace(slug, "connection:manage", "connection.create", (tx, a) => createConnection(tx, ring, a.workspace.id, siteId, input));
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true, message: "Connection saved. Its credentials are encrypted and never shown again.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteConnectionAction(slug: string, siteId: string, connectionId: string): Promise<ActionState> {
  try {
    await inWorkspace(slug, "connection:manage", "connection.delete", (tx) => deleteConnection(tx, connectionId));
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true, message: "Connection removed.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------- onboarding
const NEXT: Record<OnboardingStep, OnboardingStep> = {
  site: "scan",
  scan: "brand",
  brand: "authors",
  authors: "search",
  search: "publishing",
  publishing: "schedule",
  schedule: "done",
  done: "done",
};

/** Moves past a step (skippable "coming next" steps, or "continue" after the scan and authors). */
export async function continueOnboarding(slug: string, from: string): Promise<ActionState> {
  if (!(ONBOARDING_STEPS as readonly string[]).includes(from)) return { ok: false, error: "Unknown step." };
  const to = NEXT[from as OnboardingStep];
  try {
    await inWorkspace(slug, "site:update", "workspace.onboarding", (tx) => advanceOnboarding(tx, to));
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath(`/w/${slug}`, "layout");
  redirect(`/w/${slug}/onboarding/${to}`);
}

// ---------------------------------------------------------------- members & invitations (Better Auth)
export async function inviteAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const a = await requireWorkspace(slug);
    assertCan(a.role, "invitation:manage");
    const input = inviteInput.parse(formObject(fd));
    await hit(pool(), LIMITS.invitePerWorkspace, a.workspace.id, webEnv().rateLimitScale);
    const existing = (await listMembers(pool(), a.workspace.id)).find((m) => m.email === input.email);
    if (existing) return bad("email", `${input.email} is already a member.`);
    await runWithAudit(auditFor(a.viewer, "invitation.create", a.workspace.id), async () =>
      auth().api.createInvitation({ body: { email: input.email, role: input.role, organizationId: a.workspace.id, resend: true }, headers: await headers() }),
    );
    revalidatePath(`/w/${slug}/settings`);
    return { ok: true, message: `Invitation sent to ${input.email}.`, at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

export async function cancelInvitationAction(slug: string, invitationId: string): Promise<ActionState> {
  try {
    const a = await requireWorkspace(slug);
    assertCan(a.role, "invitation:manage");
    if (!isUuid(invitationId)) return { ok: false, error: "Unknown invitation." };
    await runWithAudit(auditFor(a.viewer, "invitation.cancel", a.workspace.id), async () => auth().api.cancelInvitation({ body: { invitationId }, headers: await headers() }));
    revalidatePath(`/w/${slug}/settings`);
    return { ok: true, message: "Invitation withdrawn.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

export async function changeRoleAction(slug: string, memberId: string, role: string): Promise<ActionState> {
  try {
    const a = await requireWorkspace(slug);
    assertCan(a.role, "member:manage");
    if (!isWorkspaceRole(role) || !isUuid(memberId)) return { ok: false, error: "Unknown role or member." };
    const members = await listMembers(pool(), a.workspace.id);
    const target = members.find((m) => m.member_id === memberId);
    if (!target) return { ok: false, error: "That person is no longer a member." };
    if (target.role === "owner" && role !== "owner" && members.filter((m) => m.role === "owner").length === 1) {
      return { ok: false, error: "A workspace needs at least one owner. Make someone else an owner first." };
    }
    await runWithAudit(auditFor(a.viewer, "member.role_change", a.workspace.id), async () =>
      auth().api.updateMemberRole({ body: { memberId, role, organizationId: a.workspace.id }, headers: await headers() }),
    );
    revalidatePath(`/w/${slug}/settings`);
    return { ok: true, message: `${target.email} is now ${/^[aeiou]/.test(role) ? "an" : "a"} ${role}.`, at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeMemberAction(slug: string, memberId: string): Promise<ActionState> {
  try {
    const a = await requireWorkspace(slug);
    assertCan(a.role, "member:manage");
    const members = await listMembers(pool(), a.workspace.id);
    const target = members.find((m) => m.member_id === memberId);
    if (!target) return { ok: false, error: "That person is no longer a member." };
    if (target.role === "owner" && members.filter((m) => m.role === "owner").length === 1) return { ok: false, error: "You cannot remove the last owner." };
    await runWithAudit(auditFor(a.viewer, "member.remove", a.workspace.id), async () =>
      auth().api.removeMember({ body: { memberIdOrEmail: memberId, organizationId: a.workspace.id }, headers: await headers() }),
    );
    revalidatePath(`/w/${slug}/settings`);
    return { ok: true, message: `${target.email} was removed.`, at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}

export async function renameWorkspaceAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const a = await requireWorkspace(slug);
    assertCan(a.role, "workspace:update");
    const { name } = workspaceInput.pick({ name: true }).parse(formObject(fd));
    await runWithAudit(auditFor(a.viewer, "workspace.update", a.workspace.id), async () =>
      auth().api.updateOrganization({ body: { data: { name }, organizationId: a.workspace.id }, headers: await headers() }),
    );
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true, message: "Workspace renamed.", at: Date.now() };
  } catch (e) {
    return toActionError(e);
  }
}
