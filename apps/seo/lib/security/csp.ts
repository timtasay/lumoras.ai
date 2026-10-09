/**
 * Content Security Policy, built per request with a fresh nonce (proxy.ts).
 *
 * Scripts: only same-origin files and inline scripts carrying the nonce, with
 * 'strict-dynamic' so Next.js's nonce'd bootstrap can load its chunks. Next
 * reads the nonce from this header and stamps it on its own scripts; the root
 * layout stamps it on the pre-paint theme script. No 'unsafe-inline' for
 * scripts, no 'unsafe-eval' in production (React needs eval in development).
 *
 * Styles: style elements need the nonce too; style ATTRIBUTES are allowed
 * (style-src-attr 'unsafe-inline') because components pass CSS custom
 * properties (--i, --n) and view-transition names through style="". An
 * attribute cannot execute script.
 */
export function buildCsp(o: { nonce: string; dev: boolean; secure: boolean }): string {
  const d = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${o.nonce}' 'strict-dynamic'${o.dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${o.nonce}'${o.dev ? " 'unsafe-inline'" : ""}`,
    `style-src-elem 'self' 'nonce-${o.nonce}'${o.dev ? " 'unsafe-inline'" : ""}`,
    "style-src-attr 'unsafe-inline'",
    // author avatars are client-supplied https URLs
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self'${o.dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  if (o.secure) d.push("upgrade-insecure-requests");
  return d.join("; ");
}

/** 128 random bits, base64. */
export function newNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}
