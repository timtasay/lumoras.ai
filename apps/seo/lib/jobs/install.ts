/**
 * Installs or migrates pg-boss's schema as the OWNER role and creates our
 * queues. Run by scripts/migrate.ts after the SQL migrations (and by the
 * test helpers). Idempotent: createQueue does nothing for an existing queue,
 * and updateQueue brings its retry policy in line with QUEUE_DEFS.
 */
import { PgBoss } from "pg-boss";
import { JOB_SCHEMA, QUEUE_DEFS } from "./queues.ts";

export async function installJobSchema(ownerUrl: string, log: (msg: string, fields?: Record<string, unknown>) => void = () => {}): Promise<{ version: number | null; queues: number }> {
  const boss = new PgBoss({
    connectionString: ownerUrl,
    schema: JOB_SCHEMA,
    // the schema itself comes from deploy/postgres/10-seo-database.sh (owned by the owner role, grants for the app role)
    createSchema: false,
    migrate: true,
    supervise: false,
    schedule: false,
    registerInstance: false,
    max: 2,
  });
  boss.on("error", (e) => log("pg-boss error during install", { err: e instanceof Error ? e.message : String(e) }));
  await boss.start();
  try {
    for (const q of QUEUE_DEFS) {
      const { name, ...opts } = q;
      await boss.createQueue(name, opts);
      const { policy: _p, partition: _pa, deadLetter: _d, ...updatable } = opts as typeof opts & { partition?: boolean; deadLetter?: string };
      await boss.updateQueue(name, updatable);
    }
    const version = await boss.schemaVersion();
    log("job queue schema ready", { schema: JOB_SCHEMA, version, queues: QUEUE_DEFS.length });
    return { version, queues: QUEUE_DEFS.length };
  } finally {
    await boss.stop({ graceful: false, close: true });
  }
}
