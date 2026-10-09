/**
 * A local webhook receiver that checks our signature exactly as the README
 * tells clients to (verifyWebhook: HMAC-SHA256 over "<timestamp>.<raw body>",
 * constant-time compare, five-minute replay window). It records every
 * delivery with the verdict and answers 401 to a bad signature.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { verifyWebhook, type VerifyResult } from "../../lib/publishers/webhook.ts";

export type Delivery = { path: string; headers: http.IncomingHttpHeaders; raw: string; json: unknown; verdict: VerifyResult };
export type FakeWebhook = { port: number; origin: string; deliveries: Delivery[]; failNext: (status: number) => void; close(): Promise<void> };

export async function startFakeWebhook(secret: string, opts: { hostName?: string; port?: number; now?: () => number } = {}): Promise<FakeWebhook> {
  const deliveries: Delivery[] = [];
  let fail: number | null = null;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const verdict = verifyWebhook(secret, { timestamp: req.headers["x-lumoras-timestamp"] as string, signature: req.headers["x-lumoras-signature"] as string }, raw, opts.now ? opts.now() : undefined);
      let json: unknown = null;
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
      deliveries.push({ path: req.url ?? "/", headers: req.headers, raw, json, verdict });
      const status = fail ?? (verdict.ok ? 200 : 401);
      fail = null;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(verdict.ok ? { received: true } : { error: verdict.ok ? null : verdict.reason }));
    });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    origin: `http://${opts.hostName ?? "127.0.0.1"}:${port}`,
    deliveries,
    failNext: (s) => void (fail = s),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
