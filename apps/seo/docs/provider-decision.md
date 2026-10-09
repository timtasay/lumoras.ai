# SEO data provider: what OpenSEO supports, what the terms allow, and a recommendation

**Owner decision #3 (build prompt section 18) — stop and ask.** This document informs it; it does
not make it. Phase 2 is built provider-agnostic: `SEO_PROVIDER=fake|openseo|dataforseo` picks the
implementation and nothing else changes. No real paid call has been made by this build (there are
no keys in the build environment). Read 9 October 2026; tool details in
[`openseo-tools.md`](openseo-tools.md).

## 1. What our `SeoDataProvider` needs vs. what OpenSEO's MCP API offers

| Our operation (section 4) | OpenSEO tool | Fit | Gap |
| --- | --- | --- | --- |
| `keywordIdeas(seed)` | `research_keywords` | good | Fixed result limits (150/300/500). |
| `keywordMetrics(keywords[])` | `get_keyword_metrics` | good | — |
| `serp(keyword, location)` | `get_serp_results` | good | City-level needs `search_serp_locations` first. |
| `domainOverview(domain)` | `get_domain_overview` | good | — |
| `rankedKeywords(domain)` | `get_ranked_keywords` | good | Max 100 rows per call. |
| `serpCompetitors(domain)` | `find_serp_competitors` | **partial** | Takes a **keyword set**, not a domain. Domain-based competitors (DataForSEO Labs `competitors_domain`) are not exposed. We pass the site's saved/ranked keywords. |
| `backlinksOverview(domain)` | `get_backlinks_overview` | good | Needs the Backlinks API enabled on our DataForSEO account. |
| `backlinksProfile(domain)` | `get_backlinks_profile` | good | Same. |
| `rankTracker.create/add/run/get` | `create_rank_tracker`, `add_rank_tracking_keywords`, `estimate_rank_tracker_cost` + `run_rank_tracker`, `get_rank_tracker` | good, **with a caveat** | Tracker state and history live in OpenSEO's database, not ours; `run` is asynchronous. Section 9 wants rank history on our dashboards (Phase 4), so we would copy snapshots back anyway. |
| `siteAudit.run/status/issues` | `run_site_audit`, `get_audit_status`, `get_audit_issues` | good | OpenSEO's own crawler (crawls the client's site from the OpenSEO server). |
| `estimateCost(operation)` | `estimate_rank_tracker_cost` only | **missing for everything else** | Rule 11 ("priced first where the provider allows it"). We price from our own DataForSEO price table either way. |
| `balance()` | `whoami` | **missing when self-hosted** | `creditsRemaining` is `null` in self-hosted mode. |
| Actual cost of a call | — | **missing when self-hosted** | Self-hosted OpenSEO does not meter and the MCP response carries no cost. We could only ever record our *estimate*, never what DataForSEO billed. Billing-grade metering needs the real figure. |
| Multi-tenant isolation | — | **missing** | One shared OpenSEO workspace for every client (Docker: a single `admin@localhost`; Cloudflare: one shared Access workspace). Project ids are the only separation, and the tools would hold every client's saved keywords, trackers and audits in one place. Our RLS cannot reach into it. |
| Auth for a server-to-server caller | — | **weak** | Docker self-host has **no auth** on `/mcp`; it must be network-isolated. Cloudflare self-host needs an Access service token. |
| GSC / GA4 | `get_search_console_performance`, GA4 tools | **not usable** | Bound to OpenSEO projects and OpenSEO's Google client; we connect each client's own Google account per site ourselves (built in Phase 2). |

**What DataForSEO directly gives that OpenSEO does not:** every response carries the billed `cost`
(USD) per task; `GET /v3/appendix/user_data` (free) returns `money.balance` and the account's
per-endpoint `price` table (`cost_type` per request or per result); `competitors_domain`; the
On-Page API (`on_page/task_post` + `summary`) for audits; a free sandbox host
(`sandbox.dataforseo.com`) with dummy data for integration checks. DataForSEO has **no
"price this call" endpoint**: pricing before a call means applying the price table to the request
(task price + rows × row price, × pages for SERP depth), which is what we do for every provider.

## 2. What each Terms of Service says about serving data to our own clients

### OpenSEO (hosted service; openseo.so) — read 9 October 2026

Source: <https://openseo.so/terms-and-conditions>, "**Last revised on: 8/23/2026**", Every App, Inc.

> **2.1 License.** "Subject to these Terms, Company grants you a non-transferable, non-exclusive,
> revocable, limited license to use and access the Site and the hosted OpenSEO services for your
> personal use and your business purposes, including SEO work for your own websites and for your
> clients. You may export the reports and results you generate and use them in your own work and
> in client deliverables; you may not resell them as a standalone data product or use them to
> build a competing product or service."

> **2.2 Certain Restrictions.** "(a) except as permitted by Section 2.1, you shall not license,
> sell, rent, lease, transfer, assign, distribute, host, or otherwise commercially exploit the
> Site, whether in whole or in part, or any content displayed on the Site; … (c) you shall not
> access the Site in order to build a similar or competitive website, product, or service"

> Preamble: "For the avoidance of doubt, these Terms do not govern any self-hosted or open-source
> version of OpenSEO, which is made available separately under the MIT License."

Pricing page (<https://openseo.so/pricing>, read the same day): "Base Plan … $10/mo … Includes $10
of usage every month"; API keys "are personal: anything an agent does with your key acts as you"
(<https://openseo.so/docs/mcp>).

**Reading:** agency use ("SEO work … for your clients", "client deliverables") is expressly
allowed on the hosted plan. Wiring the **hosted** account into a multi-client product where clients
log in and run research themselves is, in our view, **not covered**: Lumoras Growth is an SEO
platform (arguably "a competing product or service", 2.1 and 2.2(c)), and 2.2(a) bars
distributing or hosting the Site's content except as 2.1 allows. Do not build on the hosted
account. The **self-hosted** MIT code carries no such restriction (MIT permits use, modification
and commercial use, keeping the copyright notice).

### DataForSEO — read 9 October 2026

Source: <https://dataforseo.com/terms-of-service>, "**UPDATED: 12 JUNE, 2026**", DataForSEO OU (Estonia).

> **7.1** "You acknowledge and agree that any search engine results page (SERP) data or content
> obtained through the Service, including but not limited to data from Google, Bing, Yahoo, and
> other search engine providers, shall not be used to compete with or adversely affect the business
> interests of the search engine providers from which such data originates."

> **7.2** "You agree to indemnify, defend, and hold harmless DataForSEO from any and all claims,
> damages and losses arising from or relating to Your violation of Section 7.1, including any use
> of SERP data that violates the terms of service or legal rights of the search engine providers."

> **8.1** "… Certain services provided by DataForSEO are resold. DataForSEO holds no responsibility
> for the use of our clients' accounts. Failure to comply with any terms or conditions will result
> in the automatic deactivation of the account in question. We reserve the right to remove any
> account, without advance notice for any reason without restitution, as DataForSEO sees fit."

> **3.3** "… DataForSEO reserves the right to contact You about special pricing if You maintain an
> exceptionally high number of end-users …"

> **8.2** "… if You set identical API tasks, this is considered a user-side error. … DataForSEO will
> not issue refunds for tasks affected by user-side errors" (our cache and rule 4 exist for this).

**Reading:** the ToS has **no clause on resale, white-labelling or redistribution** of API data to
end clients — it neither permits nor forbids it. It contemplates end-users (3.3) and markets
"SEO Agency" and "SEO Software" solutions. The one data-use restriction (7.1) is about not
competing with or harming search engines, which an SEO content tool does not do. Account
termination is at DataForSEO's discretion (8.1). **This is ambiguous by silence**: before charging
clients for research, get DataForSEO's written confirmation that a multi-client agency platform
on one API account (our clients never see DataForSEO credentials or raw API access) is fine, and
whether they want a reseller/enterprise agreement. The GDPR DPA is incorporated by reference;
our requests contain keywords and domains, not personal data.

**Not legal advice;** quotes are verbatim from the pages on the date above and should be re-read
before launch.

## 3. Operational trade-offs

| | A. Self-hosted OpenSEO on VPS3 (+ our DataForSEO key) | B. DataForSEO directly |
| --- | --- | --- |
| What runs | A second app (Node 22 + `workerd` via Vite preview, local D1/KV/R2 files, first boot builds ~7,400 modules with a raised V8 heap), a volume, its own scheduler, its own migrations; or a Cloudflare account with Workers/D1/R2/Access | Nothing extra: HTTPS calls from our worker |
| Auth | Docker: none — must be unreachable except from our containers; Cloudflare: Access service token | HTTP Basic with our API login, from env, server-side only |
| Cost accounting | Estimate only; **no actual cost, no balance** from OpenSEO | Actual `cost` per task in every response; balance from `appendix/user_data` |
| Price before call | Our table (same as B), plus `estimate_rank_tracker_cost` | Our table, refreshed from the account's own `price` object |
| Data location | Every client's research also stored in OpenSEO's single workspace | Only in our Postgres, under RLS |
| Upgrades | Track OpenSEO releases (frequent; tool schemas drift — the hosted server already differs from v0.1.12) | Track DataForSEO API v3 (stable, versioned) |
| Telemetry | On by default; must set `OPENSEO_TELEMETRY_DISABLED=1` | None |
| Extra features we would get | Its site-audit crawler with `how_to_fix`, AI-visibility, local SEO, the Lighthouse runs, the agent skills | On-Page API for audits (priced per page), everything else via the same API |
| Effort for us | MCP client + project mapping (built) + running/upgrading a second service | REST client (built) |
| Failure modes | Two hops (worker → OpenSEO → DataForSEO); a schema change in OpenSEO breaks us silently | One hop |

Both cost the same DataForSEO list prices (self-hosted OpenSEO adds no markup; the hosted service
adds 28%).

## 4. Recommendation (for the owner to accept or change)

**B: call DataForSEO directly, with our own key, as the production provider; keep OpenSEO as an
optional adapter.** Reasons, in order:

1. **Billing-grade metering needs the real cost and the balance.** Rule 11 and section 4 want every
   call priced, charged to a ledger and checked against a balance. Self-hosted OpenSEO returns
   neither the cost nor the balance; DataForSEO returns both on every call.
2. **Tenant isolation.** OpenSEO keeps one shared workspace for all clients; DataForSEO is
   stateless, so every client's research lives only in our RLS-protected tables.
3. **Less to operate and secure on VPS3.** No unauthenticated MCP endpoint to fence off, no second
   app, scheduler, volume and upgrade cadence.
4. **The terms point the same way.** The hosted OpenSEO plan must not be used for this (2.1/2.2);
   self-hosted MIT is fine legally but gains us little over B.

Keep `OpenSeoProvider` (built and tested against a local fake MCP server) for the owner's own
manual work or if OpenSEO's audit/AI-visibility tooling becomes worth running later. The
current personal $10/month hosted plan should stay personal.

### Questions for the owner (decision #3)

1. Approve B (DataForSEO direct, `SEO_PROVIDER=dataforseo`) — or choose A (self-hosted OpenSEO)?
2. Will you ask DataForSEO in writing whether a multi-client agency platform on one API account is
   acceptable, and whether they want a reseller agreement? (Section 2: their ToS is silent.)
3. Enable the Backlinks API on the DataForSEO account (needed by either option for backlinks)?
4. A spending limit on the DataForSEO account itself (their dashboard supports daily/minute
   limits) as a second fuse behind our per-workspace budgets?
