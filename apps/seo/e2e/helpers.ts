import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { expect, type Page } from "@playwright/test";
import { E2E } from "./config";

type Mail = { to: string; kind: string; link: string; subject: string };

/** Waits for the newest email of `kind` to `to` written after `since` (the outbox is EMAIL_OUTBOX_DIR). */
export async function waitForMail(to: string, kind: Mail["kind"], since: number, timeout = 15_000, marker?: string): Promise<Mail> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const files = (await readdir(E2E.outbox).catch(() => [])).filter((f) => f.endsWith(".json")).sort();
    for (const f of files.reverse()) {
      if (Number(f.split("-")[0]) < since) continue;
      const m = JSON.parse(await readFile(path.join(E2E.outbox, f), "utf8")) as Mail;
      if (m.to === to && m.kind === kind && (!marker || decodeURIComponent(m.link).includes(marker))) return m;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`no ${kind} email to ${to} within ${timeout}ms`);
}

/** Signs in through the real form and the emailed magic link. */
export async function signIn(page: Page, email: string, next = "/") {
  const since = Date.now() - 1;
  // a marker in the callback URL ties the emailed link to this sign-in (tests run in parallel, some as the same user)
  const marker = `e2e=${Math.random().toString(36).slice(2, 10)}`;
  const target = `${next}${next.includes("?") ? "&" : "?"}${marker}`;
  await page.goto(`/sign-in?next=${encodeURIComponent(target)}`);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  const mail = await waitForMail(email, "magic-link", since, 15_000, marker);
  expect(new URL(mail.link).pathname).toBe("/api/auth/magic-link/verify");
  await page.goto(mail.link);
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in") && !u.pathname.startsWith("/api/"));
}

/** Collects console errors and page errors (CSP violations show up here too). */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** The deepest elements that stick out past the right edge (to name the culprit when a page scrolls sideways). */
export const wideElements = (page: Page) =>
  page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.right > w + 1 && r.width > 0 && ![...el.children].some((c) => c.getBoundingClientRect().right > w + 1)) {
        out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} right=${Math.round(r.right)}`);
      }
    }
    return out.slice(0, 8);
  });

export const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

export async function setTheme(page: Page, theme: "dark" | "light") {
  await page.addInitScript((t) => localStorage.setItem("lumoras-theme", t), theme);
}

export async function shot(page: Page, name: string, prefix = "seo-p1") {
  if (!E2E.shots) return;
  // full page, with a viewport as tall as the page so sticky parts render as a user sees them
  await page.waitForLoadState("load");
  const h = await page.evaluate(() => document.documentElement.scrollHeight).catch(async () => {
    // a navigation finished in between (a redirect or refresh): measure the page that is there now
    await page.waitForLoadState("load");
    return page.evaluate(() => document.documentElement.scrollHeight);
  });
  const vp = page.viewportSize()!;
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 6000) });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(E2E.shots, `${prefix}-${name}.png`) });
  await page.setViewportSize(vp);
}

let pool: pg.Pool | null = null;
/** Superuser access to the e2e database, for asserting on data (never for setting up UI state). */
export async function db(): Promise<pg.Pool> {
  if (!pool) {
    const state = JSON.parse(await readFile(E2E.stateFile, "utf8")) as { adminUrl: string };
    pool = new pg.Pool({ connectionString: state.adminUrl, max: 2 });
  }
  return pool;
}

export const uniqueEmail = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.test`;
