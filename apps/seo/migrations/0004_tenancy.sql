-- 0004 tenancy
-- Workspaces and the Phase 1 tenant tables. Every table here carries
-- workspace_id and has row-level security ENABLED and FORCED, with one policy:
--
--   workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
--
-- app.workspace_id is set transaction-locally by lib/db/tenant.ts
-- (withWorkspace). With nothing set the expression is NULL, so a query that
-- forgets the workspace sees no rows and cannot write any.
--
-- A workspace IS a Better Auth organization: workspaces.id = auth_organization.id
-- (created by trigger in the same transaction as the organization).
--
-- The owner role additionally gets SELECT-only policies (TO pg_database_owner):
-- that is the platform-admin read path, reachable by the app only through the
-- audited SECURITY DEFINER functions in 0005. Foreign-key cascades run as the
-- owner and are not filtered by row-level security.
--
-- Composite foreign keys (workspace_id, site_id) → sites (workspace_id, id)
-- make it impossible to attach a row to another workspace's site.

CREATE TABLE workspaces (
  id                  uuid        PRIMARY KEY REFERENCES auth_organization (id) ON DELETE CASCADE,
  status              text        NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'paused')),
  -- furthest onboarding step reached (lib/onboarding.ts)
  onboarding_step     text        NOT NULL DEFAULT 'site'
                      CHECK (onboarding_step IN ('site', 'scan', 'brand', 'authors', 'search', 'publishing', 'schedule', 'done')),
  onboarding_site_id  uuid,
  onboarded_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sites (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- bare lowercase host name: no scheme, port, path or trailing dot
  domain             text        NOT NULL CHECK (length(domain) <= 253 AND domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$'),
  name               text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  industry           text        NOT NULL DEFAULT '' CHECK (length(industry) <= 80),
  locale             text        NOT NULL DEFAULT 'en-US' CHECK (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  country            text        NOT NULL DEFAULT 'US' CHECK (country ~ '^[A-Z]{2}$'),
  serp_location      text        NOT NULL DEFAULT 'United States' CHECK (length(serp_location) <= 120),
  timezone           text        NOT NULL DEFAULT 'UTC' CHECK (length(timezone) <= 64),
  status             text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  last_crawl_at      timestamptz,
  last_crawl_status  text        CHECK (last_crawl_status IN ('ok', 'partial', 'failed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, domain),
  UNIQUE (workspace_id, id)
);

ALTER TABLE workspaces ADD CONSTRAINT workspaces_onboarding_site_fk
  FOREIGN KEY (id, onboarding_site_id) REFERENCES sites (workspace_id, id) ON DELETE SET NULL (onboarding_site_id);

CREATE TABLE brand_profiles (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL,
  site_id           uuid        NOT NULL UNIQUE,
  overview          text        NOT NULL DEFAULT '' CHECK (length(overview) <= 4000),
  current_goal      text        NOT NULL DEFAULT '' CHECK (length(current_goal) <= 2000),
  positioning       text        NOT NULL DEFAULT '' CHECK (length(positioning) <= 2000),
  audience          text        NOT NULL DEFAULT '' CHECK (length(audience) <= 2000),
  sells             text[]      NOT NULL DEFAULT '{}',
  does_not_sell     text[]      NOT NULL DEFAULT '{}',
  competitors       text[]      NOT NULL DEFAULT '{}',
  -- [{ "url": "...", "title": "...", "description": "..." }]
  key_pages         jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(key_pages) = 'array'),
  product_facts     text[]      NOT NULL DEFAULT '{}',
  forbidden_claims  text[]      NOT NULL DEFAULT '{}',
  voice_rules       text[]      NOT NULL DEFAULT '{}',
  -- title/description length, body length range, internal link count (lib/validation.ts SeoRules)
  seo_rules         jsonb       NOT NULL DEFAULT '{"titleMax":60,"descriptionMin":140,"descriptionMax":155,"bodyMinWords":700,"bodyMaxWords":1100,"internalLinksMin":3,"internalLinksMax":6}'
                    CHECK (jsonb_typeof(seo_rules) = 'object'),
  banned_words      text[]      NOT NULL DEFAULT '{}',
  example_articles  text[]      NOT NULL DEFAULT '{}',
  prefilled_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);

-- Bylines: real people only, configured by the client. No generated titles or credentials.
CREATE TABLE authors (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  site_id       uuid        NOT NULL,
  name          text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  role          text        NOT NULL DEFAULT '' CHECK (length(role) <= 120),
  bio           text        NOT NULL DEFAULT '' CHECK (length(bio) <= 2000),
  avatar_url    text        CHECK (avatar_url IS NULL OR (avatar_url ~ '^https://' AND length(avatar_url) <= 2048)),
  -- seed data only: shown with a "Demo" badge and never used for a real byline
  is_demo       boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX authors_site_idx ON authors (site_id);

-- The route inventory, crawled from the site's sitemaps (lib/crawl).
CREATE TABLE site_routes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL,
  site_id        uuid        NOT NULL,
  url            text        NOT NULL CHECK (length(url) <= 2048),
  path           text        NOT NULL,
  lastmod        timestamptz,
  source         text,
  discovered_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, url),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE crawl_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  site_id       uuid        NOT NULL,
  status        text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  sitemaps      integer     NOT NULL DEFAULT 0,
  urls          integer     NOT NULL DEFAULT 0,
  problems      jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(problems) = 'array'),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX crawl_runs_site_idx ON crawl_runs (site_id, started_at DESC);

-- External connections per site. credentials_ciphertext is AES-256-GCM
-- (lib/crypto/secrets.ts) under key key_version; it never leaves the server.
CREATE TABLE connections (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid        NOT NULL,
  site_id                 uuid        NOT NULL,
  kind                    text        NOT NULL CHECK (kind IN ('git', 'wordpress', 'webflow', 'ghost', 'webhook', 'search_console', 'ga4', 'social')),
  label                   text        NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  config                  jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
  credentials_ciphertext  text,
  key_version             integer     CHECK (key_version > 0),
  status                  text        NOT NULL DEFAULT 'untested' CHECK (status IN ('untested', 'ok', 'warn', 'error')),
  status_detail           text,
  last_tested_at          timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK ((credentials_ciphertext IS NULL) = (key_version IS NULL)),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX connections_site_idx ON connections (site_id);

-- Minimal in-app notifications (Phase 1: crawl finished, member joined).
CREATE TABLE notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES auth_user (id) ON DELETE CASCADE,
  kind          text        NOT NULL CHECK (length(kind) <= 64),
  title         text        NOT NULL CHECK (length(title) <= 200),
  body          text        NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  href          text        CHECK (href IS NULL OR href ~ '^/'),
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row-level security: enabled AND forced (the owner is bound too).
-- ---------------------------------------------------------------------------
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY workspaces_tenant_isolation ON workspaces
  USING (id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY workspaces_platform_read ON workspaces FOR SELECT TO pg_database_owner USING (true);

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;
CREATE POLICY sites_tenant_isolation ON sites
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY sites_platform_read ON sites FOR SELECT TO pg_database_owner USING (true);

ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_profiles_tenant_isolation ON brand_profiles
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY brand_profiles_platform_read ON brand_profiles FOR SELECT TO pg_database_owner USING (true);

ALTER TABLE authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE authors FORCE ROW LEVEL SECURITY;
CREATE POLICY authors_tenant_isolation ON authors
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY authors_platform_read ON authors FOR SELECT TO pg_database_owner USING (true);

ALTER TABLE site_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_routes FORCE ROW LEVEL SECURITY;
CREATE POLICY site_routes_tenant_isolation ON site_routes
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY site_routes_platform_read ON site_routes FOR SELECT TO pg_database_owner USING (true);

ALTER TABLE crawl_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY crawl_runs_tenant_isolation ON crawl_runs
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY crawl_runs_platform_read ON crawl_runs FOR SELECT TO pg_database_owner USING (true);

ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections FORCE ROW LEVEL SECURITY;
CREATE POLICY connections_tenant_isolation ON connections
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY connections_platform_read ON connections FOR SELECT TO pg_database_owner USING (true);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant_isolation ON notifications
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY notifications_platform_read ON notifications FOR SELECT TO pg_database_owner USING (true);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
-- only when something else changed: a no-op UPDATE stays a no-op (and writes no audit row)
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER touch BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON sites FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON brand_profiles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON authors FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON connections FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Audit: every write on every tenant table, in the same transaction.
-- ---------------------------------------------------------------------------
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON sites
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON brand_profiles
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON authors
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON crawl_runs
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON connections
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id', 'credentials_ciphertext');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON notifications
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');

-- site_routes changes thousands of rows per crawl: one audit row per statement
-- and site (row count plus a sample of URLs) instead of one per route.
CREATE FUNCTION audit_site_routes_statement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF app_setting('app.actor_id') IS NULL THEN
    RAISE EXCEPTION 'audit: % on site_routes has no actor (app.actor_id)', TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO audit_log (workspace_id, actor_id, impersonator_id, action, entity_type, entity_id, details, request_id)
  SELECT c.workspace_id, app_setting('app.actor_id'), app_setting('app.impersonator_id')::uuid,
         coalesce(app_setting('app.action'), 'site_routes.' || lower(TG_OP)),
         'site_routes', c.site_id::text,
         jsonb_build_object('op', lower(TG_OP), 'rows', count(*), 'sample', to_jsonb((array_agg(c.path ORDER BY c.path))[1:5])),
         app_setting('app.request_id')
  FROM changed_rows c
  GROUP BY c.workspace_id, c.site_id;
  RETURN NULL;
END $$;
CREATE TRIGGER audit_insert AFTER INSERT ON site_routes REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION audit_site_routes_statement();
CREATE TRIGGER audit_update AFTER UPDATE ON site_routes REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION audit_site_routes_statement();
CREATE TRIGGER audit_delete AFTER DELETE ON site_routes REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION audit_site_routes_statement();

-- ---------------------------------------------------------------------------
-- A new Better Auth organization gets its workspaces row in the same
-- transaction. Runs as the owner (bound by FORCE RLS like everyone), so it
-- scopes itself to the new workspace for the one insert.
-- ---------------------------------------------------------------------------
CREATE FUNCTION workspace_for_new_organization() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  prev_ws text := coalesce(current_setting('app.workspace_id', true), '');
  prev_actor text := coalesce(current_setting('app.actor_id', true), '');
BEGIN
  PERFORM set_config('app.workspace_id', NEW.id::text, true);
  IF prev_actor = '' THEN
    PERFORM set_config('app.actor_id', 'system:better-auth', true);
  END IF;
  INSERT INTO workspaces (id) VALUES (NEW.id);
  PERFORM set_config('app.workspace_id', prev_ws, true);
  PERFORM set_config('app.actor_id', prev_actor, true);
  RETURN NULL;
END $$;
CREATE TRIGGER zz_workspace AFTER INSERT ON auth_organization
  FOR EACH ROW EXECUTE FUNCTION workspace_for_new_organization();

REVOKE EXECUTE ON FUNCTION audit_site_routes_statement(), workspace_for_new_organization(), touch_updated_at() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Fixed-window rate limits for expensive app actions (lib/rate-limit.ts).
-- Not tenant data: keys name a user or workspace, values are counters.
-- ---------------------------------------------------------------------------
CREATE TABLE app_rate_limits (
  key           text        NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
