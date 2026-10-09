/**
 * What we read out of Search Console and GA4 in Phase 2, as pure functions:
 *   - striking-distance queries: ranking 4–20 with enough impressions to matter;
 *   - pages that get impressions but no clicks;
 *   - GA4 measurement health: a broken tag reads exactly like zero traffic;
 *   - which property belongs to the site.
 */
export type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

export type StrikingQuery = { query: string; page: string; position: number; impressions: number; clicks: number; ctr: number };

/** Queries ranking in positions 4–20 (inclusive), most impressions first. */
export function strikingDistance(rows: GscRow[], opts: { min?: number; max?: number; minImpressions?: number; limit?: number } = {}): StrikingQuery[] {
  const min = opts.min ?? 4, max = opts.max ?? 20, minImp = opts.minImpressions ?? 10;
  return rows
    .filter((r) => r.position >= min && r.position <= max && r.impressions >= minImp && r.keys[0])
    .map((r) => ({ query: r.keys[0], page: r.keys[1] ?? "", position: Math.round(r.position * 10) / 10, impressions: r.impressions, clicks: r.clicks, ctr: r.ctr }))
    .sort((a, b) => b.impressions - a.impressions || a.position - b.position)
    .slice(0, opts.limit ?? 25);
}

export type ZeroClickPage = { page: string; impressions: number; position: number };

/** Pages Google shows but nobody clicks: candidates for a better title and description. */
export function zeroClickPages(rows: GscRow[], opts: { minImpressions?: number; limit?: number } = {}): ZeroClickPage[] {
  const minImp = opts.minImpressions ?? 50;
  return rows
    .filter((r) => r.clicks === 0 && r.impressions >= minImp && r.keys[0])
    .map((r) => ({ page: r.keys[0], impressions: r.impressions, position: Math.round(r.position * 10) / 10 }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, opts.limit ?? 25);
}

export type Health = { state: "ok" | "warn" | "error"; detail: string; zeroDays: number; lastDataDay: string | null };

/**
 * Measurement health from daily sessions (YYYYMMDD or YYYY-MM-DD, any order,
 * missing days count as zero). No sessions at all → error; the most recent
 * two or more days at zero after earlier traffic → warn (the tag may have
 * broken); otherwise ok.
 */
export function measurementHealth(days: { date: string; sessions: number }[], today: Date, window = 14): Health {
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const norm = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s);
  const by = new Map(days.map((d) => [norm(d.date), d.sessions]));
  const series: { day: string; n: number }[] = [];
  for (let i = window; i >= 1; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    series.push({ day: key(d), n: by.get(key(d)) ?? 0 });
  }
  const total = series.reduce((s, x) => s + x.n, 0);
  const lastData = [...series].reverse().find((x) => x.n > 0)?.day ?? null;
  const zeroDays = series.filter((x) => x.n === 0).length;
  if (total === 0) return { state: "error", detail: `No sessions recorded in the last ${window} days. The GA4 tag may be missing or broken.`, zeroDays, lastDataDay: null };
  let trailing = 0;
  for (let i = series.length - 1; i >= 0 && series[i].n === 0; i--) trailing++;
  if (trailing >= 2) return { state: "warn", detail: `No sessions since ${lastData}. Check that the GA4 tag still fires on every page.`, zeroDays, lastDataDay: lastData };
  return { state: "ok", detail: `${total.toLocaleString("en-US")} sessions in the last ${window} days; data through ${lastData}.`, zeroDays, lastDataDay: lastData };
}

export type GscSite = { siteUrl: string; permissionLevel: string };

/** The Search Console property for a domain: the domain property first, then https, then http, with or without www. */
export function suggestGscProperty(sites: GscSite[], domain: string): string | null {
  const usable = sites.filter((s) => s.permissionLevel !== "siteUnverifiedUser");
  const order = [`sc-domain:${domain}`, `https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`, `http://www.${domain}/`];
  for (const o of order) if (usable.some((s) => s.siteUrl === o)) return o;
  return null;
}

export type Ga4Property = { property: string; displayName: string; account: string };

/** The GA4 property for a site: one whose name mentions the domain or the site's name, or the only one there is. */
export function suggestGa4Property(props: Ga4Property[], domain: string, siteName: string): string | null {
  const d = domain.toLowerCase(), n = siteName.toLowerCase();
  const hit = props.find((p) => p.displayName.toLowerCase().includes(d)) ?? props.find((p) => n && p.displayName.toLowerCase().includes(n));
  if (hit) return hit.property;
  return props.length === 1 ? props[0].property : null;
}
