/**
 * SSRF guard: address classification, and safeFetch against local HTTP
 * servers with a mocked DNS resolver. No real network.
 *
 * Local test servers listen on 127.0.0.2 ("the public internet" for these
 * tests, via the policy's classify hook) and on 127.0.0.1 (an "internal"
 * service that must never be reached).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { classifyAddress, expand6 } from "../../lib/net/ip.ts";
import { safeFetch, SsrfError, vetUrl, type Resolver, type SafeFetchPolicy } from "../../lib/net/safe-fetch.ts";

describe("classifyAddress", () => {
  const refused: [string, RegExp][] = [
    ["127.0.0.1", /loopback/],
    ["127.255.255.254", /loopback/],
    ["10.1.2.3", /private/],
    ["172.16.0.1", /private/],
    ["172.31.255.255", /private/],
    ["192.168.1.1", /private/],
    ["100.64.0.1", /carrier-grade NAT/],
    ["100.100.100.200", /metadata \(Alibaba\)/],
    ["169.254.169.254", /cloud metadata/],
    ["169.254.170.2", /metadata \(AWS ECS/],
    ["169.254.10.10", /link-local/],
    ["0.0.0.0", /unspecified/],
    ["224.0.0.1", /multicast/],
    ["255.255.255.255", /broadcast/],
    ["240.0.0.1", /reserved/],
    ["192.0.2.10", /documentation/],
    ["198.18.0.1", /benchmarking/],
    ["::1", /loopback/],
    ["::", /unspecified/],
    ["fe80::1", /link-local/],
    ["fc00::1", /unique-local/],
    ["fd12:3456::1", /unique-local/],
    ["fd00:ec2::254", /cloud metadata \(AWS IPv6\)/],
    ["fd00:ec2:0:0:0:0:0:254", /cloud metadata \(AWS IPv6\)/],
    ["ff02::1", /multicast/],
    ["::ffff:127.0.0.1", /loopback \(IPv4 inside IPv6\)/],
    ["::ffff:7f00:1", /loopback \(IPv4 inside IPv6\)/],
    ["::ffff:169.254.169.254", /metadata/],
    ["64:ff9b::10.0.0.1", /private network \(NAT64\)/],
    ["2002:c0a8:0101::1", /private network \(6to4\)/],
    ["2001:db8::1", /documentation/],
    ["2001::1", /Teredo/],
    ["fec0::1", /site-local/],
    ["100::1", /discard/],
    ["not-an-ip", /not an IP/],
  ];
  for (const [ip, why] of refused) {
    it(`refuses ${ip}`, () => {
      const v = classifyAddress(ip);
      assert.equal(v.ok, false, `${ip} must be refused`);
      assert.match((v as { reason: string }).reason, why);
    });
  }
  for (const ip of ["93.184.215.14", "1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4009:81f::200e", "::ffff:8.8.8.8"]) {
    it(`allows public ${ip}`, () => assert.deepEqual(classifyAddress(ip), { ok: true }));
  }
  it("expands IPv6 forms", () => {
    assert.deepEqual(expand6("::1"), [0, 0, 0, 0, 0, 0, 0, 1]);
    assert.deepEqual(expand6("::ffff:1.2.3.4"), [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    assert.deepEqual(expand6("fe80::1%eth0"), [0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    assert.equal(expand6("1::2::3"), null);
    assert.equal(expand6("12345::"), null);
  });
});

describe("safeFetch (local servers, mocked DNS)", () => {
  const PUBLIC = "127.0.0.2";
  const hits = { internal: 0, public: 0 };
  let pub: http.Server, internal: http.Server;
  let pubPort = 0, internalPort = 0;

  const policy = (): SafeFetchPolicy => ({
    allowedPorts: new Set([pubPort, internalPort]),
    classify: (ip) => (ip === PUBLIC ? { ok: true } : classifyAddress(ip)),
  });
  /** DNS: site.test → the "public" server; internal.test → loopback; mixed.test → both. */
  const dns: Resolver = async (host) => {
    if (host === "site.test") return [{ address: PUBLIC, family: 4 }];
    if (host === "internal.test") return [{ address: "127.0.0.1", family: 4 }];
    if (host === "metadata.test") return [{ address: "169.254.169.254", family: 4 }];
    if (host === "mixed.test") return [{ address: PUBLIC, family: 4 }, { address: "10.0.0.5", family: 4 }];
    if (host === "v6.test") return [{ address: "::1", family: 6 }];
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
  };

  before(async () => {
    internal = http.createServer((_req, res) => {
      hits.internal++;
      res.end("INTERNAL SECRET");
    });
    pub = http.createServer((req, res) => {
      hits.public++;
      const u = new URL(req.url!, "http://x");
      if (u.pathname === "/ok") return res.end("hello");
      if (u.pathname === "/to-metadata") return res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
      if (u.pathname === "/to-internal-host") return res.writeHead(301, { location: `http://internal.test:${internalPort}/` }).end();
      if (u.pathname === "/to-loopback-literal") return res.writeHead(307, { location: `http://127.0.0.1:${internalPort}/` }).end();
      if (u.pathname === "/to-file") return res.writeHead(302, { location: "file:///etc/passwd" }).end();
      if (u.pathname === "/relative") return res.writeHead(302, { location: "/ok" }).end();
      if (u.pathname === "/loop") return res.writeHead(302, { location: "/loop" }).end();
      if (u.pathname === "/big") return res.end(Buffer.alloc(2 * 1024 * 1024, 97));
      if (u.pathname === "/bomb") {
        res.writeHead(200, { "content-encoding": "gzip" });
        return res.end(zlib.gzipSync(Buffer.alloc(40 * 1024 * 1024)));
      }
      if (u.pathname === "/slow") return setTimeout(() => res.end("late"), 2000);
      if (u.pathname === "/host") return res.end(String(req.headers.host));
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => internal.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => pub.listen(0, PUBLIC, r));
    internalPort = (internal.address() as AddressInfo).port;
    pubPort = (pub.address() as AddressInfo).port;
  });
  after(() => {
    pub.closeAllConnections();
    pub.close();
    internal.close();
  });

  const site = (path: string) => `http://site.test:${pubPort}${path}`;
  const refusedWith = (code: string, re: RegExp) => (e: unknown) => e instanceof SsrfError && e.code === code && re.test(e.message);

  it("fetches a public URL, sends the real Host header and pins the vetted address", async () => {
    const r = await safeFetch(site("/host"), { resolve: dns, policy: policy() });
    assert.equal(r.status, 200);
    assert.equal(r.body.toString(), `site.test:${pubPort}`);
    assert.equal(r.address, PUBLIC);
  });

  it("refuses non-http schemes and credentials", async () => {
    for (const u of ["file:///etc/passwd", "gopher://site.test/", "ftp://site.test/x", "javascript:alert(1)", "data:text/plain,x"]) {
      await assert.rejects(safeFetch(u, { resolve: dns, policy: policy() }), refusedWith("scheme", /only http and https|not a valid URL/), u);
    }
    await assert.rejects(safeFetch(`http://user:pw@site.test:${pubPort}/ok`, { resolve: dns, policy: policy() }), refusedWith("credentials", /credentials/));
  });

  it("refuses ports outside the allowed set", async () => {
    await assert.rejects(safeFetch("http://site.test:22/", { resolve: dns, policy: policy() }), refusedWith("port", /port 22/));
  });

  it("refuses hosts that resolve to loopback, private or metadata addresses", async () => {
    await assert.rejects(safeFetch(`http://internal.test:${internalPort}/`, { resolve: dns, policy: policy() }), refusedWith("address", /127\.0\.0\.1 \(loopback\)/));
    await assert.rejects(safeFetch(`http://metadata.test:${pubPort}/`, { resolve: dns, policy: policy() }), refusedWith("address", /169\.254\.169\.254 \(cloud metadata/));
    await assert.rejects(safeFetch(`http://v6.test:${pubPort}/`, { resolve: dns, policy: policy() }), refusedWith("address", /::1 \(loopback\)/));
    await assert.rejects(safeFetch(`http://mixed.test:${pubPort}/ok`, { resolve: dns, policy: policy() }), refusedWith("address", /10\.0\.0\.5 \(private network\)/), "one private record poisons the host");
    assert.equal(hits.internal, 0);
  });

  it("refuses IP literals in every disguise", async () => {
    for (const host of ["127.0.0.1", "2130706433", "0x7f.0.0.1", "0177.0.0.1", "127.1", "[::1]", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "169.254.169.254", "[fd00:ec2::254]"]) {
      await assert.rejects(
        safeFetch(`http://${host}:${internalPort}/`, { resolve: dns, policy: policy() }),
        refusedWith("address", /loopback|metadata|link-local/),
        host,
      );
    }
    assert.equal(hits.internal, 0);
  });

  it("re-checks every redirect: to metadata, to an internal host, to a loopback literal, to file:", async () => {
    await assert.rejects(safeFetch(site("/to-metadata"), { resolve: dns, policy: policy() }), refusedWith("address", /169\.254\.169\.254 \(cloud metadata/), "followed /to-metadata → http://169.254.169.254/latest/meta-data/");
    await assert.rejects(safeFetch(site("/to-internal-host"), { resolve: dns, policy: policy() }), refusedWith("address", /internal\.test resolves to 127\.0\.0\.1/), "followed /to-internal-host → internal.test (127.0.0.1)");
    await assert.rejects(safeFetch(site("/to-loopback-literal"), { resolve: dns, policy: policy() }), refusedWith("address", /loopback/), "followed /to-loopback-literal → http://127.0.0.1");
    await assert.rejects(safeFetch(site("/to-file"), { resolve: dns, policy: policy() }), refusedWith("scheme", /file:/), "followed /to-file → file:///etc/passwd");
    assert.equal(hits.internal, 0, "the internal server was reached");
  });

  it("follows safe redirects, and stops after the hop limit", async () => {
    const r = await safeFetch(site("/relative"), { resolve: dns, policy: policy() });
    assert.equal(r.body.toString(), "hello");
    assert.deepEqual(r.redirects, [site("/ok")]);
    await assert.rejects(safeFetch(site("/loop"), { resolve: dns, policy: policy(), maxRedirects: 3 }), refusedWith("redirect", /more than 3 redirects/));
  });

  it("DNS rebinding: resolves once per hop and connects to the vetted address, not a later answer", async () => {
    let calls = 0;
    // first answer public, every later answer the internal service
    const rebinding: Resolver = async () => (calls++ === 0 ? [{ address: PUBLIC, family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
    const before = hits.internal;
    const r = await safeFetch(`http://rebind.test:${pubPort}/ok`, { resolve: rebinding, policy: policy() });
    assert.equal(r.body.toString(), "hello", "served by the vetted (public) address");
    assert.equal(r.address, PUBLIC);
    assert.equal(calls, 1, "the connection must not resolve the name again");
    assert.equal(hits.internal, before, "the internal service was reached through a second DNS answer");
  });

  it("caps the body size, including after decompression (gzip bomb)", async () => {
    await assert.rejects(safeFetch(site("/big"), { resolve: dns, policy: policy(), maxBytes: 1024 * 1024 }), refusedWith("too_large", /exceeded 1048576 bytes|limit is 1048576/));
    await assert.rejects(safeFetch(site("/bomb"), { resolve: dns, policy: policy(), maxBytes: 1024 * 1024 }), refusedWith("too_large", /exceeded/));
  });

  it("caps the time", async () => {
    const t0 = Date.now();
    await assert.rejects(safeFetch(site("/slow"), { resolve: dns, policy: policy(), timeoutMs: 300 }), refusedWith("timeout", /time limit/));
    assert.ok(Date.now() - t0 < 1500);
  });

  it("reports DNS failures as such", async () => {
    await assert.rejects(vetUrl("http://nowhere.test/", dns, policy()), refusedWith("dns", /could not resolve nowhere\.test/));
  });

  it("test origins (CRAWLER_TEST_ORIGINS) pin a .test host to loopback on any port; nothing else is let through", async () => {
    const t = await vetUrl(`http://fake.test:${internalPort}/x`, dns, { testResolve: new Map([["fake.test", "127.0.0.1"]]) });
    assert.equal(t.address, "127.0.0.1");
    await assert.rejects(vetUrl(`http://other.test:${internalPort}/`, dns, { testResolve: new Map([["fake.test", "127.0.0.1"]]) }), SsrfError);
  });
});
