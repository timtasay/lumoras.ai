"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { Icon } from "@/components/Icons";
import { Button, buttonClass } from "@/components/ui/Button";
import { Badge, type Tone } from "@/components/ui/Status";
import { useToast } from "@/components/ui/Toast";
import type { ActionState } from "@/lib/actions-state";
import { withViewTransition } from "@/lib/ui/motion";

export type CalendarEntry = {
  id: string;
  siteId: string;
  domain: string;
  date: string;
  time: string;
  status: string;
  statusLabel: string;
  tone: Tone;
  title: string;
  keyword: string | null;
  runId: string | null;
  written: boolean;
  blocked: string | null;
};

export type CalendarSite = {
  id: string;
  domain: string;
  today: string;
  allowBackdating: boolean;
  schedule: string;
  runway: { days: number; level: "ok" | "low" | "empty"; coveredUntil: string | null; gapAt: string | null; reason: string; threshold: number };
};

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(new Date(parse(d).getTime() + n * 86_400_000));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// formatted by hand, not Intl: the server's and the browser's ICU data can differ (a hydration mismatch)
const dayLabel = (d: string) => {
  const x = parse(d);
  return `${WD[(x.getUTCDay() + 6) % 7]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()].slice(0, 3)}`;
};
const MOVABLE = new Set(["planned", "generating", "failed", "awaiting_review", "changes_requested", "approved"]);

/**
 * The content calendar: month and list views. Articles move by drag and
 * drop, or from the keyboard (focus an article, press M, choose the day with
 * the arrow keys, Enter to drop, Escape to cancel), or with the "Move to" date
 * field. The runway band under each week shows the days already covered
 * (ion; amber below the site's threshold) and the days nothing will go out
 * (red, hatched, so it reads without colour too).
 */
export function ContentCalendar({
  slug,
  month,
  view,
  site,
  sites,
  entries,
  canSchedule,
  canRun,
  reschedule,
  runNow,
  skip,
}: {
  slug: string;
  month: string;
  view: "month" | "list";
  site: CalendarSite | null;
  sites: CalendarSite[];
  entries: CalendarEntry[];
  canSchedule: boolean;
  canRun: boolean;
  reschedule: (itemId: string, date: string) => Promise<ActionState>;
  runNow: (itemId: string) => Promise<ActionState>;
  skip: (itemId: string) => Promise<ActionState>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState(entries);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ id: string; target: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  const [busy, start] = useTransition();
  const chipRefs = useRef(new Map<string, HTMLDivElement>());
  // the dragged id, readable synchronously in dragover (state lags a render behind)
  const dragRef = useRef<string | null>(null);

  // keep in sync with the server after refreshes
  const key = entries.map((e) => `${e.id}:${e.date}:${e.status}`).join(",");
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setItems(entries);
  }

  const siteOf = (id: string) => sites.find((s) => s.id === id) ?? site;
  const today = site?.today ?? new Date().toISOString().slice(0, 10);
  const first = parse(`${month}-01`);
  const lead = (first.getUTCDay() + 6) % 7;
  const start0 = addDays(`${month}-01`, -lead);
  const daysIn = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const weeks = Math.ceil((lead + daysIn) / 7);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    for (const it of items) m.set(it.date, [...(m.get(it.date) ?? []), it]);
    return m;
  }, [items]);

  const droppable = (date: string, itemId: string | null) => {
    if (!canSchedule || !itemId) return false;
    const it = items.find((x) => x.id === itemId);
    if (!it) return false;
    const s = siteOf(it.siteId);
    return date >= (s?.today ?? today) || !!s?.allowBackdating;
  };

  const move = (itemId: string, date: string) => {
    const it = items.find((x) => x.id === itemId);
    if (!it || it.date === date) return;
    const before = items;
    withViewTransition(() => setItems((xs) => xs.map((x) => (x.id === itemId ? { ...x, date } : x))));
    setAnnounce(`Moving “${it.title || it.keyword || "the slot"}” to ${dayLabel(date)}…`);
    start(async () => {
      const r = await reschedule(itemId, date);
      if (r.ok) {
        toast.push({ tone: "ok", title: r.message ?? "Moved." });
        setAnnounce(`Moved to ${dayLabel(date)}.`);
        router.refresh();
      } else {
        setItems(before);
        toast.push({ tone: "danger", title: r.error ?? "Could not move it." });
        setAnnounce(`Not moved: ${r.error ?? "error"}`);
      }
    });
  };

  const onChipKey = (e: KeyboardEvent<HTMLDivElement>, it: CalendarEntry) => {
    // a div with role=button (Chromium does not start a drag from a <button>): Enter and Space select it
    if (!moving && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setSelected((x) => (x === it.id ? null : it.id));
      return;
    }
    if (!canSchedule || !MOVABLE.has(it.status)) return;
    if (!moving && (e.key === "m" || e.key === "M")) {
      e.preventDefault();
      setMoving({ id: it.id, target: it.date });
      setAnnounce(`Moving “${it.title || it.keyword || "the slot"}”. Arrow keys choose a day, Enter drops it there, Escape cancels. ${dayLabel(it.date)}.`);
      return;
    }
    if (!moving || moving.id !== it.id) return;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) {
      e.preventDefault();
      const t = addDays(moving.target, step[e.key]);
      setMoving({ id: it.id, target: t });
      setAnnounce(`${dayLabel(t)}${droppable(t, it.id) ? "" : ": not allowed (in the past)"}`);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const t = moving.target;
      setMoving(null);
      if (droppable(t, it.id)) move(it.id, t);
      else setAnnounce("That day is in the past: back-dating is off for this site.");
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMoving(null);
      setAnnounce("Move canceled.");
    }
  };

  const sel = items.find((x) => x.id === selected) ?? null;
  const rw = site?.runway;
  const coveredKind = (d: string): "covered" | "gap" | null => {
    if (!rw || d < today) return null;
    if (rw.coveredUntil && d <= rw.coveredUntil) return "covered";
    return "gap";
  };
  const monthName = `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}`;
  const shift = (n: number) => {
    const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const href = (o: { month?: string; view?: string; site?: string | null }) => {
    const p = new URLSearchParams();
    const s = o.site === undefined ? site?.id : o.site;
    if (s) p.set("site", s);
    p.set("view", o.view ?? view);
    p.set("month", o.month ?? month);
    return `/w/${slug}/content?${p.toString()}`;
  };

  const chip = (it: CalendarEntry, compact: boolean) => (
    <div
      key={it.id}
      role="button"
      tabIndex={0}
      ref={(el) => {
        if (el) chipRefs.current.set(it.id, el);
      }}
      className="cchip"
      data-status={it.status}
      data-selected={selected === it.id ? "" : undefined}
      data-moving={moving?.id === it.id ? "" : undefined}
      data-dragging={dragging === it.id ? "" : undefined}
      draggable={canSchedule && MOVABLE.has(it.status)}
      aria-pressed={selected === it.id}
      aria-describedby={canSchedule && MOVABLE.has(it.status) ? "cal-move-help" : undefined}
      style={{ viewTransitionName: `cchip-${it.id}` } as CSSProperties}
      onClick={() => setSelected((x) => (x === it.id ? null : it.id))}
      onKeyDown={(e) => onChipKey(e, it)}
      onDragStart={(e: DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData("text/plain", it.id);
        e.dataTransfer.effectAllowed = "move";
        dragRef.current = it.id;
        setDragging(it.id);
      }}
      onDragEnd={() => {
        dragRef.current = null;
        setDragging(null);
        setOver(null);
      }}
    >
      <span className="cchip-dot" aria-hidden="true" />
      <span className="cchip-text">
        <span className="cchip-title">{it.title || it.keyword || "Empty slot"}</span>
        {compact ? null : (
          <span className="cchip-meta">
            {it.time} · {it.statusLabel}
            {sites.length > 1 && !site ? ` · ${it.domain}` : ""}
          </span>
        )}
      </span>
      <span className="sr-only">
        , {it.statusLabel}, {it.time}
        {it.blocked ? `, ${it.blocked}` : ""}
      </span>
    </div>
  );

  return (
    <div className="ccal" data-runway={rw?.level ?? "ok"}>
      <div className="ccal-bar">
        <div className="ccal-nav">
          <Link className="icon-btn" href={href({ month: shift(-1) })} aria-label="Previous month" scroll={false}>
            <Icon name="back" />
          </Link>
          <h2 className="ccal-month">{monthName}</h2>
          <Link className="icon-btn" href={href({ month: shift(1) })} aria-label="Next month" scroll={false}>
            <Icon name="chev-r" />
          </Link>
        </div>
        <nav className="seg-links" aria-label="Calendar view">
          <Link href={href({ view: "month" })} aria-current={view === "month" ? "page" : undefined} scroll={false}>
            Month
          </Link>
          <Link href={href({ view: "list" })} aria-current={view === "list" ? "page" : undefined} scroll={false}>
            List
          </Link>
        </nav>
        {rw ? (
          <p className="cal-runway ccal-runway" data-runway={rw.level} title={rw.reason}>
            <Icon name={rw.level === "ok" ? "check" : "alert"} />
            {rw.level === "empty" ? "Queue empty" : `${rw.days} day${rw.days === 1 ? "" : "s"} of runway`}
            <span className="muted"> · threshold {rw.threshold}</span>
          </p>
        ) : null}
      </div>
      <nav className="ccal-sites" aria-label="Sites">
        {sites.map((s) => (
          <Link key={s.id} href={href({ site: s.id })} className="chip" aria-current={site?.id === s.id ? "page" : undefined} data-runway={s.runway.level} scroll={false}>
            <span className="chip-dot" aria-hidden="true" />
            {s.domain}
            <span className="chip-n">{s.runway.level === "empty" ? "0 d" : `${s.runway.days} d`}</span>
          </Link>
        ))}
      </nav>
      {site ? <p className="ccal-sched small muted">{site.schedule}</p> : null}
      <p id="cal-move-help" className="sr-only">
        To move an article with the keyboard, press M, then the arrow keys to choose a day, Enter to drop it, or Escape to cancel.
      </p>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {view === "month" ? (
        <div className="ccal-frame">
          <table className="ccal-grid" aria-label={`${monthName}: drag articles to reschedule`}>
            <caption className="sr-only">
              {monthName} content calendar{site ? ` for ${site.domain}` : ""}. {rw ? rw.reason : ""}
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
                const days = Array.from({ length: 7 }, (_, k) => addDays(start0, w * 7 + k));
                const segs: { kind: "covered" | "gap"; from: number; to: number }[] = [];
                days.forEach((d, k) => {
                  const kd = d.startsWith(month) ? coveredKind(d) : null;
                  const last = segs[segs.length - 1];
                  if (!kd) return;
                  if (last && last.kind === kd && last.to === k) last.to = k + 1;
                  else segs.push({ kind: kd, from: k, to: k + 1 });
                });
                return [
                  <tr key={`w${w}`} className="ccal-week">
                    {days.map((d) => {
                      const inMonth = d.startsWith(month);
                      const its = inMonth ? byDay.get(d) ?? [] : [];
                      const target = moving?.target === d;
                      const allowed = droppable(d, dragging ?? moving?.id ?? null);
                      return (
                        <td
                          key={d}
                          className="ccal-day"
                          data-out={inMonth ? undefined : ""}
                          data-today={d === today ? "" : undefined}
                          data-past={d < today ? "" : undefined}
                          data-over={over === d && allowed ? "" : undefined}
                          data-target={target ? (allowed ? "ok" : "no") : undefined}
                          data-date={d}
                          onDragOver={(e) => {
                            const id = dragRef.current;
                            if (!id || !droppable(d, id)) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            if (over !== d) setOver(d);
                          }}
                          onDragLeave={() => setOver((o) => (o === d ? null : o))}
                          onDrop={(e) => {
                            e.preventDefault();
                            const id = e.dataTransfer.getData("text/plain") || dragRef.current;
                            dragRef.current = null;
                            setOver(null);
                            setDragging(null);
                            if (id && droppable(d, id)) move(id, d);
                          }}
                        >
                          {inMonth ? (
                            <div className="ccal-cell">
                              <span className="ccal-n" aria-hidden="true">
                                {Number(d.slice(8))}
                              </span>
                              <span className="sr-only">{dayLabel(d)}</span>
                              <div className="ccal-items">{its.map((it) => chip(it, false))}</div>
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>,
                  <tr key={`b${w}`} className="cal-band-row" aria-hidden="true">
                    <td colSpan={7}>
                      <div className="cal-band">
                        {segs.map((s) => (
                          <span key={s.from} className="cal-seg" data-kind={s.kind} style={{ gridColumn: `${s.from + 1} / ${s.to + 1}` } as CSSProperties} />
                        ))}
                      </div>
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="tbl-frame" role="region" aria-label="Scheduled articles" tabIndex={0}>
          <table className="tbl ccal-list">
            <caption className="sr-only">Scheduled articles, by date</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Article</th>
                <th scope="col">State</th>
                {canSchedule ? <th scope="col">Move to</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.length ? (
                [...items]
                  .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1))
                  .map((it) => (
                    <tr key={it.id}>
                      <td className="mono small nowrap">
                        {dayLabel(it.date)} · {it.time}
                      </td>
                      <td>
                        {it.written ? (
                          <Link className="tlink" href={`/w/${slug}/content/${it.id}`}>
                            {it.title || it.keyword}
                          </Link>
                        ) : (
                          <span className="muted">{it.keyword ?? "Empty slot: written a few days before"}</span>
                        )}
                        {sites.length > 1 && !site ? <span className="muted small"> · {it.domain}</span> : null}
                      </td>
                      <td>
                        <Badge tone={it.tone}>{it.statusLabel}</Badge>
                      </td>
                      {canSchedule ? (
                        <td>
                          {MOVABLE.has(it.status) ? (
                            <form
                              className="move-form"
                              onSubmit={(e) => {
                                e.preventDefault();
                                const v = String(new FormData(e.currentTarget).get("date") ?? "");
                                if (v) move(it.id, v);
                              }}
                            >
                              <label className="sr-only" htmlFor={`mv-${it.id}`}>
                                New date for {it.title || it.keyword || "this slot"}
                              </label>
                              <input id={`mv-${it.id}`} name="date" type="date" className="inp inp-sm" defaultValue={it.date} min={siteOf(it.siteId)?.allowBackdating ? undefined : siteOf(it.siteId)?.today} />
                              <Button type="submit" size="sm" variant="ghost" loading={busy}>
                                Move
                              </Button>
                            </form>
                          ) : (
                            <span className="muted small">Keeps its date</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))
              ) : (
                <tr>
                  <td colSpan={4} className="muted">
                    Nothing scheduled in this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view === "month" ? (
        <ul className="cal-legend">
          <li>
            <span className="cchip-key" data-status="published" aria-hidden="true" /> Published
          </li>
          <li>
            <span className="cchip-key" data-status="approved" aria-hidden="true" /> Scheduled
          </li>
          <li>
            <span className="cchip-key" data-status="awaiting_review" aria-hidden="true" /> Awaiting review
          </li>
          <li>
            <span className="cchip-key" data-status="generating" aria-hidden="true" /> Writing
          </li>
          <li>
            <span className="cchip-key" data-status="planned" aria-hidden="true" /> Empty slot
          </li>
          <li>
            <span className="cal-key" data-kind="covered" aria-hidden="true" /> Runway
          </li>
          <li>
            <span className="cal-key" data-kind="gap" aria-hidden="true" /> Nothing will go out
          </li>
        </ul>
      ) : null}
      {rw ? <p className="cal-summary">{rw.reason}</p> : null}

      {sel ? (
        <section className="slot-panel panel" aria-label="Selected article">
          <div className="slot-main">
            <p className="label">
              {sel.domain} · {dayLabel(sel.date)} · {sel.time}
            </p>
            <h3>{sel.title || sel.keyword || "Empty slot"}</h3>
            <p className="small muted">{sel.blocked ?? (sel.written ? "Written." : "Written automatically a few days before its slot (rolling).")}</p>
          </div>
          <div className="slot-acts">
            <Badge tone={sel.tone}>{sel.statusLabel}</Badge>
            {sel.written ? (
              <Link href={`/w/${slug}/content/${sel.id}`} className={buttonClass("primary", "sm")}>
                <span className="btn-label">
                  <Icon name="pen" /> Open the article
                </span>
              </Link>
            ) : null}
            {sel.runId ? (
              <Link href={`/w/${slug}/runs/${sel.runId}`} className={buttonClass("secondary", "sm")}>
                <span className="btn-label">
                  <Icon name="flow" /> Pipeline run
                </span>
              </Link>
            ) : null}
            {canRun && (sel.status === "planned" || sel.status === "failed") ? (
              <Button
                size="sm"
                variant={sel.written ? "ghost" : "primary"}
                icon="play"
                loading={busy}
                onClick={() =>
                  start(async () => {
                    const r = await runNow(sel.id);
                    toast.push(r.ok ? { tone: "ok", title: r.message ?? "Started." } : { tone: "danger", title: r.error ?? "Could not start." });
                    if (r.ok && r.data?.runId) router.push(`/w/${slug}/runs/${String(r.data.runId)}`);
                  })
                }
              >
                Run now
              </Button>
            ) : null}
            {canSchedule && sel.status === "planned" ? (
              <Button
                size="sm"
                variant="ghost"
                icon="skip"
                loading={busy}
                onClick={() =>
                  start(async () => {
                    const r = await skip(sel.id);
                    toast.push(r.ok ? { tone: "ok", title: r.message ?? "Skipped." } : { tone: "danger", title: r.error ?? "Could not skip." });
                    if (r.ok) {
                      setSelected(null);
                      router.refresh();
                    }
                  })
                }
              >
                Skip this slot
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
