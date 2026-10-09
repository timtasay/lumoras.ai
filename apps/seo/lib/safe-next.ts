/** Only same-site paths are allowed as a post-sign-in destination (no //host, no backslashes, no schemes). */
export function safeNext(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f]/.test(next) || next.length > 512) return fallback;
  return next;
}
