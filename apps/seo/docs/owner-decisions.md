# Owner decisions

Answers from the owner, recorded so every phase builds on them. Newest first.

## 10 October 2026

| # | Question | Decision | Follow-up |
| --- | --- | --- | --- |
| Bylines (Phase 3 Q1) | Rule 10 asks for real people; the content spec signs "Lumoras team". | **"Lumoras team" is acceptable.** | Allow an organization byline: published as `Organization` (not `Person`) in structured data, still configured per site by the client, never invented. |
| lumoras.ai publishing (Phase 3 Q2) | Repo, token, PR or direct commit? | **`timtasay/lumoras.ai` is correct.** The owner issues a fine-grained token (Contents + Pull requests, that repo only). **Pull requests** (the default). | Point the lumoras.ai Git publisher at the real repo; the token goes into the app's encrypted connection, never into git or chat. |
| AI budget (Phase 3 Q4) | Who pays for model usage? | **Lumoras's own Anthropic account** pays. | Set `LLM_PROVIDER=anthropic` with an API key from the Claude Console in the server env file. Per-workspace `llm_tokens` budgets stay as a safety cap and for per-client cost reporting. |
| Autopilot (Phase 3 Q5) | May clients use autopilot? | **Yes, for any Lumoras client.** | No code change: autopilot stays off by default per site and needs the recorded acknowledgement to switch on. |
| Reviewer role (Phase 1 Q2) | Who approves content on the client side? | **A separate Reviewer role** (built in Phase 3). | Whether reviewer accounts count as paid seats is a pricing question for Phase 6. |
| SEO data provider (#3) | OpenSEO or DataForSEO direct? | **OpenSEO**, using the owner's existing account. | Add a hosted mode to `OpenSeoProvider` (API key from server env, projectId per site). Hosted terms allow "SEO work … for your own websites and for your clients" but bar using it "to build a competing product or service" (see `provider-decision.md`), so: use it for Lumoras's own sites and staff-run client work now; before clients run research themselves, get OpenSEO's written OK or move to self-hosted OpenSEO (MIT, same tools) with a DataForSEO key. |

## Still open

- **#1 Product name and host name** ("Lumoras Growth", `growth.lumoras.ai` are placeholders). Also blocks the Google OAuth client.
- **#2 sonorch.ai and seasonx.ai publishing:** migrate their posts to one Markdown file per post, or build an adapter that edits their typed `posts.ts` list.
- **#4 Social networks** and native APIs vs an aggregator (Phase 5).
- **#5 Pricing and plans**, including whether reviewer seats are paid (Phase 6).
- Phase 1: who can create workspaces; session, invitation, sign-in link and impersonation lifetimes.
- Phase 2: default SEO budget for new workspaces; per-workspace cache (current) vs shared; cache ages.
- Phase 3: monthly `llm_tokens` budget and reserve per workspace.
