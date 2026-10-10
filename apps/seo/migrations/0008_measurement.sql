-- 0008 measurement
-- Phase 4: rank tracking, Search Console and GA4 daily syncs, URL inspection,
-- site audits with tasks, the backlinks baseline, per-site measurement
-- cadences, and the agency home's cross-workspace health read.
--
-- Every new table is a tenant table: workspace_id, row-level security ENABLED
-- and FORCED with the 0004 policy, a SELECT-only platform policy for the owner
-- role, composite foreign keys into the site, and an audit trigger. Tables
-- written in bulk by the syncs (thousands of rows per day for a big site) get
-- one audit row per statement and site instead of one per row, like
-- site_routes in 0004.
--
-- Money stays integer micro-USD. Google's dates are calendar days in
-- America/Los_Angeles (Search Console) or the property's time zone (GA4) and
-- are stored as plain dates.

-- ---------------------------------------------------------------------------
-- Per-site cadences (site settings). Search Console and GA4 are free and sync
-- daily while connected; paid work (rank checks, audits, backlinks) runs on
-- its cadence, priced first, through the metered path.
-- ---------------------------------------------------------------------------
ALTER TABLE sites
  ADD COLUMN rank_cadence text NOT NULL DEFAULT 'weekly' CHECK (rank_cadence IN ('off', 'daily', 'weekly', 'fortnightly', 'monthly')),
  ADD COLUMN rank_device text NOT NULL DEFAULT 'desktop' CHECK (rank_device IN ('desktop', 'mobile')),
  ADD COLUMN rank_depth smallint NOT NULL DEFAULT 30 CHECK (rank_depth IN (10, 20, 30, 50, 100)),
  ADD COLUMN rank_max_keywords smallint NOT NULL DEFAULT 100 CHECK (rank_max_keywords BETWEEN 1 AND 1000),
  ADD COLUMN audit_cadence text NOT NULL DEFAULT 'monthly' CHECK (audit_cadence IN ('off', 'monthly', 'quarterly')),
  ADD COLUMN audit_max_pages integer NOT NULL DEFAULT 200 CHECK (audit_max_pages BETWEEN 10 AND 10000),
  ADD COLUMN backlinks_cadence text NOT NULL DEFAULT 'quarterly' CHECK (backlinks_cadence IN ('off', 'monthly', 'quarterly')),
  ADD COLUMN search_sync boolean NOT NULL DEFAULT true,
  -- URL Inspection: at most this many inspections per site per day (Google allows 2,000 per property per day)
  ADD COLUMN inspect_daily_cap smallint NOT NULL DEFAULT 20 CHECK (inspect_daily_cap BETWEEN 0 AND 200);

-- ---------------------------------------------------------------------------
-- Measurement runs: one row per site, kind and cadence window. window_key is
-- the idempotency key (a week, a month, a quarter, a Pacific-time day, or
-- "manual:<uuid>"): the scheduler and the queue can deliver a job twice and
-- the second finds the row and does nothing. A refused or failed run may be
-- retried in the same window after retry_after.
-- ---------------------------------------------------------------------------
CREATE TABLE measurement_runs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL,
  site_id          uuid        NOT NULL,
  kind             text        NOT NULL CHECK (kind IN ('rank', 'audit', 'backlinks', 'gsc', 'ga4', 'inspect')),
  window_key       text        NOT NULL CHECK (window_key ~ '^[a-zA-Z0-9:._-]{1,80}$'),
  trigger          text        NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule', 'manual', 'seed', 'connect', 'cli')),
  status           text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'waiting', 'succeeded', 'failed', 'refused', 'skipped')),
  detail           text        CHECK (length(detail) <= 1000),
  attempts         integer     NOT NULL DEFAULT 1 CHECK (attempts >= 0),
  estimate_micros  bigint      NOT NULL DEFAULT 0 CHECK (estimate_micros >= 0),
  cost_micros      bigint      NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  -- the provider's handle for asynchronous work (an OpenSEO tracker run, an audit id)
  provider_ref     text        CHECK (length(provider_ref) <= 300),
  stats            jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(stats) = 'object'),
  created_by       text        NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  retry_after      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, kind, window_key),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX measurement_runs_recent_idx ON measurement_runs (site_id, kind, started_at DESC);

-- ---------------------------------------------------------------------------
-- Rank tracking (rule 12): one tracker per site, market and device; one
-- snapshot row per keyword per run.
-- ---------------------------------------------------------------------------
CREATE TABLE rank_trackers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL,
  site_id             uuid        NOT NULL,
  provider            text        NOT NULL CHECK (provider IN ('fake', 'openseo', 'dataforseo')),
  provider_tracker_id text        NOT NULL CHECK (length(provider_tracker_id) BETWEEN 1 AND 300),
  market              text        NOT NULL CHECK (length(market) BETWEEN 1 AND 120),
  location_code       integer     NOT NULL,
  language_code       text        NOT NULL CHECK (language_code ~ '^[a-z]{2,3}$'),
  device              text        NOT NULL DEFAULT 'desktop' CHECK (device IN ('desktop', 'mobile')),
  depth               smallint    NOT NULL DEFAULT 30,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, provider, market, device),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE rank_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  site_id       uuid        NOT NULL,
  tracker_id    uuid        NOT NULL,
  run_id        uuid        NOT NULL,
  keyword       text        NOT NULL CHECK (length(keyword) BETWEEN 1 AND 200),
  -- published: a published article's target keyword (rank_tracking_queue); saved: a saved keyword
  source        text        NOT NULL CHECK (source IN ('published', 'saved')),
  item_id       uuid,
  cluster       text        NOT NULL DEFAULT '' CHECK (length(cluster) <= 80),
  -- NULL: not in the top `depth` results
  position      smallint    CHECK (position BETWEEN 1 AND 200),
  url           text        CHECK (length(url) <= 2048),
  serp_features text[]      NOT NULL DEFAULT '{}',
  device        text        NOT NULL CHECK (device IN ('desktop', 'mobile')),
  location      text        NOT NULL CHECK (length(location) <= 120),
  captured_at   timestamptz NOT NULL,
  UNIQUE (run_id, keyword),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, tracker_id) REFERENCES rank_trackers (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, run_id) REFERENCES measurement_runs (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, item_id) REFERENCES content_items (workspace_id, id) ON DELETE SET NULL (item_id)
);
CREATE INDEX rank_snapshots_kw_idx ON rank_snapshots (site_id, keyword, captured_at DESC);
CREATE INDEX rank_snapshots_time_idx ON rank_snapshots (site_id, captured_at DESC);

-- ---------------------------------------------------------------------------
-- Search Console and GA4 sync state: one row per site and kind. The backfill
-- (16 months of Search Console on first connect, 90 days of GA4) walks
-- backwards from the newest day in chunks; final_through is the newest day
-- Google calls final (Search Console data lags two to three days).
-- ---------------------------------------------------------------------------
CREATE TABLE search_sync_state (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL,
  site_id           uuid        NOT NULL,
  kind              text        NOT NULL CHECK (kind IN ('search_console', 'ga4')),
  property          text        NOT NULL CHECK (length(property) <= 300),
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'ok', 'error')),
  detail            text        CHECK (length(detail) <= 1000),
  backfill_from     date,
  -- the oldest day whose detail rows are stored (the backfill walks this back to backfill_from)
  backfill_cursor   date,
  backfilled_at     timestamptz,
  final_through     date,
  newest_day        date,
  last_attempt_at   timestamptz,
  last_success_at   timestamptz,
  rows_written      bigint      NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  requests          bigint      NOT NULL DEFAULT 0 CHECK (requests >= 0),
  -- GA4 measurement health (lib/measure/health.ts), refreshed with every GA4 sync
  health            jsonb,
  failures          integer     NOT NULL DEFAULT 0 CHECK (failures >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, kind),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);

-- Daily totals for the property (dimension "date": includes anonymised queries).
CREATE TABLE gsc_daily (
  workspace_id  uuid          NOT NULL,
  site_id       uuid          NOT NULL,
  day           date          NOT NULL,
  clicks        integer       NOT NULL CHECK (clicks >= 0),
  impressions   integer       NOT NULL CHECK (impressions >= 0),
  ctr           numeric(7, 6) NOT NULL CHECK (ctr BETWEEN 0 AND 1),
  position      numeric(7, 2) NOT NULL CHECK (position >= 0),
  -- false while Google may still change the day (dataState=all, on or after first_incomplete_date)
  final         boolean       NOT NULL,
  synced_at     timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, day),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);

-- By page and day (dimensions date, page).
CREATE TABLE gsc_page_daily (
  workspace_id  uuid          NOT NULL,
  site_id       uuid          NOT NULL,
  day           date          NOT NULL,
  page          text          NOT NULL CHECK (length(page) <= 2048),
  clicks        integer       NOT NULL CHECK (clicks >= 0),
  impressions   integer       NOT NULL CHECK (impressions >= 0),
  position      numeric(7, 2) NOT NULL CHECK (position >= 0),
  PRIMARY KEY (site_id, day, page),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);

-- By query, page and day (dimensions date, query, page; anonymised queries are not in here).
CREATE TABLE gsc_query_daily (
  workspace_id  uuid          NOT NULL,
  site_id       uuid          NOT NULL,
  day           date          NOT NULL,
  query         text          NOT NULL CHECK (length(query) <= 500),
  page          text          NOT NULL CHECK (length(page) <= 2048),
  clicks        integer       NOT NULL CHECK (clicks >= 0),
  impressions   integer       NOT NULL CHECK (impressions >= 0),
  position      numeric(7, 2) NOT NULL CHECK (position >= 0),
  PRIMARY KEY (site_id, day, query, page),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX gsc_query_daily_recent_idx ON gsc_query_daily (site_id, day DESC);

-- GA4: daily sessions and key events (all channels and organic search), organic landing pages, organic key events by name.
CREATE TABLE ga4_daily (
  workspace_id        uuid        NOT NULL,
  site_id             uuid        NOT NULL,
  day                 date        NOT NULL,
  sessions            integer     NOT NULL CHECK (sessions >= 0),
  key_events          numeric(12, 2) NOT NULL CHECK (key_events >= 0),
  organic_sessions    integer     NOT NULL CHECK (organic_sessions >= 0),
  organic_key_events  numeric(12, 2) NOT NULL CHECK (organic_key_events >= 0),
  final               boolean     NOT NULL,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, day),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE ga4_landing_daily (
  workspace_id  uuid        NOT NULL,
  site_id       uuid        NOT NULL,
  day           date        NOT NULL,
  landing_page  text        NOT NULL CHECK (length(landing_page) <= 2048),
  sessions      integer     NOT NULL CHECK (sessions >= 0),
  key_events    numeric(12, 2) NOT NULL CHECK (key_events >= 0),
  PRIMARY KEY (site_id, day, landing_page),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE ga4_event_daily (
  workspace_id  uuid        NOT NULL,
  site_id       uuid        NOT NULL,
  day           date        NOT NULL,
  event_name    text        NOT NULL CHECK (length(event_name) <= 200),
  key_events    numeric(12, 2) NOT NULL CHECK (key_events >= 0),
  PRIMARY KEY (site_id, day, event_name),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- URL Inspection (read-only; never the Indexing API): Google's index status
-- of each published URL, the latest inspection per URL.
-- ---------------------------------------------------------------------------
CREATE TABLE url_inspections (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL,
  site_id           uuid        NOT NULL,
  url               text        NOT NULL CHECK (length(url) <= 2048),
  item_id           uuid,
  source            text        NOT NULL DEFAULT 'published' CHECK (source IN ('published', 'key_page', 'search')),
  verdict           text        NOT NULL CHECK (length(verdict) <= 40),
  coverage_state    text        NOT NULL DEFAULT '' CHECK (length(coverage_state) <= 300),
  indexing_state    text        NOT NULL DEFAULT '' CHECK (length(indexing_state) <= 60),
  page_fetch_state  text        NOT NULL DEFAULT '' CHECK (length(page_fetch_state) <= 60),
  robots_txt_state  text        NOT NULL DEFAULT '' CHECK (length(robots_txt_state) <= 60),
  last_crawl_time   timestamptz,
  google_canonical  text        CHECK (length(google_canonical) <= 2048),
  user_canonical    text        CHECK (length(user_canonical) <= 2048),
  result_link       text        CHECK (length(result_link) <= 2048),
  error             text        CHECK (length(error) <= 500),
  inspected_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, url),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, item_id) REFERENCES content_items (workspace_id, id) ON DELETE SET NULL (item_id)
);

-- ---------------------------------------------------------------------------
-- Site audits (monthly, through the provider's siteAudit.run/status/issues),
-- their issues (grouped by type, with severity and an assignee), and tasks
-- (an audit issue's "fix" creates one).
-- ---------------------------------------------------------------------------
CREATE TABLE audits (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL,
  site_id           uuid        NOT NULL,
  run_id            uuid        NOT NULL,
  provider          text        NOT NULL CHECK (provider IN ('fake', 'openseo', 'dataforseo')),
  provider_audit_id text        NOT NULL CHECK (length(provider_audit_id) BETWEEN 1 AND 300),
  status            text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  pages_crawled     integer     NOT NULL DEFAULT 0 CHECK (pages_crawled >= 0),
  pages_total       integer     CHECK (pages_total >= 0),
  max_pages         integer     NOT NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, run_id) REFERENCES measurement_runs (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX audits_site_idx ON audits (site_id, started_at DESC);

CREATE TABLE tasks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL,
  site_id         uuid        NOT NULL,
  title           text        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  detail          text        NOT NULL DEFAULT '' CHECK (length(detail) <= 2000),
  source          text        NOT NULL DEFAULT 'manual' CHECK (source IN ('audit', 'manual')),
  issue_type      text        CHECK (length(issue_type) <= 120),
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
  assignee_id     uuid        REFERENCES auth_user (id) ON DELETE SET NULL,
  created_by      text        NOT NULL,
  done_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX tasks_site_idx ON tasks (site_id, status, created_at DESC);
-- the "fix" action is idempotent: one open task per site and issue type
CREATE UNIQUE INDEX tasks_issue_open_once ON tasks (site_id, issue_type) WHERE issue_type IS NOT NULL AND status <> 'done';

CREATE TABLE audit_issues (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  site_id       uuid        NOT NULL,
  audit_id      uuid        NOT NULL,
  issue_type    text        NOT NULL CHECK (length(issue_type) BETWEEN 1 AND 120),
  -- the group shown on the audit screen (lib/measure/audit-groups.ts)
  category      text        NOT NULL DEFAULT 'other' CHECK (length(category) <= 40),
  severity      text        NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  count         integer     NOT NULL CHECK (count >= 0),
  title         text        NOT NULL CHECK (length(title) <= 200),
  assignee_id   uuid        REFERENCES auth_user (id) ON DELETE SET NULL,
  task_id       uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id, issue_type),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, audit_id) REFERENCES audits (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE SET NULL (task_id)
);

-- ---------------------------------------------------------------------------
-- Backlinks: a baseline for the site and its brand-profile competitors on
-- onboarding (or when a provider is first configured), then quarterly.
-- new/lost are computed against the previous snapshot of the same domain.
-- ---------------------------------------------------------------------------
CREATE TABLE backlink_snapshots (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid        NOT NULL,
  site_id                 uuid        NOT NULL,
  run_id                  uuid        NOT NULL,
  domain                  text        NOT NULL CHECK (length(domain) <= 253),
  is_competitor           boolean     NOT NULL,
  backlinks               bigint      CHECK (backlinks >= 0),
  referring_domains       integer     CHECK (referring_domains >= 0),
  domain_rank             integer,
  broken_backlinks        integer     CHECK (broken_backlinks >= 0),
  -- referring domains seen in the profile (the site only), to diff against the previous snapshot
  referring_sample        text[]      NOT NULL DEFAULT '{}',
  new_referring_domains   integer     CHECK (new_referring_domains >= 0),
  lost_referring_domains  integer     CHECK (lost_referring_domains >= 0),
  cost_micros             bigint      NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  captured_at             timestamptz NOT NULL,
  UNIQUE (run_id, domain),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, run_id) REFERENCES measurement_runs (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX backlink_snapshots_domain_idx ON backlink_snapshots (site_id, domain, captured_at DESC);

-- ---------------------------------------------------------------------------
-- Row-level security: enabled AND forced, one tenant policy, platform read.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['measurement_runs', 'rank_trackers', 'rank_snapshots', 'search_sync_state', 'gsc_daily', 'gsc_page_daily',
                           'gsc_query_daily', 'ga4_daily', 'ga4_landing_daily', 'ga4_event_daily', 'url_inspections', 'audits',
                           'audit_issues', 'tasks', 'backlink_snapshots'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t || '_tenant_isolation', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO pg_database_owner USING (true)', t || '_platform_read', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- updated_at and audit
-- ---------------------------------------------------------------------------
CREATE TRIGGER touch BEFORE UPDATE ON measurement_runs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON rank_trackers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON search_sync_state FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON audits FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON audit_issues FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON measurement_runs
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON rank_trackers
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON search_sync_state
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON url_inspections
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON audits
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON audit_issues
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON backlink_snapshots
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id', 'referring_sample');

-- Bulk sync tables: one audit row per statement and site (row count and the
-- day range), the same pattern as site_routes. TG_ARGV[0]: the day column.
CREATE FUNCTION audit_bulk_statement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF app_setting('app.actor_id') IS NULL THEN
    RAISE EXCEPTION 'audit: % on % has no actor (app.actor_id)', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  EXECUTE format(
    $q$INSERT INTO audit_log (workspace_id, actor_id, impersonator_id, action, entity_type, entity_id, details, request_id)
       SELECT c.workspace_id, $1, $2, $3, $4, c.site_id::text,
              jsonb_build_object('op', $5, 'rows', count(*), 'from', min(c.%1$I), 'to', max(c.%1$I)), $6
       FROM changed_rows c GROUP BY c.workspace_id, c.site_id$q$, TG_ARGV[0])
  USING app_setting('app.actor_id'), app_setting('app.impersonator_id')::uuid,
        coalesce(app_setting('app.action'), TG_TABLE_NAME || '.' || lower(TG_OP)), TG_TABLE_NAME, lower(TG_OP), app_setting('app.request_id');
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gsc_daily', 'gsc_page_daily', 'gsc_query_daily', 'ga4_daily', 'ga4_landing_daily', 'ga4_event_daily'] LOOP
    EXECUTE format('CREATE TRIGGER audit_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION audit_bulk_statement(%L)', t, 'day');
    EXECUTE format('CREATE TRIGGER audit_update AFTER UPDATE ON %I REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION audit_bulk_statement(%L)', t, 'day');
    EXECUTE format('CREATE TRIGGER audit_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION audit_bulk_statement(%L)', t, 'day');
  END LOOP;
END $$;
CREATE TRIGGER audit_insert AFTER INSERT ON rank_snapshots REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION audit_bulk_statement('captured_at');
CREATE TRIGGER audit_update AFTER UPDATE ON rank_snapshots REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION audit_bulk_statement('captured_at');
CREATE TRIGGER audit_delete AFTER DELETE ON rank_snapshots REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION audit_bulk_statement('captured_at');

REVOKE EXECUTE ON FUNCTION audit_bulk_statement() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Agency home: every workspace's health (platform admins only, audited like
-- every platform_* read; aggregates only, never rows or secrets).
--   runway         the shortest runway of the workspace's scheduled sites
--   published      articles published this calendar month (UTC)
--   awaiting       articles waiting for review
--   clicks         organic clicks, last 28 days and the 28 before (Search Console)
--   clicks_weekly  the last 12 weeks of clicks, oldest first (sparkline)
--   failing        connections in error plus Search Console / GA4 syncs failing
--   measure_failed paid measurement runs (rank, audit, backlinks) failed or refused in the last 14 days
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_workspace_health()
  RETURNS TABLE (
    workspace_id uuid, runway_days integer, runway_level text, scheduled_sites integer, published_month integer,
    awaiting_review integer, clicks_28d bigint, clicks_prev_28d bigint, clicks_weekly bigint[], gsc_sites integer,
    failing integer, measure_failed integer
  )
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  -- Search Console days are Pacific; the newest full day is yesterday (the same window as the site dashboard)
  last_day date := (now() AT TIME ZONE 'America/Los_Angeles')::date - 1;
BEGIN
  PERFORM platform_require_admin();
  PERFORM app_audit_event('platform.health.read', 'workspaces', NULL, NULL);
  RETURN QUERY
    SELECT o.id,
      (SELECT min(s.runway_days)::int FROM sites s WHERE s.workspace_id = o.id AND s.schedule_active AND s.runway_days IS NOT NULL),
      (SELECT CASE WHEN bool_or(s.runway_level = 'empty') THEN 'empty' WHEN bool_or(s.runway_level = 'low') THEN 'low'
                   WHEN bool_or(s.runway_level = 'ok') THEN 'ok' END
         FROM sites s WHERE s.workspace_id = o.id AND s.schedule_active),
      (SELECT count(*)::int FROM sites s WHERE s.workspace_id = o.id AND s.schedule_active),
      (SELECT count(*)::int FROM content_items c WHERE c.workspace_id = o.id AND c.status = 'published'
         AND c.published_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
      (SELECT count(*)::int FROM content_items c WHERE c.workspace_id = o.id AND c.status = 'awaiting_review'),
      (SELECT coalesce(sum(g.clicks), 0)::bigint FROM gsc_daily g WHERE g.workspace_id = o.id AND g.day > last_day - 28 AND g.day <= last_day),
      (SELECT coalesce(sum(g.clicks), 0)::bigint FROM gsc_daily g WHERE g.workspace_id = o.id AND g.day > last_day - 56 AND g.day <= last_day - 28),
      (SELECT array_agg(coalesce(w.c, 0) ORDER BY k.k)
         FROM generate_series(11, 0, -1) AS k(k)
         LEFT JOIN LATERAL (SELECT sum(g.clicks)::bigint AS c FROM gsc_daily g
                            WHERE g.workspace_id = o.id AND g.day > last_day - 7 * (k.k + 1) AND g.day <= last_day - 7 * k.k) w ON true),
      (SELECT count(DISTINCT x.site_id)::int FROM search_sync_state x WHERE x.workspace_id = o.id AND x.kind = 'search_console'),
      (SELECT count(*)::int FROM connections c WHERE c.workspace_id = o.id AND c.status = 'error')
        + (SELECT count(*)::int FROM search_sync_state x WHERE x.workspace_id = o.id AND x.status = 'error'),
      (SELECT count(*)::int FROM measurement_runs r WHERE r.workspace_id = o.id AND r.kind IN ('rank', 'audit', 'backlinks')
         AND r.status IN ('failed', 'refused') AND r.started_at > now() - interval '14 days'
         AND NOT EXISTS (SELECT 1 FROM measurement_runs r2 WHERE r2.site_id = r.site_id AND r2.kind = r.kind AND r2.status = 'succeeded' AND r2.started_at > r.started_at))
    FROM auth_organization o
    ORDER BY o.name;
END $$;
REVOKE EXECUTE ON FUNCTION platform_workspace_health() FROM PUBLIC;
