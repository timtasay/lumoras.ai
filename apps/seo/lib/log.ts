/**
 * Structured JSON-lines logger for the server, worker and scripts.
 * One line per event: {"t":"…","level":"info","svc":"worker","msg":"…",…fields}.
 * Never log secrets: pass connection strings through redactUrl() first.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type Logger = {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
};

export function isLogLevel(v: unknown): v is LogLevel {
  return v === "debug" || v === "info" || v === "warn" || v === "error";
}

export function createLogger(
  svc: string,
  opts: { level?: LogLevel; write?: (line: string) => void; base?: Record<string, unknown> } = {},
): Logger {
  const min = RANK[opts.level ?? "info"];
  const write = opts.write ?? ((line: string) => process.stdout.write(line + "\n"));
  const base = opts.base ?? {};
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (RANK[level] < min) return;
    const rec: Record<string, unknown> = { t: new Date().toISOString(), level, svc, msg, ...base, ...fields };
    if (rec.err instanceof Error) rec.err = { name: rec.err.name, message: rec.err.message };
    write(JSON.stringify(rec));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (f) => createLogger(svc, { ...opts, base: { ...base, ...f } }),
  };
}

/** postgres://user:secret@host/db → postgres://user:***@host/db */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<unparseable url>";
  }
}
