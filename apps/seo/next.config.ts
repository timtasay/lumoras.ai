import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@lumoras/ui-tokens", "@lumoras/ui-field"],
  // pg is server-only and loads optional native bindings lazily; keep it out of the bundle.
  serverExternalPackages: ["pg"],
  // Browsers still probe /favicon.ico on some navigations even with <link rel="icon">;
  // answer with the app icon instead of a 404 (which shows up as a console error).
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.svg" }];
  },
  async headers() {
    // Baseline headers. The strict Content Security Policy (nonce-based, so the
    // pre-paint theme script keeps working) lands with auth in Phase 1.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
