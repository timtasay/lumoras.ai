/**
 * safeFetch: GET a URL on a client's behalf without letting the URL reach our
 * own network (SSRF guard, build prompt section 14).
 *
 * For the first request and EVERY redirect hop:
 *   1. only http: and https:, no user:password@, only allowed ports;
 *   2. resolve the host (all A/AAAA records) and refuse if ANY address is not
 *      public unicast (lib/net/ip.ts: loopback, private, CGNAT, link-local,
 *      unique-local, metadata…);
 *   3. connect to the vetted address itself (the socket's DNS lookup is
 *      pinned to it), so a second DNS answer cannot swap in a private address
 *      between check and connect (DNS rebinding). TLS still verifies the
 *      certificate against the host name.
 * Redirects are followed by hand, up to maxRedirects. The response body is
 * capped (after decompression) and the whole fetch, redirects included, has
 * one deadline. No connection reuse (agent: false).
 */
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import { classifyAddress, type AddressVerdict } from "./ip.ts";

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (host: string) => Promise<ResolvedAddress[]>;

export type SsrfCode = "scheme" | "credentials" | "port" | "address" | "dns" | "redirect" | "too_large" | "timeout" | "network";

export class SsrfError extends Error {
  constructor(
    public readonly code: SsrfCode,
    message: string,
    public readonly url: string,
  ) {
    super(message);
    this.name = "SsrfError";
  }
}

export type SafeFetchPolicy = {
  /** Ports a URL may use. Default 80, 443, 8080, 8443. */
  allowedPorts?: ReadonlySet<number>;
  /**
   * Test hook: hosts resolved to fixed loopback addresses that are then
   * allowed on any port (CRAWLER_TEST_RESOLVE). Empty in production.
   */
  testResolve?: ReadonlyMap<string, string>;
  /** Test hook: replaces the address classifier (unit tests treat one loopback address as public). */
  classify?: (ip: string) => AddressVerdict;
};

export type SafeFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
  userAgent?: string;
  resolve?: Resolver;
  policy?: SafeFetchPolicy;
  signal?: AbortSignal;
};

export type SafeResponse = {
  url: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  redirects: string[];
  /** The address the final request connected to. */
  address: string;
};

export const DEFAULT_PORTS: ReadonlySet<number> = new Set([80, 443, 8080, 8443]);
export const USER_AGENT = "LumorasGrowthBot/1.0 (+https://lumoras.ai; sitemap and page metadata reader)";

const systemResolver: Resolver = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));

type Target = { url: URL; host: string; port: number; address: string; family: 4 | 6 };

/** Validates one URL and picks the vetted address to connect to. */
export async function vetUrl(raw: string, resolve: Resolver = systemResolver, policy: SafeFetchPolicy = {}): Promise<Target> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("scheme", `not a valid URL: ${raw}`, raw);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfError("scheme", `only http and https are allowed (got ${url.protocol})`, raw);
  if (url.username || url.password) throw new SsrfError("credentials", "URLs with credentials are not allowed", raw);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  // WHATWG URL already normalised 0x7f.1, 2130706433 and friends into dotted IPv4
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;

  const pinned = policy.testResolve?.get(host);
  if (pinned) return { url, host, port, address: pinned, family: isIP(pinned) === 6 ? 6 : 4 };

  let addrs: ResolvedAddress[];
  if (isIP(host)) addrs = [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
  else {
    try {
      addrs = await resolve(host);
    } catch (e) {
      throw new SsrfError("dns", `could not resolve ${host}: ${e instanceof Error ? e.message : String(e)}`, raw);
    }
    if (!addrs.length) throw new SsrfError("dns", `${host} has no addresses`, raw);
  }
  for (const a of addrs) {
    const v = (policy.classify ?? classifyAddress)(a.address);
    if (!v.ok) throw new SsrfError("address", `${host} resolves to ${a.address} (${v.reason}); refusing to connect`, raw);
  }
  if (!(policy.allowedPorts ?? DEFAULT_PORTS).has(port)) throw new SsrfError("port", `port ${port} is not allowed`, raw);
  return { url, host, port, address: addrs[0].address, family: addrs[0].family };
}

function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    if (opts && opts.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  }) as unknown as LookupFunction;
}

function decoded(res: http.IncomingMessage): Readable {
  const enc = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
  if (enc === "gzip" || enc === "x-gzip") return res.pipe(zlib.createGunzip());
  if (enc === "deflate") return res.pipe(zlib.createInflate());
  if (enc === "br") return res.pipe(zlib.createBrotliDecompress());
  return res;
}

function requestOnce(t: Target, o: Required<Pick<SafeFetchOptions, "maxBytes" | "accept" | "userAgent">>, deadline: number, signal?: AbortSignal) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer | null }>((resolveP, rejectP) => {
    const mod = t.url.protocol === "https:" ? https : http;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return rejectP(new SsrfError("timeout", "timed out", t.url.href));
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      rejectP(e);
    };
    const req = mod.request(
      {
        host: t.host,
        port: t.port,
        path: t.url.pathname + t.url.search,
        method: "GET",
        lookup: pinnedLookup(t.address, t.family),
        autoSelectFamily: false,
        agent: false,
        servername: isIP(t.host) ? undefined : t.host,
        headers: { "user-agent": o.userAgent, accept: o.accept, "accept-encoding": "gzip, deflate, br" },
      } as https.RequestOptions,
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          settled = true;
          clearTimeout(timer);
          req.destroy();
          return resolveP({ status, headers: res.headers, body: null });
        }
        const declared = Number(res.headers["content-length"] ?? NaN);
        if (Number.isFinite(declared) && declared > o.maxBytes && !res.headers["content-encoding"]) {
          return fail(new SsrfError("too_large", `response is ${declared} bytes; the limit is ${o.maxBytes}`, t.url.href));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = decoded(res);
        stream.on("data", (c: Buffer) => {
          size += c.length;
          if (size > o.maxBytes) {
            stream.destroy();
            fail(new SsrfError("too_large", `response exceeded ${o.maxBytes} bytes`, t.url.href));
          } else chunks.push(c);
        });
        stream.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolveP({ status, headers: res.headers, body: Buffer.concat(chunks) });
        });
        stream.on("error", (e) => fail(new SsrfError("network", `could not read the response: ${e.message}`, t.url.href)));
      },
    );
    const timer = setTimeout(() => fail(new SsrfError("timeout", `no complete response within the time limit`, t.url.href)), remaining);
    req.on("error", (e) => fail(new SsrfError("network", `request failed: ${e.message}`, t.url.href)));
    signal?.addEventListener("abort", () => fail(new SsrfError("timeout", "aborted", t.url.href)), { once: true });
    req.end();
  });
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const o = {
    maxBytes: opts.maxBytes ?? 5 * 1024 * 1024,
    accept: opts.accept ?? "*/*",
    userAgent: opts.userAgent ?? USER_AGENT,
  };
  const maxRedirects = opts.maxRedirects ?? 5;
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  const resolve = opts.resolve ?? systemResolver;
  const redirects: string[] = [];
  let current = rawUrl;
  for (let hop = 0; ; hop++) {
    const target = await vetUrl(current, resolve, opts.policy);
    const r = await requestOnce(target, o, deadline, opts.signal);
    if (r.body === null) {
      if (hop >= maxRedirects) throw new SsrfError("redirect", `more than ${maxRedirects} redirects`, rawUrl);
      const next = new URL(String(r.headers.location), target.url).href;
      redirects.push(next);
      current = next;
      continue;
    }
    return { url: target.url.href, status: r.status, headers: r.headers, body: r.body, redirects, address: target.address };
  }
}
