/**
 * A site's search market: DataForSEO country location codes
 * (docs.dataforseo.com, "locations": 2840 = United States) and the language
 * from the site's locale. City-level SERP locations (sites.serp_location) are
 * kept as the label; country-level codes drive Labs data, which is national.
 */
import type { Market } from "../providers/types.ts";

const LOCATION_CODES: Record<string, number> = {
  US: 2840, GB: 2826, CA: 2124, AU: 2036, IE: 2372, NZ: 2554, IN: 2356, DE: 2276, FR: 2250, ES: 2724,
  MX: 2484, ZA: 2710, SG: 2702, PH: 2608, NL: 2528, IT: 2380, SE: 2752, BR: 2076, AE: 2784,
};

/** Countries we can research. Others fall back to the United States, and say so. */
export const SUPPORTED_COUNTRIES = Object.keys(LOCATION_CODES);

export function marketFor(site: { country: string; locale: string; serp_location: string }): Market {
  const code = LOCATION_CODES[site.country] ?? LOCATION_CODES.US;
  const languageCode = (/^([a-z]{2,3})/.exec(site.locale)?.[1] ?? "en").toLowerCase();
  const label = LOCATION_CODES[site.country] ? site.serp_location || site.country : "United States (country not supported yet)";
  return { locationCode: code, languageCode, label };
}
