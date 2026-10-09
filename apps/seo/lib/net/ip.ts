/**
 * Which IP addresses we may connect to on a client's behalf (SSRF guard).
 *
 * Allow-list first: only public unicast is allowed. For IPv4 that is anything
 * outside the special-purpose ranges below; for IPv6 only 2000::/3 (global
 * unicast) outside its special blocks. Addresses that embed an IPv4 address
 * (IPv4-mapped, NAT64, 6to4) are judged by the embedded address.
 *
 * Refused (with the reason, so logs and tests can name it): unspecified,
 * loopback, private (RFC 1918), carrier-grade NAT (100.64/10), link-local
 * (169.254/16, fe80::/10), cloud metadata (169.254.169.254, 169.254.170.2,
 * 100.100.100.200, fd00:ec2::254), unique-local IPv6 (fc00::/7), site-local,
 * multicast, broadcast, documentation, benchmarking, reserved and discard
 * ranges, Teredo.
 */
import { BlockList, isIP } from "node:net";

export type AddressVerdict = { ok: true } | { ok: false; reason: string };

type Range = [cidr: string, prefix: number, reason: string];

const V4: Range[] = [
  ["0.0.0.0", 8, "unspecified / this network"],
  ["10.0.0.0", 8, "private network"],
  ["100.64.0.0", 10, "carrier-grade NAT"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local"],
  ["172.16.0.0", 12, "private network"],
  ["192.0.0.0", 24, "IETF protocol assignments"],
  ["192.0.2.0", 24, "documentation"],
  ["192.88.99.0", 24, "6to4 relay"],
  ["192.168.0.0", 16, "private network"],
  ["198.18.0.0", 15, "benchmarking"],
  ["198.51.100.0", 24, "documentation"],
  ["203.0.113.0", 24, "documentation"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
];

/** Cloud metadata endpoints, named explicitly (most also fall in a range above). */
const METADATA = new Map<string, string>([
  ["169.254.169.254", "cloud metadata (AWS, GCP, Azure, DigitalOcean)"],
  ["169.254.170.2", "cloud metadata (AWS ECS task)"],
  ["100.100.100.200", "cloud metadata (Alibaba)"],
  ["fd00:ec2::254", "cloud metadata (AWS IPv6)"],
]);

const V6: Range[] = [
  ["::", 128, "unspecified"],
  ["::1", 128, "loopback"],
  ["100::", 64, "discard"],
  ["2001::", 32, "Teredo"],
  ["2001:2::", 48, "benchmarking"],
  ["2001:db8::", 32, "documentation"],
  ["2001:10::", 28, "ORCHID"],
  ["2001:20::", 28, "ORCHIDv2"],
  ["fc00::", 7, "unique-local"],
  ["fe80::", 10, "link-local"],
  ["fec0::", 10, "site-local"],
  ["ff00::", 8, "multicast"],
];

function list(ranges: Range[], type: "ipv4" | "ipv6") {
  return ranges.map(([net, prefix, reason]) => {
    const b = new BlockList();
    b.addSubnet(net, prefix, type);
    return { b, reason };
  });
}
const V4_LISTS = list(V4, "ipv4");
const V6_LISTS = list(V6, "ipv6");
const GLOBAL_UNICAST_V6 = (() => {
  const b = new BlockList();
  b.addSubnet("2000::", 3, "ipv6");
  return b;
})();

/** The 8 hextets of an IPv6 address (handles "::", a zone id and a trailing dotted IPv4). */
export function expand6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (dotted) {
    const o = dotted.slice(1).map(Number);
    if (o.some((x) => x > 255)) return null;
    s = s.slice(0, dotted.index) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN)));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const out = [...head, ...Array<number>(halves.length === 2 ? fill : 0).fill(0), ...tail];
  return out.every((n) => Number.isInteger(n)) ? out : null;
}

const v4FromHextets = (a: number, b: number) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;

function classify4(ip: string): AddressVerdict {
  const meta = METADATA.get(ip);
  if (meta) return { ok: false, reason: meta };
  if (ip === "255.255.255.255") return { ok: false, reason: "broadcast" };
  for (const { b, reason } of V4_LISTS) if (b.check(ip, "ipv4")) return { ok: false, reason };
  return { ok: true };
}

/** Is this literal IP address one we may connect to? */
export function classifyAddress(ip: string): AddressVerdict {
  const fam = isIP(ip);
  if (fam === 4) return classify4(ip);
  if (fam !== 6) return { ok: false, reason: "not an IP address" };
  const h = expand6(ip);
  if (!h) return { ok: false, reason: "unparseable IPv6 address" };
  const norm = h.map((x) => x.toString(16)).join(":");
  if (h[0] === 0xfd00 && h[1] === 0xec2 && h.slice(2, 7).every((x) => x === 0) && h[7] === 0x254) {
    return { ok: false, reason: METADATA.get("fd00:ec2::254")! };
  }
  // embedded IPv4: ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), 64:ff9b::/96 (NAT64), 2002::/16 (6to4)
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    if (h[5] === 0 && h[6] === 0 && h[7] <= 1) return classifyV6Ranges(norm);
    const inner = classify4(v4FromHextets(h[6], h[7]));
    return inner.ok ? inner : { ok: false, reason: `${inner.reason} (IPv4 inside IPv6)` };
  }
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
    const inner = classify4(v4FromHextets(h[6], h[7]));
    return inner.ok ? inner : { ok: false, reason: `${inner.reason} (NAT64)` };
  }
  if (h[0] === 0x2002) {
    const inner = classify4(v4FromHextets(h[1], h[2]));
    return inner.ok ? inner : { ok: false, reason: `${inner.reason} (6to4)` };
  }
  return classifyV6Ranges(norm);
}

function classifyV6Ranges(norm: string): AddressVerdict {
  for (const { b, reason } of V6_LISTS) if (b.check(norm, "ipv6")) return { ok: false, reason };
  if (!GLOBAL_UNICAST_V6.check(norm, "ipv6")) return { ok: false, reason: "not global unicast IPv6" };
  return { ok: true };
}
