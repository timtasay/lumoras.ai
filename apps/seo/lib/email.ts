/**
 * Outgoing email (magic links, invitations), configured like apps/web/lib/email.ts:
 *   RESEND_API_KEY + EMAIL_FROM (+ EMAIL_FROM_NAME)   → sent through Resend
 *   EMAIL_OUTBOX_DIR (tests only)                     → written as JSON files
 *   neither, outside production                       → logged to the server console
 * Production without Resend refuses to start (lib/env.ts), so sign-in links
 * are never written to production logs.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { log, webEnv } from "./config.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  /** Machine-readable purpose, kept in the outbox file for tests. */
  kind: "magic-link" | "invitation";
  /** The link the message carries (tests follow it). */
  link?: string;
};

export async function sendEmail(message: OutboundEmail): Promise<void> {
  const env = webEnv();
  if (env.emailOutboxDir) {
    await mkdir(env.emailOutboxDir, { recursive: true });
    const file = path.join(env.emailOutboxDir, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(file, JSON.stringify({ ...message, at: new Date().toISOString() }, null, 2));
    return;
  }
  if (!env.email) {
    // development only (production requires Resend): show the link in the terminal
    log().info("email (not sent: RESEND_API_KEY unset)", { to: message.to, subject: message.subject, kind: message.kind, link: message.link });
    return;
  }
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${env.email.resendKey}` },
    body: JSON.stringify({
      from: `${env.email.fromName} <${env.email.from}>`,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
    throw new Error(`Resend send failed (HTTP ${res.status}${body.name ? `, ${body.name}` : ""}): ${body.message ?? "no detail"}`);
  }
}
