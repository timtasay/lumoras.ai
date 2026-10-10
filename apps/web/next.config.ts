import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@lumoras/ui-tokens", "@lumoras/ui-field"],
  // Content is read from ./content at build time; make sure it ships with server output.
  outputFileTracingIncludes: {
    "/**": ["./content/**/*"],
  },
  // The old lumoras.ai served its terms at /tos; old links may still point there.
  // Retired in-store audio pages (Lumoras Sound was discontinued). Permanent, so search engines move on.
  async redirects() {
    return [
      { source: "/tos", destination: "/terms", permanent: true },
      {
        source: "/knowledge-base/overhead-paging-and-store-announcements",
        destination: "/knowledge-base/where-is-my-order-calls",
        permanent: true,
      },
      { source: "/insights/music-for-retail-stores", destination: "/insights", permanent: true },
      { source: "/insights/audio-branding-for-stores", destination: "/insights", permanent: true },
      { source: "/help-center/set-up-store-zones", destination: "/help-center", permanent: true },
      { source: "/help-center/schedule-announcements", destination: "/help-center", permanent: true },
    ];
  },
};

export default nextConfig;
