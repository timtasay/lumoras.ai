/**
 * Outgoing email (magic links, invitations, runway alerts), configured like apps/web/lib/email.ts:
 *   RESEND_API_KEY + EMAIL_FROM (+ EMAIL_FROM_NAME)   → sent through Resend
 *   EMAIL_OUTBOX_DIR (tests only)                     → written as JSON files
 *   neither, outside production                       → logged to the server console
 * Production without Resend refuses to start (lib/env.ts), so sign-in links
 * are never written to production logs.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EmailEnv } from "./env.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  /** Machine-readable purpose, kept in the outbox file for tests. */
  kind: "magic-link" | "invitation" | "runway-alert" | "review-request";
  /** The link the message carries (tests follow it). */
  link?: string;
};

type Log = { info(msg: string, f?: Record<string, unknown>): void };

/** Sends with explicit settings (the worker has no web env). */
export async function sendEmailWith(cfg: EmailEnv, message: OutboundEmail, log: Log): Promise<void> {
  if (cfg.emailOutboxDir) {
    await mkdir(cfg.emailOutboxDir, { recursive: true });
    const file = path.join(cfg.emailOutboxDir, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(file, JSON.stringify({ ...message, at: new Date().toISOString() }, null, 2));
    return;
  }
  if (!cfg.email) {
    // development only (production requires Resend): show the message in the terminal
    log.info("email (not sent: RESEND_API_KEY unset)", { to: message.to, subject: message.subject, kind: message.kind, link: message.link });
    return;
  }
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${cfg.email.resendKey}` },
    body: JSON.stringify({
      from: `${cfg.email.fromName} <${cfg.email.from}>`,
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

export async function sendEmail(message: OutboundEmail): Promise<void> {
  const { log, webEnv } = await import("./config.ts");
  const env = webEnv();
  return sendEmailWith({ email: env.email, emailOutboxDir: env.emailOutboxDir }, message, log());
}
