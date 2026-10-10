/**
 * Phase 3 end to end, on the production build with the worker running
 * (pg-boss), FakeLlm, recorded source pages and a fake GitHub (e2e/serve.ts):
 *
 *   - the review gate by role: a viewer reads and comments but cannot approve;
 *     a reviewer approves but cannot edit;
 *   - the editor: live lint panel, evidence, a saved version and its diff;
 *   - the calendar: drag and drop, keyboard (M, arrows, Enter), and refusal
 *     of a day in the past (no back-dating);
 *   - a live run: "Run now" opens the run view, steps light up as the worker
 *     finishes them, and it stops at the review gate;
 *   - the runway alert (banner on the dashboard and calendar, in-app alert);
 *   - a publishing connector's live Test against the fake GitHub;
 *   - every Phase 3 screen in both themes at 375 and 1440 px without
 *     sideways scroll or console errors, and under reduced motion.
 * Asserts on data and structure, never on generated wording.
 */
import { expect, test, type Page } from "@playwright/test";
import { db, overflow, setTheme, shot, signIn, watchConsole, wideElements } from "./helpers";

const P3 = "seo-p3";
const TZ = "America/New_York";

type Row = { id: string; status: string; title: string; slot_at: Date; current_run_id: string | null; domain: string; site_id: string };

async function items(domain: string, statuses?: string[]): Promise<Row[]> {
  const r = await (await db()).query<Row>(
    `SELECT c.id, c.status, c.title, c.slot_at, c.current_run_id, s.domain, s.id AS site_id FROM content_items c JOIN sites s ON s.id = c.site_id
     WHERE s.domain = $1 AND ($2::text[] IS NULL OR c.status = ANY($2)) ORDER BY c.slot_at`,
    [domain, statuses ?? null],
  );
  return r.rows;
}

const localDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function siteId(domain: string) {
  return (await (await db()).query<{ id: string }>("SELECT id FROM sites WHERE domain = $1", [domain])).rows[0].id;
}

/** A real pointer drag (press, move in steps past the drag threshold, release): HTML5 drag and drop as a person does it. */
async function drag(page: Page, from: ReturnType<Page["locator"]>, to: ReturnType<Page["locator"]>) {
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
  const [x0, y0, x1, y1] = [a.x + a.width / 2, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10);
  await page.mouse.up();
}

async function check(page: Page, name: string, errors: string[]) {
  const o = await overflow(page);
  expect(o, `${name}: sideways scroll (${(await wideElements(page)).join(", ")})`).toBeLessThanOrEqual(0);
  expect(errors, `${name}: console errors`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test("review gate by role: a viewer reads and comments but cannot approve; a reviewer approves but cannot edit", async ({ browser }) => {
  const [item] = await items("lumoras.ai", ["awaiting_review"]);
  expect(item, "the seed left a lumoras.ai article awaiting review").toBeTruthy();

  const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const viewer = await vctx.newPage();
  const verrors = watchConsole(viewer);
  await signIn(viewer, "viewer@lumoras.example", `/w/lumoras/content/${item.id}`);
  await expect(viewer.getByRole("heading", { level: 1 })).toHaveText(item.title);
  await expect(viewer.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(viewer.getByText("Your role can read and comment. Reviewers, editors and owners approve.")).toBeVisible();
  await expect(viewer.getByRole("button", { name: /Save version/ })).toHaveCount(0);
  await expect(viewer.getByLabel("Article body (Markdown)")).toHaveAttribute("readonly", "");
  await viewer.getByLabel("Add a comment").fill("Can we mention weekend hours?");
  await viewer.getByRole("button", { name: "Comment" }).click();
  await expect(viewer.locator(".cm-body").filter({ hasText: "Can we mention weekend hours?" })).toBeVisible();
  // the review queue offers the viewer reading only
  await viewer.goto("/w/lumoras/review");
  await expect(viewer.getByText("Your role can read and comment on these articles.")).toBeVisible();
  await expect(viewer.getByRole("link", { name: "Review", exact: true })).toHaveCount(0);
  expect(verrors).toEqual([]);
  await vctx.close();

  const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const reviewer = await rctx.newPage();
  const rerrors = watchConsole(reviewer);
  await signIn(reviewer, "reviewer@lumoras.example", "/w/lumoras/review");
  await shot(reviewer, "review-queue-dark-1440", P3);
  await reviewer.locator(".rq-item").filter({ hasText: item.title }).getByRole("link", { name: "Review" }).click();
  await expect(reviewer.getByRole("heading", { level: 1 })).toHaveText(item.title);
  // a reviewer cannot edit
  await expect(reviewer.getByRole("button", { name: /Save version/ })).toHaveCount(0);
  await expect(reviewer.getByLabel("Article body (Markdown)")).toHaveAttribute("readonly", "");
  // request changes needs a note; then approve
  await expect(reviewer.getByRole("button", { name: "Request changes" })).toBeDisabled();
  await reviewer.getByRole("button", { name: "Approve" }).click();
  await expect(reviewer.getByText("Approved. It goes out at its slot.")).toBeVisible();
  await expect(reviewer.locator(".ed-strip .badge").first()).toHaveText("Scheduled");
  const pool = await db();
  const rv = (await pool.query<{ decision: string; reviewer_role: string; status: string }>(
    "SELECT r.decision, r.reviewer_role, c.status FROM content_reviews r JOIN content_items c ON c.id = r.item_id WHERE r.item_id = $1 ORDER BY r.created_at DESC LIMIT 1",
    [item.id],
  )).rows[0];
  expect(rv).toEqual({ decision: "approved", reviewer_role: "reviewer", status: "approved" });
  const audit = (await pool.query<{ action: string }>("SELECT action FROM audit_log WHERE entity_type = 'content_reviews' AND entity_id = (SELECT id::text FROM content_reviews WHERE item_id = $1 ORDER BY created_at DESC LIMIT 1)", [item.id])).rows;
  expect(audit.map((a) => a.action)).toEqual(["content.approve"]);
  expect(rerrors).toEqual([]);
  await rctx.close();
});

test("article editor: live lint panel, fact-check evidence, a new version and its diff", async ({ page }) => {
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  const [item] = await items("sonorch.ai", ["awaiting_review"]);
  await signIn(page, "editor@lumoras.example", `/w/lumoras/content/${item.id}`);
  const lint = page.locator(".lint-list");
  await expect(lint.locator("li")).toHaveCount(15);
  const kw = lint.locator("li").filter({ hasText: "Keyword in the title" });
  await expect(kw).toHaveAttribute("data-status", "pass");
  // the lint runs in the browser on every edit
  const title = page.getByLabel(/^Title/);
  const original = await title.inputValue();
  await title.fill("Something else entirely");
  await expect(kw).toHaveAttribute("data-status", "fail");
  await expect(page.locator(".side-h").filter({ hasText: "SEO checklist" })).toContainText(/failing/);
  await title.fill(original);
  await expect(kw).toHaveAttribute("data-status", "pass");
  // evidence per claim
  await expect(page.locator(".ev-list li").first()).toBeVisible();
  // save a new version, compare with the first
  const body = page.getByLabel("Article body (Markdown)");
  await body.fill(`${await body.inputValue()}\n\nOne more line from the editor.`);
  await page.getByPlaceholder("What changed (optional)").fill("Closing line");
  await page.getByRole("button", { name: /Save version \d+/ }).click();
  await expect(page.getByText(/Saved as version \d+\. Lint ran again/)).toBeVisible();
  await expect(page.locator(".ver-list li")).toHaveCount(await page.locator(".ver-list li").count());
  const first = page.locator(".ver-list li").last();
  await first.getByRole("button", { name: "Compare" }).click();
  const diff = page.locator(".diff-view");
  await expect(diff).toContainText("One more line from the editor.");
  await expect(page.locator(".diff-add")).toHaveText("+2");
  await expect(page.locator(".diff-del")).toHaveText("−0");
  const v = (await (await db()).query<{ n: number; fc: boolean | null }>("SELECT (SELECT count(*)::int FROM content_versions WHERE item_id = $1) AS n, fact_check_passed AS fc FROM content_items WHERE id = $1", [item.id])).rows[0];
  expect(v.n).toBeGreaterThanOrEqual(2);
  expect(v.fc, "an edit invalidates the fact-check").toBeNull();
  await shot(page, "editor-lint-evidence-diff-dark-1440", P3);
  expect(errors).toEqual([]);
});

test("calendar: drag and drop, keyboard reschedule, and no moves into the past", async ({ page }) => {
  const errors = watchConsole(page);
  await setTheme(page, "light");
  await page.setViewportSize({ width: 1440, height: 900 });
  const planned = (await items("lumoras.ai", ["planned"])).filter((p) => p.slot_at.getTime() > Date.now() + 86_400_000);
  // two empty slots whose next day is in the same month and free
  const busy = new Set((await items("lumoras.ai")).map((p) => localDate(p.slot_at)));
  const pick = planned.filter((p) => {
    const d = localDate(p.slot_at);
    return addDays(d, 1).slice(0, 7) === d.slice(0, 7) && !busy.has(addDays(d, 1));
  });
  const [a, b] = pick;
  expect(a && b, "two movable empty slots").toBeTruthy();
  const site = a.site_id;

  // drag and drop
  const da = localDate(a.slot_at);
  await signIn(page, "editor@lumoras.example", `/w/lumoras/content?site=${site}&month=${da.slice(0, 7)}`);
  const chipA = page.locator(`td[data-date="${da}"] .cchip`);
  await expect(chipA).toHaveCount(1);
  await drag(page, chipA, page.locator(`td[data-date="${addDays(da, 1)}"]`));
  await expect(page.getByText(`Moved to ${addDays(da, 1)}.`)).toBeVisible();
  await expect(page.locator(`td[data-date="${addDays(da, 1)}"] .cchip`)).toHaveCount(1);
  expect(localDate((await (await db()).query<{ slot_at: Date }>("SELECT slot_at FROM content_items WHERE id = $1", [a.id])).rows[0].slot_at)).toBe(addDays(da, 1));

  // keyboard: M, ArrowRight, Enter
  const dbb = localDate(b.slot_at);
  await page.goto(`/w/lumoras/content?site=${site}&month=${dbb.slice(0, 7)}`);
  const chipB = page.locator(`td[data-date="${dbb}"] .cchip`);
  await chipB.focus();
  await page.keyboard.press("m");
  await expect(chipB).toHaveAttribute("data-moving", "");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(`td[data-date="${addDays(dbb, 1)}"]`)).toHaveAttribute("data-target", "ok");
  await shot(page, "calendar-keyboard-move-light-1440", P3);
  await page.keyboard.press("Enter");
  await expect(page.getByText(`Moved to ${addDays(dbb, 1)}.`)).toBeVisible();
  expect(localDate((await (await db()).query<{ slot_at: Date }>("SELECT slot_at FROM content_items WHERE id = $1", [b.id])).rows[0].slot_at)).toBe(addDays(dbb, 1));

  // a day in the past is refused (back-dating is off)
  const today = localDate(new Date());
  await page.goto(`/w/lumoras/content?site=${site}&month=${today.slice(0, 7)}`);
  const next = page.locator("td[data-date] .cchip[data-status='planned']").first();
  const nd = await next.locator("xpath=ancestor::td").getAttribute("data-date");
  await next.focus();
  await page.keyboard.press("m");
  const steps = Math.ceil((Date.parse(`${nd}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) + 1;
  for (let i = 0; i < steps; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page.getByText("That day is in the past: back-dating is off for this site.")).toBeAttached();
  expect(errors).toEqual([]);
});

test("Run now opens the live run view: steps light up as the worker finishes them, and the run stops at the review gate", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  const planned = (await items("lumoras.ai", ["planned"])).filter((p) => p.slot_at.getTime() > Date.now() + 2 * 86_400_000);
  const target = planned.at(-1)!;
  const d = localDate(target.slot_at);
  await signIn(page, "editor@lumoras.example", `/w/lumoras/content?site=${target.site_id}&month=${d.slice(0, 7)}`);
  await page.locator(`td[data-date="${d}"] .cchip`).click();
  await page.getByRole("region", { name: "Selected article" }).getByRole("button", { name: "Run now" }).click();
  await page.waitForURL(/\/w\/lumoras\/runs\/[0-9a-f-]{36}$/);
  await expect(page.locator(".pipe-live")).toBeVisible();
  await expect(page.locator(".pnode[data-status='running']")).toHaveCount(1, { timeout: 30_000 });
  await shot(page, "run-live-dark-1440", P3);
  // statuses arrive over server-sent events: the topic step finishes, then the run waits at review
  await expect(page.locator(".pnode[data-step='topic']")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(page.locator(".pnode[data-step='review']")).toHaveAttribute("data-status", "waiting", { timeout: 60_000 });
  for (const k of ["context", "scan", "topic", "brief", "draft", "factcheck", "lint"]) await expect(page.locator(`.pnode[data-step='${k}']`)).toHaveAttribute("data-status", "done");
  await page.locator(".pnode[data-step='draft'] .pnode-btn").click();
  await expect(page.getByRole("region", { name: "Step details: Draft" })).toBeVisible();
  await expect(page.locator(".pd .kv").last()).toContainText("claude-sonnet-5-5");
  await shot(page, "run-expanded-node-dark-1440", P3);
  const runId = page.url().split("/").at(-1)!;
  const run = (await (await db()).query<{ status: string; current_step: string }>("SELECT status, current_step FROM pipeline_runs WHERE id = $1", [runId])).rows[0];
  expect(run).toEqual({ status: "waiting", current_step: "review" });
  expect(errors).toEqual([]);
});

test("the runway alert: a banner on the dashboard and the calendar, amber for a short queue and red for an empty one", async ({ page }) => {
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "owner@lumoras.example", "/w/lumoras");
  const banner = page.locator(".runway-banner");
  await expect(banner).toHaveAttribute("data-level", "empty");
  await expect(banner).toContainText("seasonx.ai: nothing is ready to publish");
  await expect(banner).toContainText(/sonorch\.ai: \d+ days? of runway/);
  await shot(page, "runway-banner-dark-1440", P3);
  // the in-app alert the runway check wrote
  const notes = (await (await db()).query<{ title: string }>("SELECT title FROM notifications WHERE kind = 'runway' ORDER BY created_at DESC")).rows.map((r) => r.title);
  expect(notes.some((t) => /seasonx\.ai/.test(t))).toBe(true);
  // the calendar: red band for seasonx.ai, amber for sonorch.ai
  await page.goto(`/w/lumoras/content?site=${await siteId("seasonx.ai")}`);
  await expect(page.locator(".ccal")).toHaveAttribute("data-runway", "empty");
  await expect(page.locator(".cal-seg[data-kind='gap']").first()).toBeVisible();
  await shot(page, "calendar-runway-red-dark-1440", P3);
  await page.goto(`/w/lumoras/content?site=${await siteId("sonorch.ai")}`);
  await expect(page.locator(".ccal")).toHaveAttribute("data-runway", "low");
  await shot(page, "calendar-runway-amber-dark-1440", P3);
  expect(errors).toEqual([]);
});

test("a publishing connector's live Test against the fake GitHub, and the status light", async ({ page }) => {
  const errors = watchConsole(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  const site = await siteId("lumoras.ai");
  await signIn(page, "owner@lumoras.example", `/w/lumoras/sites/${site}/connections`);
  const conn = page.locator(".conn").filter({ hasText: "lumoras.ai repository (fake GitHub)" });
  await expect(conn.getByText("Publishes this site")).toBeVisible();
  await conn.getByRole("button", { name: "Test" }).click();
  await expect(conn.locator(".conn-test")).toContainText("Ready: opens a pull request on dev.");
  expect(await conn.locator(".conn-test li").count()).toBeGreaterThanOrEqual(5);
  await shot(page, "connections-publishing-test-dark-1440", P3);
  await page.reload();
  await expect(conn.locator(".light")).toContainText("Working");
  // a reviewer sees the connection but cannot test or change it
  expect(errors).toEqual([]);
});

const SCREENS: [string, (ids: Record<string, string>) => string, string][] = [
  ["calendar-month", (i) => `/w/lumoras/content?site=${i.lumoras}`, "owner@lumoras.example"],
  ["calendar-list", (i) => `/w/lumoras/content?site=${i.lumoras}&view=list`, "owner@lumoras.example"],
  ["calendar-amber", (i) => `/w/lumoras/content?site=${i.sonorch}`, "owner@lumoras.example"],
  ["calendar-red", (i) => `/w/lumoras/content?site=${i.seasonx}`, "owner@lumoras.example"],
  ["run-view", (i) => `/w/lumoras/runs/${i.run}`, "owner@lumoras.example"],
  ["runs", () => `/w/lumoras/runs`, "owner@lumoras.example"],
  ["editor", (i) => `/w/lumoras/content/${i.item}`, "editor@lumoras.example"],
  ["review-queue", () => `/w/lumoras/review`, "reviewer@lumoras.example"],
  ["connections", (i) => `/w/lumoras/sites/${i.lumoras}/connections`, "owner@lumoras.example"],
  ["site-settings", (i) => `/w/lumoras/sites/${i.lumoras}/settings`, "owner@lumoras.example"],
  ["dashboard-runway", () => `/w/lumoras`, "owner@lumoras.example"],
];

for (const theme of ["dark", "light"] as const) {
  for (const width of [1440, 375]) {
    test(`Phase 3 screens, ${theme} at ${width}px: no sideways scroll, no console errors`, async ({ page }) => {
      test.setTimeout(150_000);
      const errors = watchConsole(page);
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 900 });
      const [run] = (await (await db()).query<{ id: string }>("SELECT r.id FROM pipeline_runs r JOIN sites s ON s.id = r.site_id WHERE s.domain = 'lumoras.ai' AND r.status = 'succeeded' LIMIT 1")).rows;
      const [item] = await items("sonorch.ai", ["awaiting_review"]);
      const ids = { lumoras: await siteId("lumoras.ai"), sonorch: await siteId("sonorch.ai"), seasonx: await siteId("seasonx.ai"), run: run.id, item: item.id };
      let who = "";
      for (const [name, url, email] of SCREENS) {
        if (email !== who) {
          await page.context().clearCookies();
          await signIn(page, email, url(ids));
          who = email;
        } else await page.goto(url(ids));
        await page.waitForLoadState("networkidle");
        await check(page, `${name} ${theme} ${width}`, errors);
        await shot(page, `${name}-${theme}-${width}`, P3);
      }
    });
  }
}

test("reduced motion: the calendar and the run view do not animate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setTheme(page, "dark");
  const [run] = (await (await db()).query<{ id: string }>("SELECT r.id FROM pipeline_runs r JOIN sites s ON s.id = r.site_id WHERE s.domain = 'lumoras.ai' AND r.status = 'succeeded' LIMIT 1")).rows;
  await signIn(page, "owner@lumoras.example", `/w/lumoras/runs/${run.id}`);
  // seconds, from "0s", "1ms" or "0.2s, 0.2s"
  const secs = (v: string) => Math.max(...v.split(",").map((x) => (x.trim().endsWith("ms") ? parseFloat(x) / 1000 : parseFloat(x))));
  const dur = async (sel: string) => (await page.locator(sel).first().evaluate((el) => [getComputedStyle(el).animationDuration, getComputedStyle(el).transitionDuration])).map(secs);
  for (const d of await dur(".pnode-dot")) expect(d).toBeLessThanOrEqual(0.001);
  expect(await page.locator(".pipe-pulse").evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  await page.goto(`/w/lumoras/content?site=${await siteId("lumoras.ai")}`);
  for (const d of await dur(".cal-seg")) expect(d).toBeLessThanOrEqual(0.001);
  for (const d of await dur(".cchip")) expect(d).toBeLessThanOrEqual(0.001);
});
