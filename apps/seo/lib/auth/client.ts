"use client";
/**
 * Better Auth's browser client: sign-in (magic link, Google), sign-out and
 * ending an impersonation. Everything that changes workspace data goes
 * through server actions instead (lib/actions.ts).
 */
import { createAuthClient } from "better-auth/react";
import { adminClient, magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [magicLinkClient(), adminClient()],
});
