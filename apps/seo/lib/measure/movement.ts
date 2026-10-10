/**
 * Rank movement (rule 12: "the dashboard shows whether it moved"), as pure
 * functions. Position 1 is best, so a smaller number is an improvement.
 *
 *   up       ranked both times and climbed (e.g. #14 → #9: +5)
 *   down     ranked both times and fell
 *   same     ranked both times, same position
 *   entered  not in the tracked depth before, ranking now
 *   lost     ranking before, not in the tracked depth now
 *   new      first check of this keyword (nothing to compare with)
 *   none     not ranking, before or now
 */
export type MovementKind = "up" | "down" | "same" | "entered" | "lost" | "new" | "none";
export type Movement = { kind: MovementKind; /** Places gained (positive) or lost (negative); null without two positions. */ delta: number | null };

/** `prev` undefined: no earlier check. null: checked, not ranking. */
export function movement(prev: number | null | undefined, cur: number | null): Movement {
  if (prev === undefined) return { kind: cur === null ? "none" : "new", delta: null };
  if (prev === null && cur === null) return { kind: "none", delta: null };
  if (prev === null) return { kind: "entered", delta: null };
  if (cur === null) return { kind: "lost", delta: null };
  const d = prev - cur;
  return { kind: d > 0 ? "up" : d < 0 ? "down" : "same", delta: d };
}

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  up: "Up",
  down: "Down",
  same: "No change",
  entered: "Entered",
  lost: "Dropped out",
  new: "First check",
  none: "Not ranking",
};

/** "+5", "−3", "0", or a word, for badges (with the words for screen readers built from it). */
export function movementText(m: Movement): string {
  if (m.delta === null) return MOVEMENT_LABEL[m.kind];
  if (m.delta === 0) return "0";
  return m.delta > 0 ? `+${m.delta}` : `−${Math.abs(m.delta)}`;
}

/** For screen readers: "up 5 places", "down 1 place". */
export function movementSpoken(m: Movement): string {
  if (m.delta === null || m.delta === 0) return MOVEMENT_LABEL[m.kind].toLowerCase();
  const n = Math.abs(m.delta);
  return `${m.delta > 0 ? "up" : "down"} ${n} place${n === 1 ? "" : "s"}`;
}

export type Snapshot = { keyword: string; position: number | null; captured_at: Date; run_id: string; url?: string | null; source?: string; cluster?: string; item_id?: string | null; serp_features?: string[] };

export type KeywordTrend = {
  keyword: string;
  source: string;
  cluster: string;
  itemId: string | null;
  url: string | null;
  serpFeatures: string[];
  current: number | null;
  previous: number | null | undefined;
  best: number | null;
  movement: Movement;
  checkedAt: Date;
  /** Oldest first, one per run this keyword was checked in. */
  history: { at: Date; position: number | null }[];
};

/** Per keyword: the latest two checks, movement, best position and history (snapshots in any order). */
export function keywordTrends(snaps: Snapshot[]): KeywordTrend[] {
  const by = new Map<string, Snapshot[]>();
  for (const s of snaps) by.set(s.keyword, [...(by.get(s.keyword) ?? []), s]);
  const out: KeywordTrend[] = [];
  for (const [keyword, list] of by) {
    const sorted = [...list].sort((a, b) => a.captured_at.getTime() - b.captured_at.getTime());
    const last = sorted[sorted.length - 1];
    const prev = sorted.length > 1 ? sorted[sorted.length - 2] : undefined;
    const ranked = sorted.map((s) => s.position).filter((p): p is number => p !== null);
    out.push({
      keyword,
      source: last.source ?? "saved",
      cluster: last.cluster ?? "",
      itemId: last.item_id ?? null,
      url: last.url ?? null,
      serpFeatures: last.serp_features ?? [],
      current: last.position,
      previous: prev ? prev.position : undefined,
      best: ranked.length ? Math.min(...ranked) : null,
      movement: movement(prev ? prev.position : undefined, last.position),
      checkedAt: last.captured_at,
      history: sorted.map((s) => ({ at: s.captured_at, position: s.position })),
    });
  }
  return out;
}

/** Biggest moves first (absolute places; entering or dropping out of the tracked depth counts like five places), then by current position. */
export function byMovement(a: KeywordTrend, b: KeywordTrend): number {
  const w = (t: KeywordTrend) => (t.movement.delta !== null ? Math.abs(t.movement.delta) * 10 : t.movement.kind === "entered" || t.movement.kind === "lost" ? 50 : 0);
  return w(b) - w(a) || (a.current ?? 999) - (b.current ?? 999) || a.keyword.localeCompare(b.keyword);
}

export function movementSummary(trends: KeywordTrend[]): Record<"up" | "down" | "same" | "entered" | "lost" | "ranking" | "top10" | "tracked", number> {
  const n = (k: MovementKind) => trends.filter((t) => t.movement.kind === k).length;
  return {
    up: n("up"),
    down: n("down"),
    same: n("same"),
    entered: n("entered"),
    lost: n("lost"),
    ranking: trends.filter((t) => t.current !== null).length,
    top10: trends.filter((t) => t.current !== null && t.current <= 10).length,
    tracked: trends.length,
  };
}

/**
 * Aligns keyword histories on a shared timeline (one point per run date) for
 * the rank chart: a keyword not checked in a run, or not ranking, is null
 * there (the line breaks).
 */
export function alignSeries(trends: KeywordTrend[], keywords: string[]): { dates: Date[]; series: { name: string; positions: (number | null)[] }[] } {
  const picked = keywords.map((k) => trends.find((t) => t.keyword === k)).filter((t): t is KeywordTrend => !!t);
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const days = [...new Set(picked.flatMap((t) => t.history.map((h) => dayKey(h.at))))].sort();
  return {
    dates: days.map((d) => new Date(`${d}T00:00:00Z`)),
    series: picked.map((t) => {
      const m = new Map(t.history.map((h) => [dayKey(h.at), h.position]));
      return { name: t.keyword, positions: days.map((d) => (m.has(d) ? m.get(d)! : null)) };
    }),
  };
}

/** A sensible bottom for the inverted rank axis: the worst position shown, rounded up to 10, 20, 30, 50 or 100. */
export function rankAxisMax(positions: (number | null)[]): number {
  const worst = Math.max(10, ...positions.filter((p): p is number => p !== null));
  return [10, 20, 30, 50, 100].find((m) => worst <= m) ?? 100;
}
