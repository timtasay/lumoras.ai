/**
 * Tiny shared state for the homepage: the chapter observer, daypart picker and
 * vertical tiles write here; the (lazily loaded) particle field reads it on boot
 * and subscribes to changes.
 */
export type HomeState = {
  /** formation index 0..8 (hero, voice, pos, sound, verticals, products, enterprise, how, cta) */
  form: number;
  /** daypart 0..3 */
  dp: number;
  /** highlighted vertical cluster, -1 for none */
  hl: number;
};

export const homeState: HomeState = { form: 0, dp: 0, hl: -1 };

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
