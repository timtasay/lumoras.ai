/** PipelineDeps for tests: FakeLlm, FakeProvider, recorded pages, a controllable clock, and recorders for jobs and mail. */
import type pg from "pg";
import { readKeyring, type Keyring } from "../../lib/crypto/secrets.ts";
import { FakeLlm } from "../../lib/llm/fake.ts";
import { RECORDED_PAGES } from "../../lib/llm/fixtures.ts";
import { DEFAULT_PRICES } from "../../lib/llm/prices.ts";
import { DEFAULT_MODELS, type LlmProvider } from "../../lib/llm/types.ts";
import { createLogger } from "../../lib/log.ts";
import { RecordedFetcher } from "../../lib/net/fetcher.ts";
import type { SafeFetchPolicy } from "../../lib/net/safe-fetch.ts";
import type { Mail, PipelineDeps, QueueName } from "../../lib/pipeline/deps.ts";
import { FakeProvider } from "../../lib/providers/fake.ts";

export const TEST_RING: Keyring = readKeyring({ ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") });

export type Recorded = { jobs: { queue: QueueName; data: Record<string, unknown>; startAfter?: Date; singletonKey?: string }[]; mail: Mail[] };

export function testDeps(pool: pg.Pool, o: { llm?: LlmProvider; clock?: { now: Date }; policy?: SafeFetchPolicy; keyring?: Keyring | null; seo?: FakeProvider | null } = {}): PipelineDeps & { rec: Recorded } {
  const rec: Recorded = { jobs: [], mail: [] };
  const clock = o.clock;
  return {
    db: pool,
    llm: o.llm ?? new FakeLlm(),
    prices: DEFAULT_PRICES,
    models: DEFAULT_MODELS,
    seo: o.seo === undefined ? new FakeProvider() : o.seo,
    keyring: o.keyring === undefined ? TEST_RING : o.keyring,
    fetcher: new RecordedFetcher(RECORDED_PAGES),
    outbound: o.policy ?? {},
    google: null,
    enqueue: async (queue, data, opts) => void rec.jobs.push({ queue, data, ...opts }),
    mail: async (m) => void rec.mail.push(m),
    now: () => (clock ? new Date(clock.now) : new Date()),
    log: createLogger("test", { level: "error" }),
    baseUrl: "http://127.0.0.1:3107",
    rec,
  };
}
