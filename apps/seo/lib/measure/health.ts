/**
 * GA4 measurement health (section 9: "a broken tag reads exactly like zero
 * traffic"). Pure: given what the daily GA4 sync read, say whether the
 * numbers can be trusted, and why not.
 *
 * Signals, worst first:
 *   no_data          no sessions at all in the window: the tag is missing or broken (error)
 *   no_web_stream    the property has no web data stream (error)
 *   stopped          sessions stopped for the last two or more days after earlier traffic (error at 3+, warn at 2)
 *   sharp_drop       the last three days average under a quarter of the days before (warn)
 *   gsc_mismatch     Search Console counts many more clicks than GA4 counts organic sessions (warn):
 *                    the tag is missing on some pages, blocked by consent, or traffic is misattributed
 *   stream_domain    no web stream points at the site's domain (warn): the tag may belong to another site
 *   not_set_landing  a large share of organic sessions has landing page "(not set)" (warn): the page_view
 *                    event is missing or fires late
 *   no_key_events    no key events are defined (info): conversions cannot be measured
 */
import type { Health } from "../google/analysis.ts";

export type HealthLevel = "ok" | "info" | "warn" | "error";
export type HealthSignal = { code: string; level: Exclude<HealthLevel, "ok">; text: string };
export type MeasurementHealth = {
  state: "ok" | "warn" | "error";
  headline: string;
  signals: HealthSignal[];
  lastDataDay: string | null;
  zeroDays: number;
  window: { start: string; end: string };
  checkedAt: string;
};

export type HealthInput = {
  /** Calendar days, oldest first, with sessions on every channel and organic sessions; missing days count as zero. */
  days: { day: string; sessions: number; organic: number }[];
  /** Search Console clicks on the same days, when Search Console is connected. */
  gscClicks: number | null;
  streams: { type: string; defaultUri: string | null }[] | null;
  keyEvents: number | null;
  /** Organic sessions whose landing page is "(not set)", over the window. */
  notSetSessions: number;
  domain: string;
  checkedAt: Date;
};

const host = (u: string | null) => {
  if (!u) return "";
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export function assessHealth(i: HealthInput): MeasurementHealth {
  const signals: HealthSignal[] = [];
  const days = i.days;
  const total = days.reduce((s, d) => s + d.sessions, 0);
  const organic = days.reduce((s, d) => s + d.organic, 0);
  const lastData = [...days].reverse().find((d) => d.sessions > 0)?.day ?? null;
  const zeroDays = days.filter((d) => d.sessions === 0).length;
  let trailing = 0;
  for (let k = days.length - 1; k >= 0 && days[k].sessions === 0; k--) trailing++;
  const n = days.length;

  if (total === 0) {
    signals.push({ code: "no_data", level: "error", text: `GA4 recorded no sessions at all in the last ${n} days. A missing or broken tag reads exactly like zero traffic: check that the GA4 tag is on every page.` });
  } else if (trailing >= 2) {
    signals.push({ code: "stopped", level: trailing >= 3 ? "error" : "warn", text: `No sessions since ${lastData}. If the site still gets visits, the GA4 tag stopped firing.` });
  } else if (n >= 7) {
    const last3 = days.slice(-3).reduce((s, d) => s + d.sessions, 0) / 3;
    const before = days.slice(0, -3);
    const avg = before.reduce((s, d) => s + d.sessions, 0) / Math.max(1, before.length);
    if (avg >= 10 && last3 < avg * 0.25) signals.push({ code: "sharp_drop", level: "warn", text: `Sessions fell to ${Math.round(last3)} a day from about ${Math.round(avg)}. Check the tag before reading this as a traffic drop.` });
  }
  if (i.streams && !i.streams.some((s) => s.type === "WEB_DATA_STREAM")) {
    signals.push({ code: "no_web_stream", level: "error", text: "This GA4 property has no web data stream, so it cannot measure the website." });
  } else if (i.streams && i.domain) {
    const hosts = i.streams.filter((s) => s.type === "WEB_DATA_STREAM").map((s) => host(s.defaultUri));
    const d = i.domain.replace(/^www\./, "");
    if (hosts.length && !hosts.some((h) => h === d || h.endsWith(`.${d}`))) {
      signals.push({ code: "stream_domain", level: "warn", text: `The property's web stream points at ${hosts.filter(Boolean).join(", ") || "another address"}, not ${d}. Check that this is the right property.` });
    }
  }
  if (i.gscClicks !== null && i.gscClicks >= 50 && total > 0 && organic < i.gscClicks * 0.3) {
    signals.push({ code: "gsc_mismatch", level: "warn", text: `Search Console counted ${i.gscClicks.toLocaleString("en-US")} clicks but GA4 only ${organic.toLocaleString("en-US")} organic sessions over the same days. The tag may be missing on some pages or blocked by consent.` });
  }
  if (organic >= 50 && i.notSetSessions / organic > 0.2) {
    signals.push({ code: "not_set_landing", level: "warn", text: `${Math.round((i.notSetSessions / organic) * 100)}% of organic sessions have no landing page ("(not set)"). The page_view event may be missing or firing late.` });
  }
  if (i.keyEvents === 0) signals.push({ code: "no_key_events", level: "info", text: "No key events are set up in GA4, so leads and sales from search cannot be counted." });

  const worst = signals.some((s) => s.level === "error") ? "error" : signals.some((s) => s.level === "warn") ? "warn" : "ok";
  const headline =
    worst === "error"
      ? "GA4 is not measuring this site: zero here does not mean zero traffic."
      : worst === "warn"
        ? "GA4 numbers may be incomplete: check the signals below."
        : `GA4 is reporting: ${total.toLocaleString("en-US")} sessions in the last ${n} days, data through ${lastData}.`;
  return { state: worst, headline, signals, lastDataDay: lastData, zeroDays, window: { start: days[0]?.day ?? "", end: days[n - 1]?.day ?? "" }, checkedAt: i.checkedAt.toISOString() };
}

/** The Phase 2 connection-test health, upgraded to the same shape (for screens that only have it). */
export function fromBasicHealth(h: Health, at: Date): MeasurementHealth {
  return {
    state: h.state,
    headline: h.state === "error" ? "GA4 is not measuring this site: zero here does not mean zero traffic." : h.detail,
    signals: h.state === "ok" ? [] : [{ code: h.state === "error" ? "no_data" : "stopped", level: h.state, text: h.detail }],
    lastDataDay: h.lastDataDay,
    zeroDays: h.zeroDays,
    window: { start: "", end: "" },
    checkedAt: at.toISOString(),
  };
}
