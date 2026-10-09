# OpenSEO: actual MCP tools, auth, cost model and self-hosting

Build prompt section 4 asks for OpenSEO's **real** tool names and parameters before coding a
provider against them. Everything here was read on **9 October 2026** from:

- **Source:** `github.com/every-app/open-seo`, shallow clone of `main` at commit
  `89e5a00717cdf049b7c2b4e29646edb3a7d4995b` ("release: v0.1.12 (#891)", committed 8 October 2026).
  The clone lived in the build session's scratchpad and was read as data, never run.
  MCP server: `src/server/mcp/server.ts` (registers every tool), `transport.ts`,
  `api-key-auth.ts`, `context.ts`, `tools/*.ts`. Its `McpServer` reports `version: "0.0.12"`.
- **Live tool schemas:** the `tools/list` of the hosted server `https://app.openseo.so/mcp`, as
  exposed to this build session through the OpenSEO MCP connector. Only the schemas were read;
  **no tool was called** (no credits spent).
- **Docs:** `openseo.so/docs`, `/docs/mcp`, `/docs/self-hosting`, `/pricing`,
  `/terms-and-conditions` (last revised 23 August 2026), and the repository's `docs/*.md`
  (`SELF_HOSTING_DOCKER.md`, `SELF_HOSTING_CLOUDFLARE.md`, `DATAFORSEO_API_KEY.md`).

> The hosted server is slightly newer than the v0.1.12 tag: its `get_serp_results` accepts
> `queries[].device` (`desktop|mobile`) and documents an `organicRank` field that the tagged
> source does not have yet. Our client tolerates both (it ignores unknown fields and sends only
> parameters both versions accept). Re-read `tools/list` from the instance we actually deploy.

## 1. Transport and endpoint

| Item | Value |
| --- | --- |
| Endpoint | `POST <origin>/mcp` (`MCP_ROUTE = "/mcp"`, `src/server/mcp/context.ts`). Hosted: `https://app.openseo.so/mcp`. |
| Transport | MCP **Streamable HTTP**, served by Cloudflare's `agents` SDK `createMcpHandler` (`agents` 0.22.0) over `@modelcontextprotocol/server` 2.0.0. Stateless: no session is kept, `subscriptions/listen` is refused (`maxSubscriptions: 0`). Legacy (pre-2025 protocol) clients get a JSON-mode fallback (`enableJsonResponse: true`). |
| Requests | JSON-RPC 2.0: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`. Responses are `application/json` or a short `text/event-stream`; a client must accept both (`Accept: application/json, text/event-stream`). |
| Tool results | `content[0].text` (a human/LLM summary with a Markdown table) **and** `structuredContent` (the typed payload, validated against each tool's `outputSchema`; extra fields allowed). `isError: true` with a text message on failure. Our client reads `structuredContent` only. |
| Server instructions | "OpenSEO research tools use credits. Proceed with normal focused research, but ask the user for confirmation before planned batches over 2,000 credits. OpenSEO cannot purchase credits or charge cards." |

### Authentication

| Mode (`AUTH_MODE`) | Who uses it | How a caller authenticates on `/mcp` |
| --- | --- | --- |
| `hosted` | openseo.so | OAuth 2.1 (`@cloudflare/workers-oauth-provider`, scope `MCP_SCOPE`), **or** a personal API key `oseo_…` sent as `Authorization: Bearer oseo_…` or `x-api-key` (Settings → API keys; "API keys are personal: anything an agent does with your key acts as you"). Hosted rate limit 5,000 requests/min per user. |
| `local_noauth` | **Docker self-hosting** (`compose.yaml` hard-codes it) | **None.** Every request acts as the built-in `admin@localhost`. The docs: "Only expose it behind your own auth-protected reverse proxy, tunnel, or private network." |
| `cloudflare_access` | Cloudflare self-hosting | A Cloudflare Access JWT (`cf-access-jwt-assertion`, verified against `TEAM_DOMAIN`/`POLICY_AUD`). A server-to-server caller needs a Cloudflare Access **service token** (`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers) allowed by the Access policy. Everyone allowed through Access shares **one workspace**. |

**Self-hosting does expose MCP over HTTP that our worker can call** (`handleSelfHostedOpenSeoMcpRequest`), but
without any authentication of its own in Docker mode. On VPS3 it must sit on the private
`lumoras_internal` network only (never routed by Caddy), or behind Cloudflare Access with a
service token. `OpenSeoProvider` supports both: `OPENSEO_MCP_URL`, optional
`OPENSEO_MCP_TOKEN` (sent as `Authorization: Bearer`, for a hosted key or a proxy in front),
optional `OPENSEO_CF_ACCESS_CLIENT_ID` / `OPENSEO_CF_ACCESS_CLIENT_SECRET`.

### Projects

Every research tool takes a required `projectId` ("Get one from `list_projects`"). A project has a
domain and a default market (`locationCode`, `languageCode`); tools fall back to it when a call
omits them. `list_projects` and `create_project` are free. All clients' work would live in **one**
OpenSEO organization (Docker: `admin@localhost`; Cloudflare: the shared Access workspace), one
project per site.

## 2. Every tool (76 registered in `server.ts` at 89e5a00)

Credits: hosted credits, **1 credit = US$0.001**, charged as
`ceil(rawDataForSeoUsd × 1.28 × 1000)` (`src/shared/billing.ts`: `AUTUMN_SEO_DATA_CREDITS_PER_USD = 1000`,
`SEO_DATA_COST_MARKUP = 1.28`). "Free" = the tool says it uses no credits.

| Group | Tools |
| --- | --- |
| Account, projects (free) | `whoami`, `list_projects`, `create_project`, `research_project_website`, `save_project_website_setup`, `get_project_context`, `update_project_context` |
| Keywords | `research_keywords`, `get_keyword_metrics`, `save_keywords` (free), `list_saved_keywords` (free), `remove_saved_keywords` (free) |
| Domain / SERP | `get_domain_overview`, `get_domain_keyword_suggestions`, `get_ranked_keywords`, `find_serp_competitors`, `get_serp_results`, `search_serp_locations` (free) |
| Backlinks | `get_backlinks_overview`, `get_backlinks_profile` |
| Rank tracking | `create_rank_tracker` (free), `get_rank_tracker` (free), `add_rank_tracking_keywords` (free; scheduled trackers spend later), `remove_rank_tracking_keywords`, `pin_rank_tracking_keywords`, `estimate_rank_tracker_cost` (free), `run_rank_tracker` |
| Site audit | `run_site_audit`, `get_audit_status` (free), `get_audit_issues` (free), `get_audit_pages` (free), `list_site_audits`, `delete_site_audit` |
| Search Console (OpenSEO's own Google connection) | `get_search_console_performance`, `inspect_urls` |
| GA4 (OpenSEO's own Google connection) | `get_google_analytics_organic_landing_pages`, `…_page_performance`, `…_key_events`, `…_organic_overview`, `…_traffic_acquisition`, `…_measurement_health`, `…_ecommerce_performance`, `…_site_search`, `…_audience_breakdown`, `get_search_opportunities` |
| Local SEO | `search_local_businesses`, `get_local_serp_results`, `get_google_business_questions`, `get_business_profile`, `get_business_reviews`, `get_business_updates`, `list_business_categories`, `get_local_rank_grid` |
| AI visibility | `get_ai_visibility_tracker`, `explore_prompt`, `generate_ai_visibility_prompts`, `research_ai_visibility_prompts`, `complete_ai_research_setup`, `save_ai_visibility_tracker`, `estimate_ai_visibility_cost` (free), `set_ai_visibility_schedule`, `run_ai_visibility_check`, `get_ai_visibility_run`, `get_ai_visibility_results`, `get_ai_visibility_answer`, `get_ai_visibility_sources`, `get_ai_visibility_trend`, `export_ai_visibility_data` |
| Reports (free) | `save_report`, `list_reports`, `get_report`, `set_report_sharing`, `delete_report`, `list_report_templates`, `save_report_template`, `delete_report_template` |

## 3. The tools our `SeoDataProvider` maps to

Parameters as served by `tools/list` (JSON Schema). `projectId` is required on all of them.
"→" is the `structuredContent` we read.

| Our operation | OpenSEO tool | Parameters (required in **bold**) | Returns (`structuredContent`) | Documented cost |
| --- | --- | --- | --- | --- |
| `keywordIdeas(seed)` | `research_keywords` | **`seeds[]`** (1–5 of {**`seed`**, `locationCode`, `languageCode`, `locationName`}), `resultLimit` (150 \| 300 \| 500), `includeClickstreamData` (doubles cost), `groupKeywords` | `results[]`: {`seed`, `ok`, `rowCount`, `source`, `usedFallback`, `rows[]`: {`keyword`, `searchVolume`, `keywordDifficulty`, `cpc`, `competition`, `intent`}} or {`seed`, `ok:false`, `error`} | "~54 credits per seed at the default limit, ~110 at 500, +~40 for a fallback lookup" |
| `keywordMetrics(keywords[])` | `get_keyword_metrics` | **`keywords[]`** (1–700, ≤80 chars), `locationCode`, `languageCode`, `includeMonthlyTrends`, `includeClickstreamData`, `sortBy` | `keywords[]`: {`keyword`, `searchVolume`, `cpc`, `competition`, `competitionLevel`, `keywordDifficulty`, `intent`, `monthlySearches[]`} | "Charges credits" (Labs keyword_overview: task + per row) |
| `serp(keyword, location)` | `get_serp_results` | **`queries[]`** (1–10 of {**`keyword`**, `locationCode`, `languageCode`, `locationName`, `device`†}), `depth` (10–100, step 10, default 20) | `results[]`: {`keyword`, `ok`, `items[]`: {`type`, `rank`, `title`, `url`, `domain`, `description`}} | "~5 credits per keyword at depth 20, +~2.5 per extra 10"; repeat within 12 h in the same project is free |
| `domainOverview(domain)` | `get_domain_overview` | **`domain`**, `scope` (`exact_url\|subfolder\|domain\|subdomains`), `locationCode`, `languageCode` | {`domain`, `scope`, `organicTraffic`, `organicKeywords`, `backlinks`, `referringDomains`} | "~100–300 credits typical. Cached for 12 hours per domain." |
| `rankedKeywords(domain)` | `get_ranked_keywords` | **`target`**, `scope`, `locationCode`, `languageCode`, `resultTypes[]`, `minSearchVolume`, `maxRank`, `excludeBrandTerms[]`, `sortBy`, `limit` (1–100, default 50), `offset` | {`keywords[]` (raw DataForSEO Labs items: `keyword_data.keyword`, `keyword_data.keyword_info.search_volume/cpc`, `ranked_serp_element.serp_item.rank_absolute/url`), `totalCount`, `target`, `scope`} | "Charges credits" |
| `serpCompetitors(domain)` | `find_serp_competitors` | **`keywords[]`** (1–100), `excludeDomains[]`, `includeSubdomains`, `resultTypes[]`, `sortBy`, `limit`, `offset`, `locationCode`, `languageCode` | {`competitors[]`} (Labs serp_competitors items) | "Charges credits" |
| `backlinksOverview(domain)` | `get_backlinks_overview` | **`target`**, `scope`, `hideSpam` | {`target`, `scope`, `scopeNote`, `overview`, `referringDomains`} | "~50 credits for a domain, ~25 for a page" |
| `backlinksProfile(domain)` | `get_backlinks_profile` | **`target`**, `scope`, `mode` (`one_per_domain\|as_is`), `filters{…}`, `hideSpam`, `page`, `pageSize` (50/100/200), `sortField`, `sortOrder` | {`target`, `scope`, `backlinks[]`} | "~30 credits per page" |
| `rankTracker.create` | `create_rank_tracker` | `domain`, `devices` (`desktop\|mobile\|both`), `locationCode`, `languageCode`, `locationName`, `scheduleInterval` (`manual\|daily\|weekly\|monthly`, default manual), `scheduleTime{hour, minute, weekday, timeZone}`, `serpDepth` | {`trackerId`, `config`} | free |
| `rankTracker.add` | `add_rank_tracking_keywords` | **`trackerId`**, **`keywords[]`** (≤2000), `matchCase`, `maxEstimatedScheduledCheckCredits` (required for scheduled trackers) | {`added`, …} | free now; scheduled checks spend later |
| `rankTracker.run` | `estimate_rank_tracker_cost` then `run_rank_tracker` | estimate: **`trackerId`**, `additionalKeywords[]`/`additionalKeywordCount`; run: **`trackerId`**, **`maxCostCredits`** ("A fresh estimate above that ceiling is rejected") | estimate: cost in credits; run: {`trackerId`, `started`, `runId` \| `blockingRunId`} (asynchronous: poll `get_rank_tracker`) | live SERP per keyword × device |
| `rankTracker.get` | `get_rank_tracker` | `trackerId`, `offset`, `limit` | {`config`, `results.rows[]`: {`keyword`, `desktop.position`, `mobile.position`, `lastCheckedAt`, …}} or {`configs[]`} | free |
| `siteAudit.run` | `run_site_audit` | **`url`**, `maxPages` (10–10,000, default 50), `runLighthouse`, `renderJavaScript` | {`auditId`} | OpenSEO's **own crawler** (not DataForSEO On-Page); JS rendering is billed on hosted |
| `siteAudit.status` | `get_audit_status` | `auditId` (default: latest) | {`status`: {`id`, `startUrl`, `status`, `currentPhase`, `pagesCrawled`, `pagesTotal`, `lighthouse*`}} | free |
| `siteAudit.issues` | `get_audit_issues` | `auditId`, `issueType` (30 types: `broken-internal-link`, `missing-title`, `duplicate-title`, `title-too-long`, `thin-content`, `orphan-page`, …), `severity` (`critical\|warning\|info`), `limit` | {`summary`, `issues[]`: {`issueType`, `severity`, `title`, `count`, `how_to_fix`, …}} | free |
| `estimateCost(op)` | — | Only `estimate_rank_tracker_cost` and `estimate_ai_visibility_cost` price before a call. Every other tool states an approximate credit range in its description only. | | |
| `balance()` | `whoami` | — | {`userEmail`, `scopes`, `mode` (`hosted\|self-hosted`), `creditsRemaining`} | free; **`creditsRemaining` is always `null` when self-hosted** |

† hosted server only at the time of reading.

## 4. How OpenSEO calls DataForSEO

- `src/server/lib/dataforseo/core.ts`: `https://api.dataforseo.com`, `Authorization: Basic <DATAFORSEO_API_KEY>`
  (base64 of `login:password`). Endpoints used include `dataforseo_labs/google/{keyword_ideas,
  keyword_suggestions, related_keywords, keyword_overview, ranked_keywords, domain_rank_overview,
  serp_competitors, relevant_pages}/live`, `keywords_data/google_ads/{search_volume,
  keywords_for_keywords}/live`, `serp/google/organic/live/advanced` and `task_post`/`task_get`
  (rank checks use the cheaper standard queue), `backlinks/{summary, backlinks, referring_domains,
  history, domain_pages_summary}/live`, `on_page/lighthouse/live/json`, `appendix/user_data`.
- Some reads are cached in R2 (`r2-cache.ts`): SERP results 12 h per project, domain overview and
  domain keyword suggestions 12 h.

## 5. How credits and cost are computed

- `src/server/lib/dataforseo/pricing.ts` holds a **raw-USD upper-bound estimator per endpoint**
  ("read Sep 2026" from the `price` object of the free `GET /v3/appendix/user_data`, plus
  measured per-page costs): Labs $0.012 per task + $0.00012 per row (×2 with clickstream);
  Backlinks $0.024 per request + $0.000036 per row; SERP live $0.002 for the first page of 10,
  $0.0015 per extra page (measured), queued $0.0006 / $0.00045; Google Ads search volume $0.09.
- **Hosted only** (`meterDataforseoCalls` in `client.ts`): reserve `creditsForProviderUsd(estimate)`
  as an atomic hold in Autumn (their billing service), call DataForSEO, then **settle on the
  `cost` DataForSEO actually reports** in the response.
- **Self-hosted: no metering at all.** `if (!isHostedMode) return Promise.allSettled(...)` — calls go
  straight to DataForSEO; the MCP response carries **no per-call cost**, and `whoami` returns
  `creditsRemaining: null`. A self-hosted OpenSEO cannot tell our worker what a call cost or what
  the DataForSEO balance is. Our metering must price every call from its own table and, to know
  the real cost, read DataForSEO directly (`appendix/user_data` balance deltas or `id_list`).

## 6. Search Console and GA4 inside OpenSEO

OpenSEO connects Google per **OpenSEO project** with OpenSEO's own OAuth client
(`docs/SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md`, `…_GOOGLE_ANALYTICS.md`). That does not fit our
model (each client connects their own Google account per site, tokens encrypted in our
`connections` table), so **we do not use OpenSEO's GSC/GA4 tools**; Lumoras Growth talks to
Google directly (Phase 2, `lib/google/`).

## 7. Self-hosting facts that matter for VPS3

- **Docker** (`compose.yaml`, image `ghcr.io/every-app/open-seo:latest`): runs Cloudflare's
  `workerd` through a Vite preview server on port 3001, with local D1/KV/R2 emulated under
  `/app/.wrangler`; "Best for testing it out… for personal use on your own machine". First start
  builds the app (1–2 minutes, `--start-period=300s` health check). `AUTH_MODE=local_noauth`.
  Anonymous telemetry on by default (`OPENSEO_TELEMETRY_DISABLED=1` turns it off). A built-in
  scheduler calls `/cdn-cgi/handler/scheduled` every five minutes for rank checks.
- **Cloudflare** (recommended by the project for internet-facing use): Workers + D1 + KV + R2,
  site audits in a second worker, Cloudflare Access in front.
- Backlinks: "Self-hosted deployments need the Backlinks API enabled on their DataForSEO account."
- License: **MIT** (Copyright (c) 2026 Ben Senescu). The hosted service's Terms of Service state
  they "do not govern any self-hosted or open-source version of OpenSEO".
