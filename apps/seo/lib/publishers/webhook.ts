/**
 * Webhook publishing (section 8.3): we POST signed JSON to the client's
 * endpoint, through the SSRF guard.
 *
 * Signature (HMAC-SHA256 with the connection's signing secret):
 *
 *   X-Lumoras-Event:      article.published | article.updated | article.unpublished | ping
 *   X-Lumoras-Delivery:   a uuid per delivery (receivers may dedupe on it)
 *   X-Lumoras-Timestamp:  unix seconds when we signed
 *   X-Lumoras-Signature:  v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *
 * A receiver recomputes the HMAC over the raw body exactly as received,
 * compares in constant time, and rejects a timestamp more than five minutes
 * from its clock (replay window). verifyWebhook() below is that check, and
 * is what the README tells clients to copy.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { renderMarkdown } from "../content/markdown.ts";
import { remoteMessage, requestJson, type HttpDeps } from "./http.ts";
import { PublishError, type PublicationRef, type PublicationStatus, type PublishableArticle, type Publisher, type PublishResult, type Validation } from "./types.ts";
import { articleJsonLd } from "./byline.ts";

export const SIGNATURE_VERSION = "v1";
export const REPLAY_WINDOW_SEC = 300;
export type WebhookEvent = "article.published" | "article.updated" | "article.unpublished" | "ping";

export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  return `${SIGNATURE_VERSION}=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

/** The receiver's check: signature over the raw body, constant-time compare, timestamp inside the replay window. */
export function verifyWebhook(secret: string, headers: { timestamp?: string | null; signature?: string | null }, rawBody: string, nowSec = Math.floor(Date.now() / 1000), windowSec = REPLAY_WINDOW_SEC): VerifyResult {
  if (!headers.timestamp || !headers.signature) return { ok: false, reason: "missing" };
  if (!/^\d{1,12}$/.test(headers.timestamp)) return { ok: false, reason: "malformed" };
  const ts = Number(headers.timestamp);
  if (Math.abs(nowSec - ts) > windowSec) return { ok: false, reason: "stale" };
  const m = /^v1=([0-9a-f]{64})$/.exec(headers.signature.trim());
  if (!m) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(signWebhook(secret, ts, rawBody).slice(3), "hex");
  const got = Buffer.from(m[1], "hex");
  return expected.length === got.length && timingSafeEqual(expected, got) ? { ok: true } : { ok: false, reason: "mismatch" };
}

export type WebhookConfig = { endpoint: string };

/** The JSON body for an article event: data only, the article as published plus its HTML. */
export function webhookPayload(event: WebhookEvent, a: PublishableArticle | null, site: { domain: string }, delivery: string, sentAt: Date) {
  return {
    event,
    delivery,
    sentAt: sentAt.toISOString(),
    site: { domain: site.domain },
    article: a
      ? {
          id: a.id,
          slug: a.slug,
          title: a.title,
          description: a.description,
          date: a.date,
          updated: a.updated,
          url: a.url,
          path: a.path,
          keyword: a.keyword,
          secondaryKeywords: a.secondaryKeywords,
          tags: a.tags,
          readingMinutes: a.readingMinutes,
          words: a.words,
          author: a.author,
          // schema.org BlogPosting with the byline as Person or Organization, for a <script type="application/ld+json">
          structuredData: articleJsonLd(a, site),
          cover: a.cover,
          sources: a.sources,
          version: a.version,
          markdown: event === "article.unpublished" ? null : a.bodyMd,
          html: event === "article.unpublished" ? null : renderMarkdown(a.bodyMd),
        }
      : null,
  };
}

export class WebhookPublisher implements Publisher {
  readonly kind = "webhook" as const;
  constructor(
    private readonly cfg: WebhookConfig,
    private readonly secret: string,
    private readonly site: { domain: string },
    private readonly deps: HttpDeps & { now?: () => Date } = {},
  ) {}

  private async deliver(event: WebhookEvent, a: PublishableArticle | null): Promise<{ delivery: string; status: number }> {
    const now = (this.deps.now ?? (() => new Date()))();
    const delivery = randomUUID();
    const raw = JSON.stringify(webhookPayload(event, a, this.site, delivery, now));
    const ts = Math.floor(now.getTime() / 1000);
    const r = await requestJson(this.deps, "POST", this.cfg.endpoint, {
      rawBody: raw,
      headers: {
        "x-lumoras-event": event,
        "x-lumoras-delivery": delivery,
        "x-lumoras-timestamp": String(ts),
        "x-lumoras-signature": signWebhook(this.secret, ts, raw),
      },
    });
    if (r.status < 200 || r.status >= 300) {
      const m = remoteMessage(r);
      throw new PublishError(`The endpoint answered ${r.status}${m ? `: ${m}` : ""}.`, { status: r.status, retryable: r.status >= 500 || r.status === 429 });
    }
    return { delivery, status: r.status };
  }

  async validate(): Promise<Validation> {
    try {
      const r = await this.deliver("ping", null);
      return { ok: true, detail: `The endpoint accepted a signed ping (${r.status}).`, checks: [{ label: "Signed ping", ok: true, detail: `HTTP ${r.status}, delivery ${r.delivery.slice(0, 8)}` }] };
    } catch (e) {
      const detail = e instanceof PublishError ? e.message : "Unexpected error.";
      return { ok: false, detail, checks: [{ label: "Signed ping", ok: false, detail }] };
    }
  }

  async publish(a: PublishableArticle): Promise<PublishResult> {
    const r = await this.deliver("article.published", a);
    return { status: "published", mode: "webhook", remoteId: r.delivery, liveUrl: a.url, detail: `Delivered (HTTP ${r.status}).` };
  }
  async update(a: PublishableArticle): Promise<PublishResult> {
    const r = await this.deliver("article.updated", a);
    return { status: "published", mode: "webhook", remoteId: r.delivery, liveUrl: a.url, detail: `Update delivered (HTTP ${r.status}).` };
  }
  async unpublish(a: PublishableArticle): Promise<PublishResult> {
    const r = await this.deliver("article.unpublished", a);
    return { status: "published", mode: "webhook", remoteId: r.delivery, liveUrl: a.url, detail: `Removal delivered (HTTP ${r.status}).` };
  }
  async status(prev: PublicationRef): Promise<PublicationStatus> {
    return { status: "published", detail: prev.remoteId ? `Delivered as ${prev.remoteId.slice(0, 8)}; the receiver owns what happens next.` : "Delivered." };
  }
}
