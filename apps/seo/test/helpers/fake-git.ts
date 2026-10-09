/**
 * Local fakes of the GitHub REST API (version 2026-03-10) and the Gitea API
 * v1, covering exactly what lib/publishers/git.ts calls: repository, branch
 * heads, branch creation, file read/create/update/delete, pull requests.
 * In-memory repositories; `merge()` merges a PR the way a site owner would.
 * Tests, e2e and the dev fakes (scripts/fakes.ts) use these; nothing ever
 * talks to the real GitHub or Gitea.
 */
import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

type FileEntry = { content: string; sha: string };
type Branch = { sha: string; files: Map<string, FileEntry> };
type Pull = { number: number; title: string; body: string; head: string; base: string; state: "open" | "closed"; merged: boolean };
type Repo = { owner: string; repo: string; defaultBranch: string; branches: Map<string, Branch>; pulls: Pull[] };

export type FakeGit = {
  provider: "github" | "gitea";
  port: number;
  origin: string;
  apiBase: string;
  token: string;
  requests: { method: string; path: string; status: number; apiVersion: string | null }[];
  repo(owner: string, name: string): Repo;
  fileOn(owner: string, name: string, branch: string, path: string): string | null;
  merge(owner: string, name: string, n: number): void;
  close(): Promise<void>;
};

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

export async function startFakeGit(opts: {
  provider: "github" | "gitea";
  token?: string;
  repos?: { owner: string; repo: string; defaultBranch?: string; files?: Record<string, string> }[];
  host?: string;
  /** The host name URLs in responses use (resolved to 127.0.0.1 by the test). */
  hostName?: string;
  port?: number;
}): Promise<FakeGit> {
  const token = opts.token ?? "fake-token-0123456789";
  const repos = new Map<string, Repo>();
  let seq = 0;
  const commit = () => sha1(`commit-${++seq}-${Date.now()}`);
  for (const r of opts.repos ?? []) {
    const files = new Map<string, FileEntry>(Object.entries(r.files ?? {}).map(([p, c]) => [p, { content: c, sha: sha1(c) }]));
    const def = r.defaultBranch ?? "main";
    repos.set(`${r.owner}/${r.repo}`, { owner: r.owner, repo: r.repo, defaultBranch: def, branches: new Map([[def, { sha: commit(), files }]]), pulls: [] });
  }
  const requests: FakeGit["requests"] = [];
  let origin = "";
  const prefix = opts.provider === "gitea" ? "/api/v1" : "";

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const send = (status: number, body: unknown) => {
        requests.push({ method: req.method ?? "", path: url.pathname, status, apiVersion: (req.headers["x-github-api-version"] as string) ?? null });
        res.writeHead(status, { "content-type": "application/json" });
        res.end(body === undefined ? "" : JSON.stringify(body));
      };
      const auth = String(req.headers.authorization ?? "");
      const okAuth = opts.provider === "github" ? auth === `Bearer ${token}` : auth === `token ${token}`;
      if (!okAuth) return send(401, { message: "Bad credentials" });
      let body: Record<string, unknown> = {};
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      } catch {
        return send(400, { message: "invalid JSON" });
      }
      if (!url.pathname.startsWith(`${prefix}/repos/`)) return send(404, { message: "Not Found" });
      const parts = url.pathname.slice(`${prefix}/repos/`.length).split("/").map(decodeURIComponent);
      const repo = repos.get(`${parts[0]}/${parts[1]}`);
      if (!repo) return send(404, { message: "Not Found" });
      const rest = parts.slice(2);
      const m = req.method ?? "GET";
      const html = (n: number) => `${origin}/${repo.owner}/${repo.repo}/pull/${n}`;
      const prJson = (p: Pull) => ({ number: p.number, title: p.title, body: p.body, state: p.state, merged: p.merged, html_url: html(p.number), head: { ref: p.head }, base: { ref: p.base } });

      if (!rest.length && m === "GET") return send(200, { full_name: `${repo.owner}/${repo.repo}`, default_branch: repo.defaultBranch, permissions: { pull: true, push: true, admin: false } });

      // branches
      if (opts.provider === "github" && rest[0] === "git" && rest[1] === "ref" && rest[2] === "heads" && m === "GET") {
        const b = repo.branches.get(rest.slice(3).join("/"));
        return b ? send(200, { ref: `refs/heads/${rest.slice(3).join("/")}`, object: { sha: b.sha, type: "commit" } }) : send(404, { message: "Not Found" });
      }
      if (opts.provider === "github" && rest[0] === "git" && rest[1] === "refs" && m === "POST") {
        const name = String(body.ref ?? "").replace(/^refs\/heads\//, "");
        if (repo.branches.has(name)) return send(422, { message: "Reference already exists" });
        const from = [...repo.branches.values()].find((b) => b.sha === body.sha);
        if (!from) return send(422, { message: "Object does not exist" });
        repo.branches.set(name, { sha: from.sha, files: new Map(from.files) });
        return send(201, { ref: `refs/heads/${name}`, object: { sha: from.sha } });
      }
      if (opts.provider === "gitea" && rest[0] === "branches" && m === "GET") {
        const b = repo.branches.get(rest.slice(1).join("/"));
        return b ? send(200, { name: rest.slice(1).join("/"), commit: { id: b.sha } }) : send(404, { message: "Not Found" });
      }

      // contents
      if (rest[0] === "contents") {
        const path = rest.slice(1).join("/");
        const giteaTarget = () => {
          const base = String(body.branch ?? repo.defaultBranch);
          const nb = body.new_branch ? String(body.new_branch) : null;
          if (nb) {
            if (repo.branches.has(nb)) {
              send(422, { message: "branch already exists" });
              return { failed: true as const };
            }
            const from = repo.branches.get(base);
            if (!from) {
              send(404, { message: "base branch not found" });
              return { failed: true as const };
            }
            repo.branches.set(nb, { sha: from.sha, files: new Map(from.files) });
            return { branch: repo.branches.get(nb)! as Branch };
          }
          const b = repo.branches.get(base);
          if (!b) {
            send(404, { message: "branch not found" });
            return { failed: true as const };
          }
          return { branch: b };
        };
        if (m === "GET") {
          const ref = url.searchParams.get("ref") ?? repo.defaultBranch;
          const b = repo.branches.get(ref);
          if (!b) return send(404, { message: "No commit found for the ref" });
          const f = b.files.get(path);
          if (f) return send(200, { type: "file", path, sha: f.sha, encoding: "base64", content: Buffer.from(f.content).toString("base64") });
          const dir = [...b.files.keys()].filter((k) => k.startsWith(`${path}/`));
          if (dir.length) return send(200, dir.map((k) => ({ type: "file", path: k, name: k.split("/").at(-1) })));
          return send(404, { message: "Not Found" });
        }
        const content = typeof body.content === "string" ? Buffer.from(body.content, "base64").toString("utf8") : "";
        if (opts.provider === "github" && m === "PUT") {
          const b = repo.branches.get(String(body.branch ?? repo.defaultBranch));
          if (!b) return send(404, { message: "Branch not found" });
          const cur = b.files.get(path);
          if (cur && body.sha !== cur.sha) return send(cur && !body.sha ? 422 : 409, { message: cur && !body.sha ? '"sha" wasn\'t supplied.' : "sha does not match" });
          const e = { content, sha: sha1(content) };
          b.files.set(path, e);
          b.sha = commit();
          return send(cur ? 200 : 201, { content: { path, sha: e.sha }, commit: { sha: b.sha, message: body.message } });
        }
        if (opts.provider === "gitea" && (m === "POST" || m === "PUT")) {
          const t = giteaTarget();
          if ("failed" in t) return;
          const cur = t.branch.files.get(path);
          if (m === "POST" && cur) return send(422, { message: "file already exists" });
          if (m === "PUT" && cur && body.sha !== cur.sha) return send(409, { message: "sha does not match" });
          const e = { content, sha: sha1(content) };
          t.branch.files.set(path, e);
          t.branch.sha = commit();
          return send(m === "POST" ? 201 : 200, { content: { path, sha: e.sha }, commit: { sha: t.branch.sha, message: body.message } });
        }
        if (m === "DELETE") {
          const t = opts.provider === "gitea" ? giteaTarget() : { branch: repo.branches.get(String(body.branch ?? repo.defaultBranch)) };
          if ("failed" in t) return;
          if (!t.branch) return send(404, { message: "Branch not found" });
          const cur = t.branch.files.get(path);
          if (!cur) return send(404, { message: "Not Found" });
          if (body.sha !== cur.sha) return send(409, { message: "sha does not match" });
          t.branch.files.delete(path);
          t.branch.sha = commit();
          return send(200, { commit: { sha: t.branch.sha } });
        }
      }

      // pull requests
      if (rest[0] === "pulls") {
        if (rest.length === 1 && m === "POST") {
          const head = String(body.head ?? ""), base = String(body.base ?? "");
          if (!repo.branches.has(head) || !repo.branches.has(base)) return send(422, { message: "Validation Failed: head or base does not exist" });
          if (repo.pulls.some((p) => p.head === head && p.base === base && p.state === "open")) {
            return send(opts.provider === "gitea" ? 409 : 422, { message: "A pull request already exists" });
          }
          const p: Pull = { number: repo.pulls.length + 1, title: String(body.title ?? ""), body: String(body.body ?? ""), head, base, state: "open", merged: false };
          repo.pulls.push(p);
          return send(201, prJson(p));
        }
        if (rest.length === 1 && m === "GET") {
          const state = url.searchParams.get("state") ?? "open";
          const headQ = url.searchParams.get("head");
          return send(200, repo.pulls.filter((p) => (state === "all" || p.state === state) && (!headQ || `${repo.owner}:${p.head}` === headQ)).map(prJson));
        }
        if (rest.length === 2 && m === "GET") {
          const p = repo.pulls.find((x) => x.number === Number(rest[1]));
          return p ? send(200, prJson(p)) : send(404, { message: "Not Found" });
        }
      }
      return send(404, { message: `Not Found: ${m} ${url.pathname}` });
    });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  origin = `http://${opts.hostName ?? "127.0.0.1"}:${port}`;
  const get = (o: string, n: string) => {
    const r = repos.get(`${o}/${n}`);
    if (!r) throw new Error(`no repo ${o}/${n}`);
    return r;
  };
  return {
    provider: opts.provider,
    port,
    origin,
    apiBase: `${origin}${prefix}`,
    token,
    requests,
    repo: get,
    fileOn: (o, n, branch, path) => get(o, n).branches.get(branch)?.files.get(path)?.content ?? null,
    merge(o, n, num) {
      const r = get(o, n);
      const p = r.pulls.find((x) => x.number === num);
      if (!p || p.state !== "open") throw new Error("no open PR");
      const head = r.branches.get(p.head)!, base = r.branches.get(p.base)!;
      base.files = new Map(head.files);
      base.sha = commit();
      p.state = "closed";
      p.merged = true;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
