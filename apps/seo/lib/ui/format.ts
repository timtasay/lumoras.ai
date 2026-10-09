/** Number formatting for metrics: grouped, compact past 10k, fixed decimals where asked. */
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export type NumberFormat = "int" | "compact" | "dec1" | "pct" | "usd";

export function formatNumber(v: number, f: NumberFormat = "int"): string {
  switch (f) {
    case "compact":
      return Math.abs(v) >= 10_000 ? compact.format(v) : nf0.format(v);
    case "dec1":
      return nf1.format(v);
    case "pct":
      return `${nf1.format(v)}%`;
    case "usd":
      return `$${v.toFixed(2)}`;
    default:
      return nf0.format(v);
  }
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const formatDay = (d: Date) => dateFmt.format(d);

/** UTC midnight of a YYYY-MM-DD string (demo data is date-only and timezone-free). */
export const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
