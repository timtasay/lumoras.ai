/**
 * Git file-per-post publishing for GitHub and Gitea (section 8.1).
 *
 * One Markdown file per article, at <contentDir>/<filenamePattern>, with the
 * site's frontmatter template. Mode "pr" (the default) puts the file on a
 * branch and opens a pull request for the site's owners to merge (their CI
 * builds it first); mode "commit" commits straight to the branch.
 *
 * APIs (docs read 9 October 2026, see docs/external-apis.md):
 *   GitHub REST API, version 2026-03-10 (X-GitHub-Api-Version):
 *     GET  /repos/{o}/{r}                       repository, default branch, push permission
 *     GET  /repos/{o}/{r}/git/ref/heads/{b}     branch head
 *     POST /repos/{o}/{r}/git/refs              create a branch
 *     GET|PUT|DELETE /repos/{o}/{r}/contents/{path}   read, create/update, delete a file
 *     POST /repos/{o}/{r}/pulls, GET /pulls/{n}, GET /pulls?head=
 *   Gitea API v1 (Gitea 28.1):
 *     GET  /api/v1/repos/{o}/{r}, GET /branches/{b}
 *     GET|POST|PUT|DELETE /api/v1/repos/{o}/{r}/contents/{path}  (new_branch creates the branch)
 *     POST /api/v1/repos/{o}/{r}/pulls, GET /pulls/{n}, GET /pulls?state=open
 *
 * Every call is idempotent on retry: a branch, file or pull request that a
 * previous attempt already created is found and reused, never duplicated.
 */
import { joinPath, renderFilename, renderPostFile, unknownPlaceholders, DEFAULT_TEMPLATE } from "./frontmatter.ts";
import { obj, remoteMessage, requestJson, str, type HttpDeps, type JsonResponse } from "./http.ts";
import { PublishError, type PublicationRef, type PublicationStatus, type PublishableArticle, type Publisher, type PublishResult, type Validation, type ValidationCheck } from "./types.ts";

export type GitProvider = "github" | "gitea";

export type GitConfig = {
  provider: GitProvider;
  /** https://github.com/owner/repo (or the Gitea equivalent). */
  repository: string;
  /** API root; derived from the repository when empty (GitHub: https://api.github.com; Gitea: <origin>/api/v1). */
  apiBaseUrl: string;
  /** The branch articles land on (the PR's base). */
  branch: string;
  contentDir: string;
  filenamePattern: string;
  frontmatterTemplate: string;
  mode: "pr" | "commit";
  /** The article's path on the live site, e.g. /insights/{{slug}}. */
  livePath: string;
};

export const GIT_DEFAULTS: Omit<GitConfig, "provider" | "repository" | "apiBaseUrl"> = {
  branch: "main",
  contentDir: "content/posts",
  filenamePattern: "{{slug}}.md",
  frontmatterTemplate: DEFAULT_TEMPLATE,
  mode: "pr",
  livePath: "/blog/{{slug}}",
};

export const GITHUB_API_VERSION = "2026-03-10";

/** owner and repo from https://host/owner/repo(.git) */
export function parseRepository(url: string): { origin: string; owner: string; repo: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new PublishError("The repository address is not a URL.");
  }
  const parts = u.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "").split("/");
  if (parts.length !== 2 || parts.some((p) => !/^[\w.-]+$/.test(p))) throw new PublishError("Use the repository's address, like https://github.com/owner/repo.");
  return { origin: u.origin, owner: parts[0], repo: parts[1] };
}

export function apiBaseFor(c: Pick<GitConfig, "provider" | "repository" | "apiBaseUrl">): string {
  if (c.apiBaseUrl) return c.apiBaseUrl.replace(/\/+$/, "");
  const { origin } = parseRepository(c.repository);
  if (c.provider === "github") return origin === "https://github.com" ? "https://api.github.com" : `${origin}/api/v3`;
  return `${origin}/api/v1`;
}

/** The pieces of a Git host's API we use, behind one shape for both providers. */
type Host = {
  repo(): Promise<{ defaultBranch: string; canPush: boolean | null }>;
  branchSha(branch: string): Promise<string | null>;
  file(path: string, ref: string): Promise<{ sha: string; content: string } | null>;
  /** Creates or updates a file on `branch`; `fromBranch` creates `branch` from it first if needed. */
  put(p: { path: string; content: string; message: string; branch: string; sha?: string | null; fromBranch?: string }): Promise<{ commitSha: string; fileSha: string }>;
  remove(p: { path: string; sha: string; message: string; branch: string; fromBranch?: string }): Promise<{ commitSha: string }>;
  openPr(p: { title: string; body: string; head: string; base: string }): Promise<{ number: number; url: string }>;
  findOpenPr(head: string, base: string): Promise<{ number: number; url: string } | null>;
  pr(n: number): Promise<{ state: "open" | "closed"; merged: boolean; url: string }>;
  listDir(path: string, ref: string): Promise<boolean>;
};

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string) => Buffer.from(s.replace(/\s/g, ""), "base64").toString("utf8");

function fail(r: JsonResponse, what: string): never {
  const m = remoteMessage(r);
  if (r.status === 401) throw new PublishError(`${what}: the access token was rejected (401). Check or replace it.`, { status: 401 });
  if (r.status === 403) throw new PublishError(`${what}: the token lacks permission (403)${m ? `: ${m}` : ""}.`, { status: 403 });
  if (r.status === 404) throw new PublishError(`${what}: not found (404). Check the repository, branch and the token's access.`, { status: 404 });
  throw new PublishError(`${what}: the Git host answered ${r.status}${m ? `: ${m}` : ""}.`, { status: r.status, retryable: r.status >= 500 || r.status === 429 });
}

function githubHost(api: string, owner: string, repo: string, token: string, deps: HttpDeps): Host {
  const h = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": GITHUB_API_VERSION };
  const base = `${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const call = (m: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) => requestJson(deps, m, `${base}${path}`, { headers: h, body });
  const prOf = (j: unknown) => ({ number: Number(obj(j).number), url: str(obj(j).html_url) });
  return {
    async repo() {
      const r = await call("GET", "");
      if (r.status !== 200) fail(r, "Reading the repository");
      const p = obj(obj(r.json).permissions);
      return { defaultBranch: str(obj(r.json).default_branch) || "main", canPush: "push" in p ? p.push === true : null };
    },
    async branchSha(branch) {
      const r = await call("GET", `/git/ref/heads/${enc(branch)}`);
      if (r.status === 404) return null;
      if (r.status !== 200) fail(r, `Reading branch ${branch}`);
      return str(obj(obj(r.json).object).sha) || null;
    },
    async file(path, ref) {
      const r = await call("GET", `/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`);
      if (r.status === 404) return null;
      if (r.status !== 200) fail(r, `Reading ${path}`);
      const j = obj(r.json);
      return { sha: str(j.sha), content: j.encoding === "base64" ? unb64(str(j.content)) : str(j.content) };
    },
    async put(p) {
      if (p.fromBranch && !(await this.branchSha(p.branch))) {
        const sha = await this.branchSha(p.fromBranch);
        if (!sha) throw new PublishError(`The base branch ${p.fromBranch} does not exist.`);
        const c = await call("POST", "/git/refs", { ref: `refs/heads/${p.branch}`, sha });
        if (c.status !== 201 && c.status !== 422) fail(c, `Creating branch ${p.branch}`);
      }
      const r = await call("PUT", `/contents/${enc(p.path)}`, { message: p.message, content: b64(p.content), branch: p.branch, ...(p.sha ? { sha: p.sha } : {}) });
      if (r.status !== 200 && r.status !== 201) fail(r, `Writing ${p.path}`);
      return { commitSha: str(obj(obj(r.json).commit).sha), fileSha: str(obj(obj(r.json).content).sha) };
    },
    async remove(p) {
      if (p.fromBranch && !(await this.branchSha(p.branch))) {
        const sha = await this.branchSha(p.fromBranch);
        if (!sha) throw new PublishError(`The base branch ${p.fromBranch} does not exist.`);
        const c = await call("POST", "/git/refs", { ref: `refs/heads/${p.branch}`, sha });
        if (c.status !== 201 && c.status !== 422) fail(c, `Creating branch ${p.branch}`);
      }
      const r = await call("DELETE", `/contents/${enc(p.path)}`, { message: p.message, sha: p.sha, branch: p.branch });
      if (r.status !== 200) fail(r, `Deleting ${p.path}`);
      return { commitSha: str(obj(obj(r.json).commit).sha) };
    },
    async openPr(p) {
      const r = await call("POST", "/pulls", p);
      if (r.status === 201) return prOf(r.json);
      if (r.status === 422) {
        const existing = await this.findOpenPr(p.head, p.base);
        if (existing) return existing;
      }
      fail(r, "Opening the pull request");
    },
    async findOpenPr(head, b) {
      const r = await call("GET", `/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(b)}`);
      if (r.status !== 200 || !Array.isArray(r.json)) return null;
      const first = r.json.find((x) => str(obj(obj(x).head).ref) === head);
      return first ? prOf(first) : null;
    },
    async pr(n) {
      const r = await call("GET", `/pulls/${n}`);
      if (r.status !== 200) fail(r, `Reading pull request #${n}`);
      const j = obj(r.json);
      return { state: j.state === "closed" ? "closed" : "open", merged: j.merged === true, url: str(j.html_url) };
    },
    async listDir(path, ref) {
      const r = await call("GET", `/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`);
      return r.status === 200 && Array.isArray(r.json);
    },
  };
}

function giteaHost(api: string, owner: string, repo: string, token: string, deps: HttpDeps): Host {
  const h = { authorization: `token ${token}` };
  const base = `${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const call = (m: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) => requestJson(deps, m, `${base}${path}`, { headers: h, body });
  const prOf = (j: unknown) => ({ number: Number(obj(j).number), url: str(obj(j).html_url) });
  const self: Host = {
    async repo() {
      const r = await call("GET", "");
      if (r.status !== 200) fail(r, "Reading the repository");
      const p = obj(obj(r.json).permissions);
      return { defaultBranch: str(obj(r.json).default_branch) || "main", canPush: "push" in p ? p.push === true : null };
    },
    async branchSha(branch) {
      const r = await call("GET", `/branches/${enc(branch)}`);
      if (r.status === 404) return null;
      if (r.status !== 200) fail(r, `Reading branch ${branch}`);
      return str(obj(obj(r.json).commit).id) || null;
    },
    async file(path, ref) {
      const r = await call("GET", `/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`);
      if (r.status === 404) return null;
      if (r.status !== 200) fail(r, `Reading ${path}`);
      const j = obj(r.json);
      return { sha: str(j.sha), content: str(j.encoding) === "base64" ? unb64(str(j.content)) : str(j.content) };
    },
    async put(p) {
      const needBranch = p.fromBranch && !(await self.branchSha(p.branch));
      const target = needBranch ? { branch: p.fromBranch, new_branch: p.branch } : { branch: p.branch };
      const r = p.sha
        ? await call("PUT", `/contents/${enc(p.path)}`, { content: b64(p.content), message: p.message, sha: p.sha, ...target })
        : await call("POST", `/contents/${enc(p.path)}`, { content: b64(p.content), message: p.message, ...target });
      if (r.status !== 200 && r.status !== 201) fail(r, `Writing ${p.path}`);
      return { commitSha: str(obj(obj(r.json).commit).sha), fileSha: str(obj(obj(r.json).content).sha) };
    },
    async remove(p) {
      const needBranch = p.fromBranch && !(await self.branchSha(p.branch));
      const target = needBranch ? { branch: p.fromBranch, new_branch: p.branch } : { branch: p.branch };
      const r = await call("DELETE", `/contents/${enc(p.path)}`, { message: p.message, sha: p.sha, ...target });
      if (r.status !== 200) fail(r, `Deleting ${p.path}`);
      return { commitSha: str(obj(obj(r.json).commit).sha) };
    },
    async openPr(p) {
      const r = await call("POST", "/pulls", p);
      if (r.status === 201) return prOf(r.json);
      if (r.status === 409 || r.status === 422) {
        const existing = await self.findOpenPr(p.head, p.base);
        if (existing) return existing;
      }
      fail(r, "Opening the pull request");
    },
    async findOpenPr(head, b) {
      const r = await call("GET", `/pulls?state=open`);
      if (r.status !== 200 || !Array.isArray(r.json)) return null;
      const first = r.json.find((x) => str(obj(obj(x).head).ref) === head && str(obj(obj(x).base).ref) === b);
      return first ? prOf(first) : null;
    },
    async pr(n) {
      const r = await call("GET", `/pulls/${n}`);
      if (r.status !== 200) fail(r, `Reading pull request #${n}`);
      const j = obj(r.json);
      return { state: j.state === "closed" ? "closed" : "open", merged: j.merged === true, url: str(j.html_url) };
    },
    async listDir(path, ref) {
      const r = await call("GET", `/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`);
      return r.status === 200 && Array.isArray(r.json);
    },
  };
  return self;
}

export function prBody(a: PublishableArticle): string {
  return [
    `Generated and reviewed in Lumoras Growth. Merge to publish; the site shows it once deployed.`,
    ``,
    `- **Primary keyword:** ${a.keyword}`,
    `- **Publish date:** ${a.date}`,
    `- **Live URL after deploy:** ${a.url}`,
    `- **Words:** ${a.words}`,
    a.author ? `- **Byline:** ${a.author.name}` : `- **Byline:** the site's default`,
    a.sources.length ? `\nPrimary sources checked:\n${a.sources.map((s) => `- ${s.url}`).join("\n")}` : "",
  ]
    .filter((x) => x !== "")
    .join("\n");
}

export class GitPublisher implements Publisher {
  readonly kind: GitProvider;
  private readonly host: Host;
  private readonly cfg: GitConfig;

  constructor(cfg: GitConfig, token: string, deps: HttpDeps = {}) {
    this.cfg = cfg;
    this.kind = cfg.provider;
    const { owner, repo } = parseRepository(cfg.repository);
    const api = apiBaseFor(cfg);
    this.host = cfg.provider === "github" ? githubHost(api, owner, repo, token, deps) : giteaHost(api, owner, repo, token, deps);
  }

  pathFor(a: Pick<PublishableArticle, "slug" | "date">): string {
    return joinPath(this.cfg.contentDir, renderFilename(this.cfg.filenamePattern, a));
  }
  private branchFor(a: PublishableArticle, action: string) {
    return `lumoras-growth/${action === "publish" ? "" : `${action}-`}${a.slug}`.slice(0, 200);
  }

  async validate(): Promise<Validation> {
    const checks: ValidationCheck[] = [];
    const add = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });
    const bad = unknownPlaceholders(this.cfg.frontmatterTemplate);
    add("Frontmatter template", !bad.length, bad.length ? `Unknown placeholder(s): ${bad.join(", ")}` : "Every placeholder is known.");
    try {
      add("File name pattern", true, this.pathFor({ slug: "example-article", date: "2026-01-01" }));
    } catch (e) {
      add("File name pattern", false, (e as Error).message);
    }
    try {
      const repo = await this.host.repo();
      add("Repository and token", true, `Reachable; default branch ${repo.defaultBranch}.`);
      if (repo.canPush === false) add("Write access", false, "The token can read but not push to this repository.");
      else add("Write access", true, repo.canPush ? "The token can push." : "Push permission not reported; it is checked on the first publish.");
      const head = await this.host.branchSha(this.cfg.branch);
      add(`Branch ${this.cfg.branch}`, !!head, head ? `At ${head.slice(0, 7)}.` : "This branch does not exist.");
      if (head && this.cfg.contentDir) {
        const dir = await this.host.listDir(this.cfg.contentDir, this.cfg.branch);
        add("Content directory", dir, dir ? `${this.cfg.contentDir} exists.` : `${this.cfg.contentDir} was not found on ${this.cfg.branch}; it will be created by the first article.`);
        if (!dir) checks[checks.length - 1].ok = true;
      }
    } catch (e) {
      add("Repository and token", false, e instanceof PublishError ? e.message : "Unexpected error.");
    }
    const ok = checks.every((c) => c.ok);
    return { ok, detail: ok ? `Ready: ${this.cfg.mode === "pr" ? "opens a pull request" : "commits"} on ${this.cfg.branch}.` : checks.find((c) => !c.ok)!.detail, checks };
  }

  private live(a: PublishableArticle) {
    return a.url;
  }

  async publish(a: PublishableArticle): Promise<PublishResult> {
    const path = this.pathFor(a);
    const content = renderPostFile(this.cfg.frontmatterTemplate, a);
    const base = this.cfg.branch;
    const existing = await this.host.file(path, base);
    if (existing && existing.content !== content) throw new PublishError(`${path} already exists on ${base}; refusing to overwrite a page we did not publish. Use update for refreshes.`, { status: 409 });
    const message = `Add article: ${a.title}`;
    if (this.cfg.mode === "commit") {
      if (existing) return { status: "published", mode: "commit", remoteId: path, path, branch: base, commitSha: null, liveUrl: this.live(a), detail: "Already on the branch." };
      const r = await this.host.put({ path, content, message, branch: base });
      return { status: "published", mode: "commit", remoteId: path, path, branch: base, commitSha: r.commitSha || null, liveUrl: this.live(a), detail: `Committed to ${base}.` };
    }
    const branch = this.branchFor(a, "publish");
    const onBranch = await this.host.file(path, branch).catch(() => null);
    let commitSha: string | null = null;
    if (!onBranch || onBranch.content !== content) {
      const r = await this.host.put({ path, content, message, branch, sha: onBranch?.sha ?? null, fromBranch: base });
      commitSha = r.commitSha || null;
    }
    const pr = await this.host.openPr({ title: `Article: ${a.title}`, body: prBody(a), head: branch, base });
    return { status: "open", mode: "pr", remoteId: String(pr.number), path, branch, commitSha, prNumber: pr.number, prUrl: pr.url, liveUrl: this.live(a), detail: `Pull request #${pr.number} opened against ${base}.` };
  }

  async update(a: PublishableArticle, prev: PublicationRef): Promise<PublishResult> {
    const path = prev.path ?? this.pathFor(a);
    const content = renderPostFile(this.cfg.frontmatterTemplate, a);
    const base = this.cfg.branch;
    const current = await this.host.file(path, base);
    if (!current) throw new PublishError(`${path} is not on ${base} (was the earlier pull request merged?).`, { status: 404 });
    const message = `Update article: ${a.title}`;
    if (this.cfg.mode === "commit") {
      const r = await this.host.put({ path, content, message, branch: base, sha: current.sha });
      return { status: "published", mode: "commit", remoteId: path, path, branch: base, commitSha: r.commitSha || null, liveUrl: this.live(a), detail: `Updated on ${base}.` };
    }
    const branch = this.branchFor(a, `update-v${a.version}`);
    const onBranch = await this.host.file(path, branch).catch(() => null);
    const r = await this.host.put({ path, content, message, branch, sha: onBranch?.sha ?? current.sha, fromBranch: base });
    const pr = await this.host.openPr({ title: `Update article: ${a.title}`, body: prBody(a), head: branch, base });
    return { status: "open", mode: "pr", remoteId: String(pr.number), path, branch, commitSha: r.commitSha || null, prNumber: pr.number, prUrl: pr.url, liveUrl: this.live(a), detail: `Pull request #${pr.number} opened with the update.` };
  }

  async unpublish(a: PublishableArticle, prev: PublicationRef): Promise<PublishResult> {
    const path = prev.path ?? this.pathFor(a);
    const base = this.cfg.branch;
    const current = await this.host.file(path, base);
    if (!current) return { status: "published", mode: this.cfg.mode, remoteId: path, path, branch: base, liveUrl: this.live(a), detail: "The file is already gone." };
    const message = `Remove article: ${a.title}`;
    if (this.cfg.mode === "commit") {
      const r = await this.host.remove({ path, sha: current.sha, message, branch: base });
      return { status: "published", mode: "commit", remoteId: path, path, branch: base, commitSha: r.commitSha || null, liveUrl: this.live(a), detail: `Removed from ${base}.` };
    }
    const branch = this.branchFor(a, "remove");
    const r = await this.host.remove({ path, sha: current.sha, message, branch, fromBranch: base });
    const pr = await this.host.openPr({ title: `Remove article: ${a.title}`, body: `Takes down ${a.url}.`, head: branch, base });
    return { status: "open", mode: "pr", remoteId: String(pr.number), path, branch, commitSha: r.commitSha || null, prNumber: pr.number, prUrl: pr.url, liveUrl: this.live(a), detail: `Pull request #${pr.number} removes the file.` };
  }

  async status(prev: PublicationRef): Promise<PublicationStatus> {
    if (prev.prNumber) {
      const pr = await this.host.pr(prev.prNumber);
      if (pr.merged) return { status: "merged", detail: `Pull request #${prev.prNumber} was merged.` };
      if (pr.state === "closed") return { status: "closed", detail: `Pull request #${prev.prNumber} was closed without merging.` };
      return { status: "open", detail: `Pull request #${prev.prNumber} is open.` };
    }
    const f = prev.path ? await this.host.file(prev.path, this.cfg.branch) : null;
    return f ? { status: "published", detail: `${prev.path} is on ${this.cfg.branch}.` } : { status: "unpublished", detail: "The file is not on the branch." };
  }
}

/** Reads a stored git connection config (any age) into the full shape. */
export function readGitConfig(config: Record<string, unknown>): GitConfig {
  const s = (k: string, d: string) => (typeof config[k] === "string" && (config[k] as string).trim() ? (config[k] as string).trim() : d);
  const repository = s("repository", "");
  const provider: GitProvider = config.provider === "gitea" ? "gitea" : config.provider === "github" ? "github" : /github\.com/.test(repository) ? "github" : "gitea";
  return {
    provider,
    repository,
    apiBaseUrl: s("apiBaseUrl", ""),
    branch: s("branch", GIT_DEFAULTS.branch),
    contentDir: s("contentDir", GIT_DEFAULTS.contentDir),
    filenamePattern: s("filenamePattern", GIT_DEFAULTS.filenamePattern),
    frontmatterTemplate: s("frontmatterTemplate", GIT_DEFAULTS.frontmatterTemplate),
    mode: config.mode === "commit" ? "commit" : "pr",
    livePath: s("livePath", GIT_DEFAULTS.livePath),
  };
}
