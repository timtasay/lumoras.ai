/**
 * The one place a provider is chosen (SEO_PROVIDER, lib/env.ts). The instance
 * lives for the process; credentials stay inside it and never reach a page,
 * a log line or a model.
 */
import { webEnv } from "../config.ts";
import type { SeoProviderEnv } from "../env.ts";
import { DataForSeoProvider } from "./dataforseo.ts";
import { FakeProvider } from "./fake.ts";
import { OpenSeoProvider } from "./openseo.ts";
import type { ProviderName, SeoDataProvider } from "./types.ts";

export function createProvider(cfg: SeoProviderEnv): SeoDataProvider | null {
  switch (cfg.kind) {
    case "none":
      return null;
    case "fake":
      return new FakeProvider();
    case "openseo":
      return new OpenSeoProvider({ url: cfg.url, token: cfg.token, cfAccess: cfg.cfAccess });
    case "dataforseo":
      return new DataForSeoProvider({ login: cfg.login, password: cfg.password, baseUrl: cfg.baseUrl });
  }
}

const g = globalThis as { __seoProvider?: SeoDataProvider | null };

/** The configured provider, or null when none is (paid research is then unavailable, and the UI says so). */
export function provider(): SeoDataProvider | null {
  if (g.__seoProvider === undefined) g.__seoProvider = createProvider(webEnv().seoProvider);
  return g.__seoProvider;
}

/** Safe facts about the provider for screens: never a credential. */
export type ProviderInfo = { name: ProviderName | "none"; label: string; demo: boolean; endpoint: string | null };

export function providerInfo(): ProviderInfo {
  const cfg = webEnv().seoProvider;
  switch (cfg.kind) {
    case "none":
      return { name: "none", label: "Not configured", demo: false, endpoint: null };
    case "fake":
      return { name: "fake", label: "Demo data (fake provider)", demo: true, endpoint: null };
    case "openseo": {
      const u = new URL(cfg.url);
      return { name: "openseo", label: "OpenSEO (self-hosted, MCP)", demo: false, endpoint: `${u.origin}${u.pathname}` };
    }
    case "dataforseo":
      return { name: "dataforseo", label: "DataForSEO (direct)", demo: false, endpoint: cfg.baseUrl };
  }
}
