/**
 * Keyword normalisation and near-duplicate detection (build prompt rules 5
 * and 6, groundwork). Pure functions, no I/O.
 *
 * Rule 6: "esthetician salary california / texas / ohio" is ONE article that
 * handles the states inside it, never forty near-identical pages. Variants
 * that differ only by a place, word order, plurals or filler words share a
 * variant key and collapse into one target. Full topic selection (rule 5:
 * one page per head term across published and scheduled items) is Phase 3.
 */

export const INTENTS = ["informational", "navigational", "commercial", "transactional"] as const;
export type Intent = (typeof INTENTS)[number];

/** Provider intent labels → ours (DataForSEO: main_intent; OpenSEO: intent). */
export function normalizeIntent(raw: unknown): Intent | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return (INTENTS as readonly string[]).includes(v) ? (v as Intent) : null;
}

/**
 * Canonical form of a keyword: Unicode NFKC, lower case, typographic quotes
 * folded, apostrophes dropped ("women's" → "womens"), anything that is not a
 * letter, digit or one of & + # / . - becomes a space, whitespace collapsed.
 * Returns "" when nothing is left.
 */
export function normalizeKeyword(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`']/g, "")
    .replace(/[“”"]/g, " ")
    .replace(/[^\p{L}\p{N}\s&+#/.-]/gu, " ")
    .replace(/(^|\s)[.\-/]+|[.\-/]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
    .trim();
}

const STOPWORDS = new Set(["a", "an", "the", "for", "in", "of", "to", "and", "with", "on", "at", "by", "from", "your", "my", "vs", "versus", "or"]);

// Places. Multi-word names first so "new york city" wins over "new york".
const US_STATES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina",
  "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas",
  "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming", "district of columbia", "puerto rico",
];
// two-letter codes that are rarely anything else in a search query ("in", "me", "or", "hi", "ok", "co"… are left out on purpose)
const US_CODES = ["ny", "nyc", "ca", "tx", "fl", "nj", "nc", "sc", "az", "nv", "ut", "nm", "ks", "ky", "tn", "va", "wv", "wi", "mn", "ia", "nd", "sd", "mt", "wy", "vt", "nh", "ri", "ct", "md", "dc", "ak", "il", "ga", "wa", "usa"];
const COUNTRIES = [
  "united states", "united kingdom", "uk", "canada", "australia", "new zealand", "ireland", "england", "scotland", "wales", "india",
  "germany", "france", "spain", "mexico", "south africa", "singapore", "philippines",
];
const CITIES = [
  "new york city", "los angeles", "chicago", "houston", "phoenix", "philadelphia", "san antonio", "san diego", "dallas", "austin",
  "jacksonville", "san jose", "fort worth", "columbus", "charlotte", "indianapolis", "san francisco", "seattle", "denver", "nashville",
  "oklahoma city", "el paso", "boston", "portland", "las vegas", "detroit", "memphis", "louisville", "baltimore", "milwaukee",
  "albuquerque", "tucson", "fresno", "sacramento", "atlanta", "miami", "orlando", "tampa", "minneapolis", "cleveland", "pittsburgh",
  "st louis", "saint louis", "raleigh", "salt lake city", "honolulu", "brooklyn", "manhattan", "london", "manchester", "birmingham",
  "toronto", "vancouver", "montreal", "sydney", "melbourne", "dublin",
];
// local-intent modifiers produce the same doorway pattern as place names
const LOCAL_MODIFIERS = ["near me", "nearby", "close to me", "in my area", "local"];

const GEO_PHRASES = [...new Set([...CITIES, ...US_STATES, ...COUNTRIES, ...LOCAL_MODIFIERS, ...US_CODES])].sort((a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length);

/** Place names and local modifiers found in a (normalised) keyword, in order of appearance. */
export function geoTerms(keyword: string): string[] {
  let rest = ` ${normalizeKeyword(keyword)} `;
  const found: { term: string; at: number }[] = [];
  for (const g of GEO_PHRASES) {
    const needle = ` ${g} `;
    let i = rest.indexOf(needle);
    while (i !== -1) {
      found.push({ term: g, at: i });
      rest = rest.slice(0, i) + " ".repeat(needle.length - 1) + rest.slice(i + needle.length - 1);
      i = rest.indexOf(needle);
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.term);
}

/** Crude English stemmer for plurals only: "salons" → "salon", "policies" → "policy", "boxes" → "box". */
export function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 4 && /(ss|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss") && !token.endsWith("us") && !token.endsWith("is")) return token.slice(0, -1);
  return token;
}

function stripGeo(normalized: string): string {
  let s = ` ${normalized} `;
  for (const g of GEO_PHRASES) s = s.split(` ${g} `).join(" ");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The near-duplicate key: places and local modifiers removed, filler words
 * removed, plurals folded, words sorted. "Esthetician salary in Texas",
 * "esthetician salaries california" and "salary esthetician" all give
 * "esthetician salary".
 */
export function variantKey(keyword: string): string {
  const n = normalizeKeyword(keyword);
  const tokens = stripGeo(n)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t))
    .map(stem);
  if (!tokens.length) return n;
  return [...new Set(tokens)].sort().join(" ");
}

export type VariantGroup<T> = {
  key: string;
  /** The one keyword the group targets. */
  target: T;
  /** Every member, target included. */
  members: T[];
  /** Places the target article should handle inside it (rule 6). */
  places: string[];
};

/**
 * Collapses near-duplicate and geographic variants into one target each
 * (rule 6). The target is a member without a place if there is one, then the
 * highest search volume, then the shortest keyword. Groups come back ordered
 * by their target's volume, highest first; input order breaks ties.
 */
export function collapseVariants<T extends { keyword: string; volume?: number | null }>(rows: T[]): VariantGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = variantKey(r.keyword);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: VariantGroup<T>[] = [];
  for (const [key, members] of groups) {
    const ranked = [...members].sort((a, b) => {
      const ga = geoTerms(a.keyword).length ? 1 : 0, gb = geoTerms(b.keyword).length ? 1 : 0;
      if (ga !== gb) return ga - gb;
      const va = a.volume ?? -1, vb = b.volume ?? -1;
      if (va !== vb) return vb - va;
      return a.keyword.length - b.keyword.length || a.keyword.localeCompare(b.keyword);
    });
    const places = [...new Set(members.flatMap((m) => geoTerms(m.keyword)))];
    out.push({ key, target: ranked[0], members, places });
  }
  return out.sort((a, b) => (b.target.volume ?? -1) - (a.target.volume ?? -1));
}
