/**
 * Development fakes for publishing (pnpm --filter seo fakes):
 *   - a fake GitHub API on 127.0.0.1:4571 (host name github.test) holding
 *     timtasay/lumoras.ai (base branch dev) with a few existing insights, so the seeded Git
 *     connection can be tested and articles land as pull requests;
 *   - a webhook receiver on 127.0.0.1:4572 (webhook.test) that verifies the
 *     signature of every delivery and prints it;
 *   - a fake Google on 127.0.0.1:4573 (OAuth, Search Console, URL Inspection,
 *     GA4 Admin and Data) serving realistic synthetic data, for the Phase 4
 *     dashboards: set GOOGLE_API_TEST_ORIGIN and the fake client id/secret it prints.
 * Start the web app and the worker with OUTBOUND_TEST_HOSTS=github.test,webhook.test
 * so the SSRF guard resolves those names to this machine. Nothing here talks
 * to the real GitHub: there is no token for it in this repository.
 */
import { startFakeGit } from "../test/helpers/fake-git.ts";
import { startFakeWebhook } from "../test/helpers/fake-webhook.ts";
import { FAKE_GOOGLE_CLIENT, startFakeGoogle } from "../test/helpers/fake-google.ts";
import { DEV_FAKE_GITHUB, DEV_FAKE_WEBHOOK } from "../lib/seed-content.ts";

/** The dev fake Google's port (GOOGLE_API_TEST_ORIGIN=http://127.0.0.1:4573). */
export const DEV_FAKE_GOOGLE_PORT = 4573;
import { createLogger } from "../lib/log.ts";

const log = createLogger("fakes");

async function main() {
  const gh = await startFakeGit({
    provider: "github",
    hostName: "github.test",
    port: Number(new URL(DEV_FAKE_GITHUB.apiBase).port),
    token: DEV_FAKE_GITHUB.token,
    repos: [
      {
        owner: "timtasay",
        repo: "lumoras.ai",
        defaultBranch: "dev",
        files: {
          "apps/web/content/insights/no-show-policy.md": "---\ntitle: No-show policy\n---\n",
          "apps/web/content/insights/ai-receptionist-cost.md": "---\ntitle: AI receptionist cost\n---\n",
        },
      },
    ],
  });
  const wh = await startFakeWebhook(DEV_FAKE_WEBHOOK.secret, { hostName: "webhook.test", port: Number(new URL(DEV_FAKE_WEBHOOK.endpoint).port) });
  // Phase 4: a fake Google (OAuth, Search Console, URL Inspection, GA4) with realistic synthetic data
  const google = await startFakeGoogle({ port: DEV_FAKE_GOOGLE_PORT });
  log.info("fakes ready", {
    github: gh.apiBase,
    webhook: wh.origin,
    google: google.origin,
    hosts: "OUTBOUND_TEST_HOSTS=github.test,webhook.test",
    googleEnv: `GOOGLE_API_TEST_ORIGIN=${google.origin} GOOGLE_OAUTH_CLIENT_ID=${FAKE_GOOGLE_CLIENT.clientId} GOOGLE_OAUTH_CLIENT_SECRET=${FAKE_GOOGLE_CLIENT.clientSecret}`,
  });
  let seen = 0;
  const timer = setInterval(() => {
    for (const d of wh.deliveries.slice(seen)) log.info("webhook delivery", { event: d.headers["x-lumoras-event"], verified: d.verdict.ok });
    seen = wh.deliveries.length;
  }, 1000);
  const stop = async () => {
    clearInterval(timer);
    await gh.close();
    await wh.close();
    await google.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

main().catch((e) => {
  log.error("fakes failed", { err: e instanceof Error ? e : new Error(String(e)) });
  process.exit(1);
});
