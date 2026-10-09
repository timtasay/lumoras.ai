/** "just now", "5 min ago", "3 h ago", "Yesterday", "12 Oct" (UTC dates, English). */
export function relativeTime(d: Date, now = new Date()): string {
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 2 * 86_400) return "Yesterday";
  return dateLabel(d);
}

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
export const dateLabel = (d: Date) => fmt.format(d);
export const dateTimeLabel = (d: Date) => `${fmtTime.format(d)} UTC`;
