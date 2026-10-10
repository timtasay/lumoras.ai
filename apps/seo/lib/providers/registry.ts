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
      return new OpenSeoProvider({ url: cfg.url, mode: cfg.mode, token: cfg.token, cfAccess: cfg.cfAccess, defaultProjectId: cfg.defaultProjectId });
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
export type ProviderInfo = {
  name: ProviderName | "none";
  label: string;
  demo: boolean;
  endpoint: string | null;
  /** OpenSEO only. */
  mode?: "hosted" | "selfhosted";
  /** OpenSEO only: the default project (OPENSEO_PROJECT_ID), when set. */
  defaultProject?: string | null;
  /** For platform admins: the terms that bound how this provider may be used (owner decision #3). */
  termsNote?: string;
};

/**
 * OpenSEO's hosted terms (openseo.so/terms-and-conditions, last revised 23 August 2026, 2.1 and 2.2) allow
 * SEO work for your own websites and for your clients, not building a competing product (owner-decisions.md).
 */
export const OPENSEO_HOSTED_TERMS =
  "Hosted OpenSEO terms allow SEO work for your own websites and for your clients, but not using it to build a competing product or service. Use it for Lumoras's own sites and staff-run client work now. Before clients run research themselves, get OpenSEO's written OK or move to self-hosted OpenSEO (MIT, same tools) with a DataForSEO key.";

export function providerInfo(): ProviderInfo {
  const cfg = webEnv().seoProvider;
  switch (cfg.kind) {
    case "none":
      return { name: "none", label: "Not configured", demo: false, endpoint: null };
    case "fake":
      return { name: "fake", label: "Demo data (fake provider)", demo: true, endpoint: null };
    case "openseo": {
      const u = new URL(cfg.url);
      const hosted = cfg.mode === "hosted";
      return {
        name: "openseo",
        label: hosted ? "OpenSEO (hosted, MCP)" : "OpenSEO (self-hosted, MCP)",
        demo: false,
        endpoint: `${u.origin}${u.pathname}`,
        mode: cfg.mode,
        defaultProject: cfg.defaultProjectId,
        ...(hosted ? { termsNote: OPENSEO_HOSTED_TERMS } : {}),
      };
    }
    case "dataforseo":
      return { name: "dataforseo", label: "DataForSEO (direct)", demo: false, endpoint: cfg.baseUrl };
  }
}
