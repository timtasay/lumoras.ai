/**
 * Input validation for every form and action (zod 4). Server actions parse
 * FormData through these schemas; the database CHECK constraints repeat the
 * hard limits as a second line.
 */
import * as z from "zod";
import { WORKSPACE_ROLES } from "./auth/permissions.ts";

/** Names that only exist inside a network: refused as a site domain. */
const INTERNAL_TLDS = new Set(["localhost", "local", "internal", "intranet", "lan", "home", "corp", "arpa", "localdomain"]);

/**
 * "https://www.Example.com/about?x" → "example.com". Lowercases, converts
 * international names to punycode, strips scheme, port, path and "www.".
 * Returns null for anything that is not a public-looking host name.
 */
export function normalizeDomain(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 300 || /\s/.test(raw)) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!host.includes(".") || host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) return null;
  if (INTERNAL_TLDS.has(host.split(".").at(-1)!)) return null;
  if (host.length > 253 || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(host)) return null;
  return host;
}

export { slugify } from "./validation-client.ts";

const trimmed = (max: number, label: string) => z.string().trim().max(max, `${label} is at most ${max} characters`);

/** Newline-separated text → unique, trimmed, non-empty lines (bounded). */
export const lines = (maxItems: number, maxLen: number, label: string) =>
  z
    .string()
    .default("")
    .transform((s) => [...new Set(s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean))])
    .pipe(
      z
        .array(z.string().max(maxLen, `each ${label} line is at most ${maxLen} characters`))
        .max(maxItems, `at most ${maxItems} ${label} lines`),
    );

/** Comma- or newline-separated words. */
const words = (maxItems: number, label: string) =>
  z
    .string()
    .default("")
    .transform((s) => [...new Set(s.split(/[,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean))])
    .pipe(z.array(z.string().max(60)).max(maxItems, `at most ${maxItems} ${label}`));

export const domainField = z
  .string()
  .transform((s, ctx) => {
    const d = normalizeDomain(s);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Enter a public domain, like example.com" });
      return z.NEVER;
    }
    return d;
  });

const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((s) => {
    try {
      return new URL(s).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use a full https:// address");

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const workspaceInput = z.object({
  name: trimmed(80, "Name").min(1, "Give the workspace a name"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single dashes")
    .max(48),
});

export const siteInput = z.object({
  domain: domainField,
  name: trimmed(80, "Name").min(1, "Give the site a name"),
  industry: trimmed(80, "Industry").default(""),
  locale: z.string().trim().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "Use a locale like en-US").default("en-US"),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code").default("US"),
  serpLocation: trimmed(120, "Search location").default("United States"),
  timezone: z.string().trim().refine(isTimeZone, "Pick a time zone from the list").default("UTC"),
  // rule 4: how long a researched seed counts as fresh
  researchMaxAgeDays: z.coerce.number().int("Use whole days").min(1, "At least 1 day").max(730, "At most 730 days").default(90),
});
export type SiteInput = z.infer<typeof siteInput>;

/** Form checkboxes post "on"; stored JSON holds booleans. */
const flag = z.preprocess((v) => (v === "on" || v === "true" || v === true ? true : v === "" || v === "off" || v === "false" || v === false || v == null ? false : v), z.boolean());

/**
 * SEO and structure rules (rule 13: data, not code). The lint step
 * (lib/content/lint.ts) enforces every one of them. Fields added in Phase 3
 * have defaults, so profiles saved before then keep validating.
 */
export const seoRules = z
  .object({
    titleMax: z.coerce.number().int().min(30).max(120),
    descriptionMin: z.coerce.number().int().min(50).max(300),
    descriptionMax: z.coerce.number().int().min(50).max(320),
    bodyMinWords: z.coerce.number().int().min(100).max(10_000),
    bodyMaxWords: z.coerce.number().int().min(100).max(20_000),
    internalLinksMin: z.coerce.number().int().min(0).max(30),
    internalLinksMax: z.coerce.number().int().min(0).max(50),
    // Phase 3
    /** A direct answer of this many sentences before the first heading (0 turns the rule off). */
    introMinSentences: z.coerce.number().int().min(0).max(10).default(0),
    introMaxSentences: z.coerce.number().int().min(0).max(20).default(0),
    /** At least this many "##" sections. */
    minSections: z.coerce.number().int().min(0).max(30).default(2),
    /** The page's H1 is the title: no "#" heading in the body. */
    noH1InBody: flag.default(true),
    noEmDash: flag.default(false),
    noEmoji: flag.default(false),
    /** Allowed cover-art kinds (empty: any), how many chips, and their maximum length. */
    coverKinds: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    coverChips: z.coerce.number().int().min(0).max(6).default(0),
    coverChipMax: z.coerce.number().int().min(4).max(80).default(22),
  })
  .refine((r) => r.descriptionMin <= r.descriptionMax, { message: "Description minimum is above the maximum", path: ["descriptionMin"] })
  .refine((r) => r.bodyMinWords <= r.bodyMaxWords, { message: "Body minimum is above the maximum", path: ["bodyMinWords"] })
  .refine((r) => r.internalLinksMin <= r.internalLinksMax, { message: "Internal-link minimum is above the maximum", path: ["internalLinksMin"] })
  .refine((r) => r.introMinSentences <= r.introMaxSentences || r.introMaxSentences === 0, { message: "Direct-answer minimum is above the maximum", path: ["introMinSentences"] });
export type SeoRules = z.infer<typeof seoRules>;

export const DEFAULT_SEO_RULES: SeoRules = {
  titleMax: 60,
  descriptionMin: 140,
  descriptionMax: 155,
  bodyMinWords: 700,
  bodyMaxWords: 1100,
  internalLinksMin: 3,
  internalLinksMax: 6,
  introMinSentences: 0,
  introMaxSentences: 0,
  minSections: 2,
  noH1InBody: true,
  noEmDash: false,
  noEmoji: false,
  coverKinds: [],
  coverChips: 0,
  coverChipMax: 22,
};

/** Reads a stored seo_rules object (any age) into the current shape, defaults filled in. */
export function readSeoRules(stored: unknown): SeoRules {
  const r = seoRules.safeParse({ ...DEFAULT_SEO_RULES, ...(stored && typeof stored === "object" ? stored : {}) });
  return r.success ? r.data : DEFAULT_SEO_RULES;
}

export const keyPage = z.object({
  url: httpsUrl.or(z.string().trim().regex(/^https?:\/\//, "Use a full address").max(2048)),
  title: trimmed(300, "Title").default(""),
  description: trimmed(600, "Description").default(""),
});

export const brandInput = z.object({
  overview: trimmed(4000, "Overview").default(""),
  currentGoal: trimmed(2000, "Current goal").default(""),
  positioning: trimmed(2000, "Positioning").default(""),
  audience: trimmed(2000, "Audience").default(""),
  sells: lines(50, 300, "what we sell"),
  doesNotSell: lines(50, 300, "what we do not sell"),
  competitors: lines(30, 300, "competitor").transform((xs, ctx) => {
    const out: string[] = [];
    for (const x of xs) {
      const d = normalizeDomain(x);
      if (!d) ctx.addIssue({ code: "custom", message: `"${x}" is not a domain` });
      else if (!out.includes(d)) out.push(d);
    }
    return out;
  }),
  keyPages: z.array(keyPage).max(30, "At most 30 key pages").default([]),
  productFacts: lines(80, 500, "product fact"),
  forbiddenClaims: lines(80, 500, "forbidden claim"),
  voiceRules: lines(50, 500, "voice rule"),
  seoRules,
  bannedWords: words(200, "banned words"),
  exampleArticles: lines(20, 2048, "example article").pipe(z.array(httpsUrl)),
});
export type BrandInput = z.infer<typeof brandInput>;

export const authorInput = z.object({
  name: trimmed(120, "Name").min(1, "Enter the person's name"),
  role: trimmed(120, "Role").default(""),
  bio: trimmed(2000, "Bio").default(""),
  avatarUrl: z
    .string()
    .trim()
    .default("")
    .transform((s) => s || null)
    .pipe(httpsUrl.nullable()),
});
export type AuthorInput = z.infer<typeof authorInput>;

export const CONNECTION_KINDS = ["git", "wordpress", "webhook", "search_console", "ga4"] as const;
export const connectionInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("git"),
    label: trimmed(80, "Label").min(1),
    repository: z.string().trim().regex(/^https:\/\/[^\s]+$/, "Use the repository's https:// address").max(500),
    branch: z.string().trim().regex(/^[\w./-]{1,100}$/, "Enter a branch name").default("main"),
    secret: z.string().trim().min(8, "Paste an access token").max(4000),
  }),
  z.object({
    kind: z.literal("wordpress"),
    label: trimmed(80, "Label").min(1),
    siteUrl: httpsUrl,
    username: z.string().trim().min(1).max(200),
    secret: z.string().trim().min(8, "Paste an application password").max(4000),
  }),
  z.object({
    kind: z.literal("webhook"),
    label: trimmed(80, "Label").min(1),
    endpoint: httpsUrl,
    secret: z.string().trim().min(16, "Use a signing secret of at least 16 characters").max(4000),
  }),
]);
export type ConnectionInput = z.infer<typeof connectionInput>;

export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter an email address").max(254),
  role: z.enum(WORKSPACE_ROLES),
});

export const signInInput = z.object({ email: z.string().trim().toLowerCase().email("Enter an email address").max(254) });

/** Flattens zod issues into { field: message } for forms. */
export function fieldErrors(e: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of e.issues) {
    const k = i.path.join(".") || "_";
    out[k] ??= i.message;
  }
  return out;
}
