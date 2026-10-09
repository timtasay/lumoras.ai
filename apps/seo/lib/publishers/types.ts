/**
 * The Publisher interface (section 8): one implementation per way an article
 * reaches a client's site. Phase 3 ships Git file-per-post (GitHub, Gitea)
 * and the signed webhook; WordPress is Phase 5. Every publisher:
 *
 *   validate()  checks the configuration and credentials against the real
 *               endpoint without changing anything (the "Test" button);
 *   publish()   puts a new article out (a PR, a commit, a webhook delivery);
 *   update()    replaces a published article (refreshes);
 *   unpublish() takes it down;
 *   status()    reads where a publication stands (PR open / merged / closed).
 *
 * Publishers receive the article as data and the decrypted credential from
 * the caller (lib/publishers/registry.ts), never from the database or a
 * model, and talk to the outside only through the SSRF guard.
 */

export type ArticleCover = { kind: string; chips: string[] };

/** Everything a publisher may put on the client's site. */
export type PublishableArticle = {
  id: string;
  slug: string;
  title: string;
  description: string;
  bodyMd: string;
  /** YYYY-MM-DD in the site's time zone (no back-dating unless the site allows it). */
  date: string;
  keyword: string;
  secondaryKeywords: string[];
  tags: string[];
  cluster: string;
  readingMinutes: number;
  words: number;
  cover: ArticleCover;
  author: { name: string; role: string } | null;
  /** Path on the client's site ("/insights/<slug>") and the full URL. */
  path: string;
  url: string;
  sources: { claim: string; url: string }[];
  version: number;
  updated: string;
};

export type PublicationRef = {
  remoteId: string | null;
  path: string | null;
  branch: string | null;
  prNumber: number | null;
  commitSha: string | null;
};

export type PublishResult = {
  status: "open" | "published" | "merged";
  mode: "pr" | "commit" | "webhook";
  remoteId: string | null;
  path?: string | null;
  branch?: string | null;
  commitSha?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  liveUrl: string;
  detail: string;
};

export type ValidationCheck = { label: string; ok: boolean; detail: string };
export type Validation = { ok: boolean; detail: string; checks: ValidationCheck[] };

export type PublicationStatus = { status: "open" | "merged" | "closed" | "published" | "unpublished"; detail: string };

export interface Publisher {
  readonly kind: "github" | "gitea" | "webhook";
  validate(): Promise<Validation>;
  publish(a: PublishableArticle): Promise<PublishResult>;
  update(a: PublishableArticle, prev: PublicationRef): Promise<PublishResult>;
  unpublish(a: PublishableArticle, prev: PublicationRef): Promise<PublishResult>;
  status(prev: PublicationRef): Promise<PublicationStatus>;
}

export class PublishError extends Error {
  constructor(
    message: string,
    public readonly opts: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "PublishError";
  }
}
