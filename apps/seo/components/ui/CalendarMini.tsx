import type { CSSProperties } from "react";
import { addDays, formatDay } from "@/lib/ui/format";
import { Icon } from "@/components/Icons";

export type CalItem = { date: string; title: string; status: "published" | "scheduled" | "generating" };
export type RunwayState = "ok" | "low" | "empty";

/** Days of scheduled content left → state. Below the threshold is amber; none is red. */
export function runwayState(days: number, threshold: number): RunwayState {
  if (days <= 0) return "empty";
  return days < threshold ? "low" : "ok";
}

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Content calendar, month mini. Under each week runs the runway band: the
 * days already covered by scheduled content (ion; amber once the runway is
 * below the site's threshold), then the days nothing is scheduled for (red,
 * hatched, so it reads without colour too). Dates are UTC calendar days.
 */
export function CalendarMini({
  year,
  month,
  today,
  items,
  runwayDays,
  threshold,
}: {
  year: number;
  /** 0-based month */
  month: number;
  today: Date;
  items: CalItem[];
  runwayDays: number;
  threshold: number;
}) {
  const first = new Date(Date.UTC(year, month, 1));
  const daysIn = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const start = addDays(first, -lead);
  const weeks = Math.ceil((lead + daysIn) / 7);
  const state = runwayState(runwayDays, threshold);
  const runEnd = addDays(today, runwayDays); // first day with nothing scheduled
  const byDay = new Map<string, CalItem[]>();
  for (const it of items) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);
  const monthName = first.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const kind = (d: Date): "covered" | "gap" | null => {
    if (d < today) return null;
    return d < runEnd ? "covered" : "gap";
  };

  const summary =
    state === "empty"
      ? `Runway empty: nothing is scheduled from ${formatDay(today)}.`
      : `Runway ${runwayDays} days, until ${formatDay(addDays(runEnd, -1))}${state === "low" ? `, below the ${threshold}-day threshold` : ""}.`;

  return (
    <div className="cal" data-runway={state}>
      <div className="cal-head">
        <p className="cal-month">{monthName}</p>
        <p className="cal-runway" data-runway={state}>
          <Icon name={state === "ok" ? "check" : "alert"} />
          {state === "empty" ? "Queue empty" : `${runwayDays} days of runway`}
        </p>
      </div>
      <table className="cal-grid">
        <caption className="sr-only">
          {monthName} content calendar. {summary}
        </caption>
        <thead>
          <tr>
            {WD.map((w) => (
              <th key={w} scope="col" abbr={w}>
                {w.slice(0, 1)}
                <span className="cal-wd-rest">{w.slice(1)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: weeks }, (_, w) => {
            const days = Array.from({ length: 7 }, (_, k) => addDays(start, w * 7 + k));
            // contiguous band segments for this week
            const segs: { kind: "covered" | "gap"; from: number; to: number }[] = [];
            days.forEach((d, k) => {
              const kd = d.getUTCMonth() === month ? kind(d) : null;
              const last = segs[segs.length - 1];
              if (!kd) return;
              if (last && last.kind === kd && last.to === k) last.to = k + 1;
              else segs.push({ kind: kd, from: k, to: k + 1 });
            });
            return [
              <tr key={`w${w}`} className="cal-week">
                {days.map((d) => {
                  const inMonth = d.getUTCMonth() === month;
                  const its = inMonth ? byDay.get(iso(d)) ?? [] : [];
                  const isToday = iso(d) === iso(today);
                  const label = `${formatDay(d)}${isToday ? ", today" : ""}${its.length ? `: ${its.map((i) => `${i.status} “${i.title}”`).join("; ")}` : ""}`;
                  return (
                    <td key={iso(d)} className="cal-day" data-out={inMonth ? undefined : ""} data-today={isToday ? "" : undefined}>
                      {inMonth ? (
                        <span className="cal-cell" title={its.map((i) => i.title).join("\n") || undefined}>
                          <span className="cal-n" aria-hidden="true">
                            {d.getUTCDate()}
                          </span>
                          <span className="cal-dots" aria-hidden="true">
                            {its.map((i, k) => (
                              <span key={k} className="cal-dot" data-status={i.status} />
                            ))}
                          </span>
                          <span className="sr-only">{label}</span>
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>,
              <tr key={`b${w}`} className="cal-band-row" aria-hidden="true">
                <td colSpan={7}>
                  <div className="cal-band">
                    {segs.map((s) => (
                      <span
                        key={s.from}
                        className="cal-seg"
                        data-kind={s.kind}
                        style={{ gridColumn: `${s.from + 1} / ${s.to + 1}` } as CSSProperties}
                      />
                    ))}
                  </div>
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <ul className="cal-legend">
        <li>
          <span className="cal-dot" data-status="published" aria-hidden="true" /> Published
        </li>
        <li>
          <span className="cal-dot" data-status="scheduled" aria-hidden="true" /> Scheduled
        </li>
        <li>
          <span className="cal-dot" data-status="generating" aria-hidden="true" /> Writing now
        </li>
        <li>
          <span className="cal-key" data-kind="gap" aria-hidden="true" /> Nothing scheduled
        </li>
      </ul>
      <p className="cal-summary">{summary}</p>
    </div>
  );
}
