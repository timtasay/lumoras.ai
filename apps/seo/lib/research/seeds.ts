/**
 * Rule 4: never buy the same research twice. A seed already in the research
 * log is not re-run until its data is older than the site's maximum age
 * (default 90 days); the backlog rotates so never-researched and
 * highest-priority seeds come first, then the stalest. Pure functions.
 */
export const DEFAULT_RESEARCH_MAX_AGE_DAYS = 90;
const DAY = 86_400_000;

export type SeedDecision =
  | { run: true; reason: "never" | "stale"; lastAt: Date | null; ageDays: number | null }
  | { run: false; reason: "fresh"; lastAt: Date; ageDays: number; freshUntil: Date };

/** May this seed be researched (paid) now? `lastAt` is the newest ok/cached research of it for this site and market. */
export function seedDecision(lastAt: Date | null, maxAgeDays: number, now: Date): SeedDecision {
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1) throw new RangeError(`max age must be a positive whole number of days (got ${maxAgeDays})`);
  if (!lastAt) return { run: true, reason: "never", lastAt: null, ageDays: null };
  const ageDays = Math.floor((now.getTime() - lastAt.getTime()) / DAY);
  const freshUntil = new Date(lastAt.getTime() + maxAgeDays * DAY);
  if (now.getTime() < freshUntil.getTime()) return { run: false, reason: "fresh", lastAt, ageDays, freshUntil };
  return { run: true, reason: "stale", lastAt, ageDays };
}

export type BacklogSeed = { id: string; seed: string; priority: number; status: "queued" | "researched" | "skipped"; lastResearchedAt: Date | null; createdAt: Date };

/**
 * The next `n` seeds to research: skipped seeds never; researched seeds only
 * once their data is older than `maxAgeDays`. Order: never researched first
 * (higher priority, then oldest added), then the stalest.
 */
export function nextSeeds(backlog: BacklogSeed[], maxAgeDays: number, now: Date, n = 3): BacklogSeed[] {
  return backlog
    .filter((s) => s.status !== "skipped" && seedDecision(s.lastResearchedAt, maxAgeDays, now).run)
    .sort((a, b) => {
      const na = a.lastResearchedAt ? 1 : 0, nb = b.lastResearchedAt ? 1 : 0;
      if (na !== nb) return na - nb;
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.lastResearchedAt && b.lastResearchedAt && a.lastResearchedAt.getTime() !== b.lastResearchedAt.getTime()) {
        return a.lastResearchedAt.getTime() - b.lastResearchedAt.getTime();
      }
      return a.createdAt.getTime() - b.createdAt.getTime() || a.seed.localeCompare(b.seed);
    })
    .slice(0, Math.max(0, n));
}
