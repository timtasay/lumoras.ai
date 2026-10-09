/**
 * Outbound email through Resend, configured like the other Lumoras sites:
 * RESEND_API_KEY, EMAIL_FROM (a verified sender) and EMAIL_FROM_NAME.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type OutboundEmail = { to: string; subject: string; text: string; replyTo?: string };

const env = (name: string) => process.env[name]?.trim() || undefined;

export function isEmailConfigured() {
  return env("RESEND_API_KEY") !== undefined && env("EMAIL_FROM") !== undefined;
}

/** Sends one message, or throws when unconfigured or when Resend rejects it. */
export async function sendEmail(message: OutboundEmail): Promise<void> {
  const key = env("RESEND_API_KEY");
  const from = env("EMAIL_FROM");
  if (!key || !from) throw new Error("Email is not configured");

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: `${env("EMAIL_FROM_NAME") ?? "Lumoras"} <${from}>`,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.replyTo ? { reply_to: [message.replyTo] } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
    throw new Error(`Resend send failed (HTTP ${res.status}${body.name ? `, ${body.name}` : ""}): ${body.message ?? "no detail"}`);
  }
}
