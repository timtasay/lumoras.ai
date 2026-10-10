/**
 * Input validation for every form and action (zod 4). Server actions parse
 * FormData through these schemas; the database CHECK constraints repeat the
 * hard limits as a second line.
 */
import * as z from "zod";
import { WORKSPACE_ROLES } from "./auth/permissions.ts";
import { formatAuthorKeys, parseAuthorKeys } from "./publishers/author-keys.ts";

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

/**
 * A byline (rule 10): a real person, or the client's organization ("Lumoras
 * team", owner decision of 10 October 2026). An organization has no personal
 * title or credentials, so a role is refused for it rather than dropped
 * silently. Published as schema.org Person or Organization.
 */
export const AUTHOR_KINDS = ["person", "organization"] as const;
export const authorInput = z
  .object({
    kind: z.enum(AUTHOR_KINDS, { error: "Choose a person or an organization" }).default("person"),
    name: trimmed(120, "Name").min(1, "Enter the byline's name"),
    role: trimmed(120, "Role").default(""),
    bio: trimmed(2000, "Bio").default(""),
    avatarUrl: z
      .string()
      .trim()
      .default("")
      .transform((s) => s || null)
      .pipe(httpsUrl.nullable()),
  })
  .refine((a) => a.kind === "person" || a.role === "", {
    message: "An organization byline has no job title or credentials. Leave the role empty, or add the person who signs as a person byline.",
    path: ["role"],
  });
export type AuthorInput = z.infer<typeof authorInput>;

/** https, or http to a *.test host (local fakes in tests; the SSRF guard refuses .test outside tests). */
const endpointUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" || (u.protocol === "http:" && u.hostname.endsWith(".test"));
    } catch {
      return false;
    }
  }, "Use a full https:// address");

const livePath = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/[\w./{}-]*\{\{\s*slug\s*\}\}[\w./-]*$/, "A path with {{slug}} in it, like /blog/{{slug}}")
  .default("/blog/{{slug}}");

/** "Name = key" lines (the form) or the parsed record (presets, the seed). */
const authorKeys = z
  .union([z.string().max(5000), z.record(z.string(), z.string())])
  .default("")
  .transform((v, ctx) => {
    const r = parseAuthorKeys(typeof v === "string" ? v : formatAuthorKeys(v));
    if ("error" in r) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.keys;
  });

export const CONNECTION_KINDS = ["git", "wordpress", "webhook", "search_console", "ga4"] as const;
export const connectionInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("git"),
    label: trimmed(80, "Label").min(1),
    provider: z.enum(["github", "gitea"]).default("github"),
    repository: z.string().trim().regex(/^https:\/\/[^\s]+\/[^\s/]+\/[^\s/]+$/, "Use the repository's https:// address, like https://github.com/owner/site").max(500),
    /** Empty: derived (api.github.com, or <gitea>/api/v1). */
    apiBaseUrl: z.union([z.literal(""), endpointUrl]).default(""),
    /** The base branch: articles land here (mode commit) or pull requests target it (mode pr). Per connection. */
    branch: z.string().trim().regex(/^[\w./-]{1,100}$/, "Enter a branch name").refine((s) => !s.split("/").includes("..") && !s.startsWith("/") && !s.endsWith("/") && !s.endsWith(".lock"), "Enter a branch name").default("main"),
    contentDir: z.string().trim().regex(/^[\w./-]{0,200}$/, "A folder path inside the repository, like content/posts").refine((s) => !s.split("/").includes(".."), "No .. in the path").default("content/posts"),
    filenamePattern: z.string().trim().regex(/^[\w.{}\s-]{1,100}$/, "Like {{slug}}.md").refine((s) => /\{\{\s*slug\s*\}\}/.test(s), "Must contain {{slug}}").default("{{slug}}.md"),
    frontmatterTemplate: z.string().max(4000).default(""),
    mode: z.enum(["pr", "commit"]).default("pr"),
    livePath,
    /** "mdx" escapes the body so an MDX site compiles it as text. */
    bodyFormat: z.enum(["markdown", "mdx"]).default("markdown"),
    authorKeys,
    /** A file that must be on the base branch before anything publishes (the site's format is in place). */
    requiredPath: z.string().trim().regex(/^[\w./-]{0,300}$/, "A file path inside the repository, like src/content/post-schema.ts").refine((s) => !s.split("/").includes("..") && !s.startsWith("/"), "A path inside the repository").default(""),
    /** Optional at first: without one the connection shows "token needed" and nothing publishes until it is added. */
    secret: z
      .string()
      .trim()
      .max(4000)
      .default("")
      .refine((s) => s === "" || s.length >= 8, "Paste the whole access token"),
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
    endpoint: endpointUrl,
    livePath,
    secret: z.string().trim().min(16, "Use a signing secret of at least 16 characters").max(4000),
  }),
]);
export type ConnectionInput = z.infer<typeof connectionInput>;

/** A site's OpenSEO project (owner decision #3); empty clears it. No ':' (tracker ids are "<projectId>:<id>"). */
export const openSeoProjectInput = z.object({
  projectId: z
    .string()
    .trim()
    .max(100, "At most 100 characters")
    .regex(/^[A-Za-z0-9._-]*$/, "Letters, digits, '.', '_' or '-' only")
    .default("")
    .transform((s) => s || null),
});

/** Adding (or replacing) the access token of an existing connection. */
export const connectionTokenInput = z.object({ secret: z.string().trim().min(8, "Paste the whole access token").max(4000) });

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

/** Schedule and publishing rules (site settings, onboarding step 8). */
export const scheduleInput = z
  .object({
    days: z.preprocess((v) => ([] as unknown[]).concat(v ?? []), z.array(z.coerce.number().int().min(1).max(7)).min(1, "Pick at least one weekday").max(7)),
    time: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00"),
    active: flag.default(false),
    generationMode: z.enum(["rolling", "batch"]).default("rolling"),
    leadDays: z.coerce.number().int().min(0, "0 to 30 days").max(30, "0 to 30 days").default(3),
    batchSize: z.coerce.number().int().min(1).max(20).default(4),
    horizonDays: z.coerce.number().int().min(7).max(120).default(42),
    runwayThreshold: z.coerce.number().int().min(1, "1 to 120 days").max(120, "1 to 120 days").default(10),
    reviewMode: z.enum(["approval", "autopilot"]).default("approval"),
    autopilotAck: flag.default(false),
    allowBackdating: flag.default(false),
    backdatingAck: flag.default(false),
  })
  .refine((s) => s.reviewMode !== "autopilot" || s.autopilotAck, { message: "Tick the box to confirm you understand what autopilot does", path: ["autopilotAck"] })
  .refine((s) => !s.allowBackdating || s.backdatingAck, { message: "Tick the box to confirm you understand back-dating", path: ["backdatingAck"] });
export type ScheduleInput = z.infer<typeof scheduleInput>;

/** Browsers submit textarea line breaks as CRLF; articles are stored with LF (diffs, lint and Git stay clean). */
const lf = (s: string) => s.replace(/\r\n?/g, "\n");

export const editInput = z.object({
  title: z.string().trim().min(1, "A title is required").max(300),
  description: z.string().max(600).transform((s) => lf(s).trim()),
  bodyMd: z.string().max(100_000).transform(lf),
  coverKind: z.string().trim().max(40).default(""),
  coverChips: z.string().max(400).default(""),
  note: z.string().trim().max(500).default(""),
});

/** Phase 4: a site's measurement cadences (site settings). */
export const measureSettingsInput = z.object({
  rankCadence: z.enum(["off", "daily", "weekly", "fortnightly", "monthly"]).default("weekly"),
  rankDevice: z.enum(["desktop", "mobile"]).default("desktop"),
  rankDepth: z.coerce.number().int().refine((n) => [10, 20, 30, 50, 100].includes(n), "Choose 10, 20, 30, 50 or 100").default(30),
  rankMaxKeywords: z.coerce.number().int().min(1, "1 to 1,000 keywords").max(1000, "1 to 1,000 keywords").default(100),
  auditCadence: z.enum(["off", "monthly", "quarterly"]).default("monthly"),
  auditMaxPages: z.coerce.number().int().min(10, "10 to 10,000 pages").max(10_000, "10 to 10,000 pages").default(200),
  backlinksCadence: z.enum(["off", "monthly", "quarterly"]).default("quarterly"),
  searchSync: flag.default(false),
  inspectDailyCap: z.coerce.number().int().min(0, "0 to 200 a day").max(200, "0 to 200 a day").default(20),
});
export type MeasureSettingsInput = z.infer<typeof measureSettingsInput>;
