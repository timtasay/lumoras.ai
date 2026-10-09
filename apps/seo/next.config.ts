import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@lumoras/ui-tokens", "@lumoras/ui-field"],
  // pg is server-only and loads optional native bindings lazily; keep it out of the bundle.
  serverExternalPackages: ["pg"],
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
