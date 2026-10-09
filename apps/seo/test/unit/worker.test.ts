import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

function runWorker(env: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", "tsx", "worker/index.ts"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: Record<string, unknown>[] = [];
  let buf = "";
  child.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        lines.push(JSON.parse(line));
      } catch {
        lines.push({ raw: line });
      }
    }
  });
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  const waitFor = async (msg: string, ms = 15_000) => {
    const t0 = Date.now();
    while (!lines.some((l) => l.msg === msg)) {
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for "${msg}"; got ${JSON.stringify(lines)}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  return { child, lines, exited, waitFor };
}

describe("worker entry", () => {
  it("starts, logs ready without the password, and exits 0 on SIGTERM", async () => {
    const w = runWorker({ DATABASE_URL: "postgres://seo_app:top-secret@localhost:5432/seo" });
    await w.waitFor("worker ready");
    w.child.kill("SIGTERM");
    const code = await w.exited;
    assert.equal(code, 0);
    const msgs = w.lines.map((l) => l.msg);
    assert.deepEqual(msgs.slice(-2), ["worker stopping", "worker stopped"]);
    assert.equal(w.lines.find((l) => l.msg === "worker stopping")?.reason, "SIGTERM");
    assert.ok(!JSON.stringify(w.lines).includes("top-secret"), "password must not be logged");
  });

  it("exits 1 with the problems listed when the environment is invalid", async () => {
    const w = runWorker({});
    const code = await w.exited;
    assert.equal(code, 1);
    const err = w.lines.find((l) => l.msg === "invalid environment");
    assert.ok(err, "logs invalid environment");
    assert.match(JSON.stringify(err.problems), /DATABASE_URL is required/);
  });
});
