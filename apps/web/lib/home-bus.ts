/**
 * Tiny shared state for the homepage: the section observer, daypart picker and
 * vertical cards write here; the (lazily loaded) particle field reads it on boot
 * and subscribes to changes.
 */
export type HomeState = {
  /**
   * Particle formation 0..8: 0 sphere (hero), 1 waveform (platform), 2 receipt
   * (POS + voice), 3 speaker rings (retail sound), 4 constellation (verticals),
   * 5 orbits (product family), 6 globe (enterprise), 7 stream (how it works),
   * 8 sphere (closing CTA and footer).
   */
  form: number;
  /** daypart 0..3 (open, midday, rush, close) */
  dp: number;
  /** highlighted vertical card / cluster, -1 for none */
  hl: number;
};

export const homeState: HomeState = { form: 0, dp: 2, hl: -1 };

let bus: EventTarget | null = null;
function getBus(): EventTarget | null {
  if (typeof window === "undefined") return null;
  if (!bus) bus = new EventTarget();
  return bus;
}

export function setHome(patch: Partial<HomeState>) {
  let changed = false;
  for (const k of Object.keys(patch) as (keyof HomeState)[]) {
    const v = patch[k];
    if (v !== undefined && homeState[k] !== v) {
      homeState[k] = v;
      changed = true;
    }
  }
  if (changed) getBus()?.dispatchEvent(new Event("change"));
}

export function onHome(fn: () => void): () => void {
  const b = getBus();
  if (!b) return () => {};
  b.addEventListener("change", fn);
  return () => b.removeEventListener("change", fn);
}
