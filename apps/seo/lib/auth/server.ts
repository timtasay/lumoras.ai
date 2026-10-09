/**
 * Better Auth 1.7.7 (docs read 9 October 2026; see docs/external-apis.md).
 *
 * - Postgres through `pg` (Kysely PostgresDialect inside Better Auth), on the
 *   app role's pool wrapped with audit context (audited-pool.ts).
 * - Every model and field mapped to the snake_case auth_* tables of
 *   migrations/0002_auth.sql; ids are database-generated uuids.
 * - Plugins: organization (workspaces, members, roles, invitations) with the
 *   roles from permissions.ts; magic link; admin (platform admins,
 *   impersonation); nextCookies last.
 * - Google sign-in only when GOOGLE_CLIENT_ID/SECRET are set.
 * - Cookies: httpOnly, SameSite=Lax, Secure whenever BETTER_AUTH_URL is https.
 * - CSRF: Better Auth's origin check against trustedOrigins (= BETTER_AUTH_URL)
 *   and Fetch-Metadata checks on sign-in. Rate limits in Postgres per client IP,
 *   plus a per-email limit on sign-in links.
 */
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, magicLink, organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";
import type pg from "pg";
import { auditedPool } from "./audited-pool.ts";
import { betterAuthStatements } from "./permissions.ts";
import { hit, LIMITS, RateLimitedError } from "../rate-limit.ts";

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const fields = <K extends string>(...names: K[]) => Object.fromEntries(names.map((n) => [n, snake(n)])) as Record<K, string>;

export const ac = createAccessControl({ ...defaultStatements });
export const orgRoles = {
  owner: ac.newRole(betterAuthStatements("owner")),
  editor: ac.newRole(betterAuthStatements("editor")),
  reviewer: ac.newRole(betterAuthStatements("reviewer")),
  viewer: ac.newRole(betterAuthStatements("viewer")),
};

export type AuthMail = {
  magicLink(to: string, url: string): Promise<void>;
  invitation(to: string, url: string, workspace: string, inviter: string, role: string): Promise<void>;
};

export type AuthConfig = {
  pool: pg.Pool;
  baseUrl: string;
  secret: string;
  secure: boolean;
  google: { clientId: string; clientSecret: string } | null;
  mail: AuthMail;
  rateLimitScale?: number;
};

/** Sign-in links last 15 minutes and work once. */
export const MAGIC_LINK_TTL_SEC = 15 * 60;
/** Invitations last 7 days. */
export const INVITATION_TTL_SEC = 7 * 24 * 60 * 60;

export function createAuth(cfg: AuthConfig) {
  const scale = cfg.rateLimitScale ?? 1;
  const rule = (window: number, max: number) => ({ window, max: Math.round(max * scale) });
  return betterAuth({
    appName: "Lumoras Growth",
    baseURL: cfg.baseUrl,
    secret: cfg.secret,
    trustedOrigins: [cfg.baseUrl],
    database: auditedPool(cfg.pool),
    telemetry: { enabled: false },
    emailAndPassword: { enabled: false },
    socialProviders: cfg.google
      ? { google: { clientId: cfg.google.clientId, clientSecret: cfg.google.clientSecret, prompt: "select_account" } }
      : {},
    user: { modelName: "auth_user", fields: fields("emailVerified", "createdAt", "updatedAt") },
    session: {
      modelName: "auth_session",
      fields: fields("expiresAt", "createdAt", "updatedAt", "ipAddress", "userAgent", "userId"),
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      // no cookie cache: revoking a session or ending an impersonation takes effect on the next request
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "auth_account",
      fields: fields("accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "createdAt", "updatedAt"),
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    verification: { modelName: "auth_verification", fields: fields("expiresAt", "createdAt", "updatedAt") },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limit",
      fields: fields("lastRequest"),
      window: 60,
      max: Math.round(120 * scale),
      customRules: {
        "/sign-in/magic-link": rule(60, 5),
        "/magic-link/verify": rule(60, 10),
        "/sign-in/social": rule(60, 10),
        "/organization/invite-member": rule(60, 20),
        "/organization/create": rule(60, 5),
        "/admin/impersonate-user": rule(60, 10),
      },
    },
    advanced: {
      useSecureCookies: cfg.secure,
      cookiePrefix: "lumoras-growth",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: cfg.secure, path: "/" },
      database: { generateId: "uuid" },
    },
    plugins: [
      organization({
        ac,
        roles: orgRoles,
        creatorRole: "owner",
        allowUserToCreateOrganization: true,
        organizationLimit: 10,
        membershipLimit: 200,
        invitationExpiresIn: INVITATION_TTL_SEC,
        cancelPendingInvitationsOnReInvite: true,
        requireEmailVerificationOnInvitation: true,
        schema: {
          session: { fields: fields("activeOrganizationId") },
          organization: { modelName: "auth_organization", fields: fields("createdAt") },
          member: { modelName: "auth_member", fields: fields("organizationId", "userId", "createdAt") },
          invitation: { modelName: "auth_invitation", fields: fields("organizationId", "expiresAt", "createdAt", "inviterId") },
        },
        async sendInvitationEmail(data) {
          await cfg.mail.invitation(
            data.email,
            `${cfg.baseUrl}/accept-invitation/${data.id}`,
            data.organization.name,
            data.inviter.user.name || data.inviter.user.email,
            String(data.role),
          );
        },
      }),
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SEC,
        storeToken: "hashed",
        async sendMagicLink({ email, url }) {
          try {
            await hit(cfg.pool, LIMITS.magicLinkPerEmail, email.toLowerCase(), scale);
          } catch (e) {
            if (e instanceof RateLimitedError) throw new APIError("TOO_MANY_REQUESTS", { message: e.message });
            throw e;
          }
          await cfg.mail.magicLink(email, url);
        },
      }),
      admin({
        defaultRole: "user",
        adminRoles: ["admin"],
        impersonationSessionDuration: 30 * 60,
        schema: {
          user: { fields: fields("banReason", "banExpires") },
          session: { fields: fields("impersonatedBy") },
        },
      }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
