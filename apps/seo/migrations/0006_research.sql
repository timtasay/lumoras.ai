-- 0006 research
-- Phase 2: paid SEO data behind a budget, a usage ledger, a research log, a
-- result cache, a seed backlog and saved keywords; Google Search Console and
-- GA4 connections (one per site and kind).
--
-- Every table here is a tenant table: workspace_id, row-level security
-- ENABLED and FORCED with the same policy as 0004, a SELECT-only platform
-- policy for the owner role, and the audit trigger (0003). Large JSON results
-- are redacted to a fingerprint in the audit trail.
--
-- Money is stored as integer micro-US-dollars ("micros", µUSD):
-- 1 USD = 1,000,000 micros. DataForSEO prices go down to $0.000036 per row,
-- which is 36 micros, so nothing is ever rounded to a fraction. bigint holds
-- 9.2 × 10^12 dollars.

-- ---------------------------------------------------------------------------
-- Rule 4: never re-run a seed younger than this many days (per site).
-- ---------------------------------------------------------------------------
ALTER TABLE sites ADD COLUMN research_max_age_days integer NOT NULL DEFAULT 90
  CHECK (research_max_age_days BETWEEN 1 AND 730);

-- ---------------------------------------------------------------------------
-- Budgets: a monthly ceiling and a reserve per workspace and category.
--   seo_credits   paid SEO data, in micros
--   llm_tokens    model usage (Phase 3), in micros
--   social_posts  posts (Phase 5), in posts
-- A call is refused when it would leave less than the reserve of this month's
-- ceiling. No row means a ceiling of 0: nothing paid runs until an owner sets one.
-- ---------------------------------------------------------------------------
CREATE TABLE budgets (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  category         text        NOT NULL CHECK (category IN ('seo_credits', 'llm_tokens', 'social_posts')),
  monthly_ceiling  bigint      NOT NULL DEFAULT 0 CHECK (monthly_ceiling BETWEEN 0 AND 100000000000000),
  reserve          bigint      NOT NULL DEFAULT 0 CHECK (reserve >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (reserve <= monthly_ceiling),
  UNIQUE (workspace_id, category)
);
COMMENT ON TABLE budgets IS 'Monthly ceiling and reserve per workspace and category. seo_credits/llm_tokens in micro-USD, social_posts in posts.';

-- ---------------------------------------------------------------------------
-- Research log (rule 4): every seed, keyword, SERP and domain lookup, with
-- what it cost, whether it came from the cache, and the normalised result,
-- so the same research is never bought twice. Append-only for the app.
-- ---------------------------------------------------------------------------
CREATE TABLE research_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL,
  site_id          uuid        NOT NULL,
  operation        text        NOT NULL CHECK (operation ~ '^[a-zA-Z]+(\.[a-zA-Z]+)?$'),
  provider         text        NOT NULL CHECK (provider IN ('fake', 'openseo', 'dataforseo')),
  -- normalised seed for keywordIdeas (rule 4 looks it up), else NULL
  seed             text        CHECK (seed IS NULL OR length(seed) BETWEEN 1 AND 200),
  -- what was asked about, for people: the seed, keyword(s) or domain
  subject          text        NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
  market           text        NOT NULL DEFAULT '' CHECK (length(market) <= 120),
  params           jsonb       NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  params_hash      text        NOT NULL CHECK (params_hash ~ '^[0-9a-f]{64}$'),
  status           text        NOT NULL CHECK (status IN ('ok', 'cached', 'refused', 'error')),
  estimate_micros  bigint      NOT NULL DEFAULT 0 CHECK (estimate_micros >= 0),
  cost_micros      bigint      NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  result_count     integer     NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  result           jsonb,
  detail           text        CHECK (detail IS NULL OR length(detail) <= 500),
  actor_id         text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('ok', 'error') OR cost_micros = 0),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX research_log_site_idx ON research_log (site_id, created_at DESC);
CREATE INDEX research_log_seed_idx ON research_log (site_id, seed, market, created_at DESC) WHERE seed IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Usage ledger: every billable unit, by workspace, site and category.
-- A paid call first HOLDS its estimate (so concurrent calls cannot overspend),
-- then is SETTLED at the provider's actual cost, or RELEASED if nothing was
-- billed. Settled and released rows are immutable; the app cannot delete.
-- ---------------------------------------------------------------------------
CREATE TABLE usage_ledger (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id     uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  site_id          uuid,
  category         text        NOT NULL CHECK (category IN ('seo_credits', 'llm_tokens', 'social_posts')),
  operation        text        NOT NULL CHECK (length(operation) <= 60),
  provider         text        NOT NULL CHECK (length(provider) <= 40),
  -- first day of the UTC month the usage counts against
  period           date        NOT NULL CHECK (extract(day FROM period) = 1),
  status           text        NOT NULL CHECK (status IN ('held', 'settled', 'released')),
  cached           boolean     NOT NULL DEFAULT false,
  units            bigint      NOT NULL DEFAULT 0 CHECK (units >= 0),
  estimate_micros  bigint      NOT NULL DEFAULT 0 CHECK (estimate_micros >= 0),
  -- held: the amount held (= estimate); settled: what was actually charged; released: 0
  cost_micros      bigint      NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  research_log_id  uuid,
  actor_id         text        NOT NULL,
  detail           text        CHECK (detail IS NULL OR length(detail) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  settled_at       timestamptz,
  CHECK (status <> 'released' OR cost_micros = 0),
  CHECK (NOT cached OR cost_micros = 0),
  -- the ledger outlives a deleted site (the money was spent): site_id becomes NULL
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE SET NULL (site_id)
);
CREATE INDEX usage_ledger_period_idx ON usage_ledger (workspace_id, category, period);
CREATE INDEX usage_ledger_recent_idx ON usage_ledger (workspace_id, created_at DESC);
COMMENT ON TABLE usage_ledger IS 'Billable usage. cost_micros in micro-USD (1 USD = 1,000,000). Holds become settled or released; settled rows never change.';

CREATE FUNCTION usage_ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- a settled or released entry is final (only a deleted site may null its site_id)
  IF OLD.status <> 'held' AND (to_jsonb(NEW) - 'site_id') IS DISTINCT FROM (to_jsonb(OLD) - 'site_id') THEN
    RAISE EXCEPTION 'usage_ledger: entry % is % and cannot change', OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.category <> OLD.category OR NEW.period <> OLD.period
     OR NEW.estimate_micros <> OLD.estimate_micros OR NEW.created_at <> OLD.created_at OR NEW.actor_id <> OLD.actor_id THEN
    RAISE EXCEPTION 'usage_ledger: entry % may only be settled or released', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE UPDATE ON usage_ledger FOR EACH ROW EXECUTE FUNCTION usage_ledger_guard();

-- ---------------------------------------------------------------------------
-- Provider cache: results by operation + normalised parameters, with an
-- expiry. WORKSPACE-SCOPED by design: a hit is free, so a cache shared across
-- clients would tell one client that another had researched the same thing
-- (and one client's spend would subsidise another's). Each workspace pays for
-- its own data once; RLS hides every other workspace's entries.
-- ---------------------------------------------------------------------------
CREATE TABLE provider_cache (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  cache_key     text        NOT NULL CHECK (cache_key ~ '^[0-9a-f]{64}$'),
  operation     text        NOT NULL CHECK (length(operation) <= 60),
  provider      text        NOT NULL CHECK (length(provider) <= 40),
  params        jsonb       NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  result        jsonb       NOT NULL,
  cost_micros   bigint      NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  UNIQUE (workspace_id, cache_key)
);

-- ---------------------------------------------------------------------------
-- Seed backlog (rule 4): seeds waiting to be researched, rotated so the
-- oldest-researched and highest-priority seeds come up first.
-- ---------------------------------------------------------------------------
CREATE TABLE seed_backlog (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL,
  site_id             uuid        NOT NULL,
  seed                text        NOT NULL CHECK (length(seed) BETWEEN 1 AND 80),
  priority            smallint    NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  status              text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'researched', 'skipped')),
  note                text        NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  last_researched_at  timestamptz,
  research_count      integer     NOT NULL DEFAULT 0 CHECK (research_count >= 0),
  added_by            text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, seed),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Saved keywords with metrics, intent, cluster and status.
-- ---------------------------------------------------------------------------
CREATE TABLE keywords (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL,
  site_id             uuid        NOT NULL,
  -- normalised (lib/research/keywords.ts normalizeKeyword)
  keyword             text        NOT NULL CHECK (length(keyword) BETWEEN 1 AND 200),
  market              text        NOT NULL DEFAULT '' CHECK (length(market) <= 120),
  search_volume       integer     CHECK (search_volume >= 0),
  keyword_difficulty  smallint    CHECK (keyword_difficulty BETWEEN 0 AND 100),
  cpc_micros          bigint      CHECK (cpc_micros >= 0),
  competition         numeric(4, 3) CHECK (competition BETWEEN 0 AND 1),
  intent              text        CHECK (intent IN ('informational', 'navigational', 'commercial', 'transactional')),
  cluster             text        NOT NULL DEFAULT '' CHECK (length(cluster) <= 80),
  -- near-duplicate / geographic variant group (rule 6)
  variant_key         text        NOT NULL DEFAULT '' CHECK (length(variant_key) <= 200),
  status              text        NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'targeted', 'published', 'ranking')),
  -- rule 7: against the brand profile's sells / does-not-sell lists
  fit                 text        NOT NULL DEFAULT 'unknown' CHECK (fit IN ('offered', 'not_offered', 'unknown')),
  source_log_id       uuid        REFERENCES research_log (id) ON DELETE SET NULL,
  metrics_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, keyword, market),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX keywords_site_idx ON keywords (site_id, status);

-- ---------------------------------------------------------------------------
-- Google Search Console and GA4: one connection per site and kind.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX connections_google_once ON connections (site_id, kind) WHERE kind IN ('search_console', 'ga4');

-- ---------------------------------------------------------------------------
-- Row-level security: enabled AND forced, one tenant policy, platform read.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budgets', 'research_log', 'usage_ledger', 'provider_cache', 'seed_backlog', 'keywords'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t || '_tenant_isolation', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO pg_database_owner USING (true)', t || '_platform_read', t);
  END LOOP;
END $$;

-- research_log and usage_ledger are append-only for the app role (a ledger
-- hold is settled by UPDATE, guarded above); revoke what the default
-- privileges granted. Cascades from a deleted workspace or site run as the
-- owner and still work.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT grantee, table_name FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name IN ('research_log', 'usage_ledger') AND grantee <> current_user
      AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
  LOOP
    IF r.table_name = 'usage_ledger' THEN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON usage_ledger FROM %I', r.grantee);
    ELSE
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON research_log FROM %I', r.grantee);
    END IF;
  END LOOP;
END $$;
REVOKE DELETE, TRUNCATE ON usage_ledger FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON research_log FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- updated_at and audit
-- ---------------------------------------------------------------------------
CREATE TRIGGER touch BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON seed_backlog FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON keywords FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON budgets
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON usage_ledger
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON research_log
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id', 'result');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON provider_cache
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id', 'result');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON seed_backlog
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON keywords
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');

-- ---------------------------------------------------------------------------
-- Agency home: SEO spend this month per workspace (platform admins only,
-- audited like every platform_* read).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_workspace_budgets()
  RETURNS TABLE (workspace_id uuid, category text, monthly_ceiling bigint, reserve bigint, used bigint)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM platform_require_admin();
  PERFORM app_audit_event('platform.budgets.read', 'budgets', NULL, NULL);
  RETURN QUERY
    SELECT b.workspace_id, b.category, b.monthly_ceiling, b.reserve,
      coalesce((SELECT sum(l.cost_micros) FROM usage_ledger l
        WHERE l.workspace_id = b.workspace_id AND l.category = b.category AND l.status IN ('held', 'settled')
          AND l.period = date_trunc('month', now() AT TIME ZONE 'UTC')::date), 0)::bigint
    FROM budgets b
    ORDER BY b.workspace_id, b.category;
END $$;
REVOKE EXECUTE ON FUNCTION platform_workspace_budgets(), usage_ledger_guard() FROM PUBLIC;
