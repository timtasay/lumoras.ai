/**
 * Fixtures for the FakeProvider. SYNTHETIC: no real provider call was made to
 * produce them (the build environment has no provider keys and must not
 * spend). They are shaped like DataForSEO Labs / SERP / Backlinks responses
 * after normalisation, with plausible but invented numbers, so screens, tests
 * and local development behave realistically for the seeded sites. Every
 * screen that shows them carries a "Demo data" badge. Competitor domains are
 * reserved .example names on purpose: no real company is given invented
 * rankings. Replace with recorded responses (scrubbed) once a key exists.
 */
import type { DomainOverview, KeywordRow } from "./types.ts";

type Row = [keyword: string, volume: number, kd: number, cpcCents: number, competition: number, intent: KeywordRow["intent"]];

const rows = (list: Row[]): KeywordRow[] =>
  list.map(([keyword, volume, kd, cpcCents, competition, intent]) => ({ keyword, volume, kd, cpcMicros: cpcCents * 10_000, competition, intent }));

/** Keyword ideas per normalised seed. Any other seed gets generated rows (fake.ts). */
export const KEYWORD_IDEAS: Record<string, KeywordRow[]> = {
  "salon pos": rows([
    ["salon pos", 1900, 38, 1240, 0.62, "commercial"],
    ["salon pos system", 1300, 41, 1510, 0.71, "commercial"],
    ["best salon pos system", 590, 44, 1680, 0.66, "commercial"],
    ["salon point of sale", 480, 36, 1190, 0.58, "commercial"],
    ["salon pos software", 390, 40, 1420, 0.69, "commercial"],
    ["pos for hair salons", 320, 33, 1350, 0.6, "commercial"],
    ["salon pos systems", 260, 39, 1460, 0.7, "commercial"],
    ["barbershop pos", 210, 28, 980, 0.52, "commercial"],
    ["nail salon pos", 170, 26, 1010, 0.49, "commercial"],
    ["salon checkout software", 90, 22, 1120, 0.44, "commercial"],
    ["free salon pos", 140, 31, 740, 0.38, "transactional"],
    ["salon pos with tip splitting", 30, 12, 0, 0.21, "commercial"],
    ["restaurant pos system", 6600, 62, 1980, 0.81, "commercial"],
    ["dental practice pos", 70, 24, 1310, 0.4, "commercial"],
  ]),
  "salon booking software": rows([
    ["salon booking software", 1600, 45, 1180, 0.68, "commercial"],
    ["salon booking app", 880, 42, 960, 0.63, "commercial"],
    ["online booking for salons", 390, 37, 1050, 0.57, "commercial"],
    ["salon appointment software", 720, 43, 1240, 0.66, "commercial"],
    ["salon scheduling software", 590, 40, 1190, 0.64, "commercial"],
    ["free salon booking software", 260, 34, 610, 0.41, "transactional"],
    ["salon booking system", 480, 39, 1090, 0.6, "commercial"],
    ["hair salon booking app", 320, 35, 870, 0.55, "commercial"],
    ["spa booking software", 390, 38, 1130, 0.61, "commercial"],
    ["salon waitlist app", 70, 18, 640, 0.33, "commercial"],
  ]),
  "no show policy": rows([
    ["no show policy", 2400, 29, 310, 0.18, "informational"],
    ["salon no show policy", 590, 21, 240, 0.12, "informational"],
    ["no show policy template", 720, 24, 280, 0.15, "informational"],
    ["salon cancellation policy", 880, 23, 260, 0.14, "informational"],
    ["no show fee", 1000, 27, 340, 0.2, "informational"],
    ["how to charge a no show fee", 210, 19, 290, 0.11, "informational"],
    ["salon deposit policy", 170, 17, 230, 0.1, "informational"],
    ["no show policy examples", 260, 22, 250, 0.13, "informational"],
    ["dental no show policy", 390, 28, 520, 0.24, "informational"],
  ]),
  "esthetician salary": rows([
    ["esthetician salary", 14800, 31, 180, 0.06, "informational"],
    ["esthetician salary california", 1300, 22, 150, 0.04, "informational"],
    ["esthetician salary texas", 1000, 20, 140, 0.04, "informational"],
    ["esthetician salary ohio", 390, 14, 120, 0.03, "informational"],
    ["esthetician salary in florida", 880, 19, 130, 0.03, "informational"],
    ["esthetician salary new york", 720, 21, 160, 0.04, "informational"],
    ["how much do estheticians make", 6600, 30, 170, 0.05, "informational"],
    ["medical esthetician salary", 2900, 27, 210, 0.07, "informational"],
    ["esthetician salaries", 590, 30, 180, 0.06, "informational"],
    ["esthetician salary per hour", 1600, 25, 160, 0.05, "informational"],
  ]),
  "ai receptionist": rows([
    ["ai receptionist", 8100, 52, 2840, 0.74, "commercial"],
    ["ai receptionist for small business", 1300, 41, 3120, 0.72, "commercial"],
    ["virtual receptionist ai", 880, 47, 2650, 0.7, "commercial"],
    ["ai phone answering service", 1000, 49, 2990, 0.76, "commercial"],
    ["ai receptionist cost", 390, 33, 2210, 0.61, "commercial"],
    ["ai receptionist vs answering service", 170, 24, 1980, 0.48, "informational"],
    ["what is an ai receptionist", 720, 29, 1450, 0.39, "informational"],
    ["ai receptionist for salons", 140, 18, 2310, 0.52, "commercial"],
    ["ai receptionist for restaurants", 110, 17, 2190, 0.5, "commercial"],
    ["ai receptionist near me", 90, 15, 2400, 0.55, "commercial"],
    ["ai receptionist for dental office", 260, 30, 3360, 0.71, "commercial"],
  ]),
  "missed calls": rows([
    ["missed calls", 2900, 26, 410, 0.21, "informational"],
    ["cost of missed calls for small business", 140, 15, 1120, 0.33, "informational"],
    ["missed call text back", 590, 30, 1840, 0.58, "commercial"],
    ["how to reduce missed calls", 110, 12, 930, 0.29, "informational"],
    ["missed call statistics", 210, 22, 680, 0.18, "informational"],
    ["missed calls lost revenue", 70, 11, 1050, 0.27, "informational"],
  ]),
  "restaurant reservation system": rows([
    ["restaurant reservation system", 2400, 48, 2140, 0.77, "commercial"],
    ["restaurant reservation software", 1300, 46, 2320, 0.79, "commercial"],
    ["free restaurant reservation system", 480, 37, 1240, 0.52, "transactional"],
    ["restaurant booking system", 720, 44, 1980, 0.73, "commercial"],
    ["table reservation app", 390, 35, 1560, 0.6, "commercial"],
    ["restaurant waitlist app", 590, 33, 1410, 0.58, "commercial"],
    ["phone reservations restaurant", 140, 19, 1120, 0.41, "commercial"],
  ]),
  "dental implants": rows([
    ["dental implants", 74000, 71, 1510, 0.86, "commercial"],
    ["dental implants cost", 40500, 64, 1780, 0.81, "commercial"],
    ["dental implants near me", 33100, 58, 2240, 0.88, "transactional"],
    ["dental implants seattle", 880, 42, 2690, 0.84, "transactional"],
    ["full mouth dental implants", 9900, 56, 1920, 0.83, "commercial"],
  ]),
};

/** Domain overview per domain (synthetic). */
export const DOMAIN_OVERVIEW: Record<string, DomainOverview> = {
  "sonorch.ai": { organicTraffic: 1840, organicKeywords: 612, top3: 24, top10: 118, trafficValueMicros: 3_120_000_000 },
  "seasonx.ai": { organicTraffic: 960, organicKeywords: 344, top3: 11, top10: 63, trafficValueMicros: 1_480_000_000 },
  "lumoras.ai": { organicTraffic: 420, organicKeywords: 187, top3: 6, top10: 29, trafficValueMicros: 910_000_000 },
  "northwind-dental.example": { organicTraffic: 0, organicKeywords: 0, top3: 0, top10: 0, trafficValueMicros: 0 },
};

/** SERP competitor domains: reserved .example names, never real companies. */
export const SERP_DOMAINS = [
  "booking-suite.example", "salon-software-review.example", "pos-compare.example", "smallbiz-guide.example", "beauty-trade-mag.example",
  "appointments-hub.example", "frontdesk-tools.example", "industry-forum.example", "software-directory.example", "how-to-run-a-salon.example",
];
