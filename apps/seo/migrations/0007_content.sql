-- 0007 content
-- Phase 3: the content pipeline.
--
--   * the workspace role "reviewer" (owner decision, October 2026): between
--     viewer and editor; approves, rejects or requests changes on content
--     awaiting review, and nothing else that writes;
--   * per-site schedule, rolling generation, review mode, back-dating and
--     runway settings (columns on sites);
--   * content items (the calendar slots and the articles in them), their
--     version history, comments and review decisions;
--   * pipeline runs and their ten persisted steps;
--   * publications (where and how an item went out), the rank-tracking queue
--     (Phase 4 runs it), external link checks;
--   * two narrow SECURITY DEFINER helpers: the worker's list of sites to
--     visit, and a public feed's token lookup.
--
-- Every new table is a tenant table: workspace_id, row-level security
-- ENABLED and FORCED with the 0004 policy, a SELECT-only platform policy for
-- the owner role, and the audit trigger (large text and JSON redacted to a
-- fingerprint: the version table keeps the bodies).
--
-- The job queue (pg-boss) lives in its own schema "pgboss", installed by
-- scripts/migrate.ts after this file (lib/jobs/install.ts); it is not tenant
-- data and holds only ids.

-- ---------------------------------------------------------------------------
-- The reviewer role
-- ---------------------------------------------------------------------------
ALTER TABLE auth_member DROP CONSTRAINT auth_member_role_check;
ALTER TABLE auth_member ADD CONSTRAINT auth_member_role_check CHECK (role IN ('owner', 'editor', 'reviewer', 'viewer'));
ALTER TABLE auth_invitation DROP CONSTRAINT auth_invitation_role_check;
ALTER TABLE auth_invitation ADD CONSTRAINT auth_invitation_role_check CHECK (role IS NULL OR role IN ('owner', 'editor', 'reviewer', 'viewer'));

CREATE OR REPLACE FUNCTION platform_workspace_members(p_workspace uuid)
  RETURNS TABLE (user_id uuid, name text, email text, role text, is_platform_admin boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM platform_require_admin();
  PERFORM set_config('app.audit_workspace_id', p_workspace::text, true);
  PERFORM app_audit_event('platform.members.read', 'workspaces', p_workspace::text, NULL);
  RETURN QUERY
    SELECT u.id, u.name, u.email, m.role, coalesce(u.role = 'admin', false)
    FROM auth_member m JOIN auth_user u ON u.id = m.user_id
    WHERE m.organization_id = p_workspace
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 WHEN 'reviewer' THEN 2 ELSE 3 END, u.email;
END $$;
REVOKE EXECUTE ON FUNCTION platform_workspace_members(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Per-site schedule and publishing rules
-- ---------------------------------------------------------------------------
ALTER TABLE sites
  -- ISO weekdays (1 = Monday … 7 = Sunday) and the local time slots fall on, in the site's time zone
  ADD COLUMN schedule_days smallint[] NOT NULL DEFAULT '{2,5}'
    CHECK (schedule_days <@ '{1,2,3,4,5,6,7}'::smallint[] AND cardinality(schedule_days) BETWEEN 1 AND 7),
  ADD COLUMN schedule_time time NOT NULL DEFAULT '09:00',
  -- off until someone turns it on (onboarding step 8 or site settings)
  ADD COLUMN schedule_active boolean NOT NULL DEFAULT false,
  -- rule 2: rolling (each article written lead_days before its slot) is the default; batch writes batch_size ahead
  ADD COLUMN generation_mode text NOT NULL DEFAULT 'rolling' CHECK (generation_mode IN ('rolling', 'batch')),
  ADD COLUMN lead_days smallint NOT NULL DEFAULT 3 CHECK (lead_days BETWEEN 0 AND 30),
  ADD COLUMN batch_size smallint NOT NULL DEFAULT 4 CHECK (batch_size BETWEEN 1 AND 20),
  -- how far ahead empty slots are laid out on the calendar
  ADD COLUMN horizon_days smallint NOT NULL DEFAULT 42 CHECK (horizon_days BETWEEN 7 AND 120),
  -- rule 8 / section 7.8: approval required by default; autopilot only with an acknowledgement on record
  ADD COLUMN review_mode text NOT NULL DEFAULT 'approval' CHECK (review_mode IN ('approval', 'autopilot')),
  ADD COLUMN autopilot_acknowledged_by text,
  ADD COLUMN autopilot_acknowledged_at timestamptz,
  -- rule 3: off by default
  ADD COLUMN allow_backdating boolean NOT NULL DEFAULT false,
  -- rule 1
  ADD COLUMN runway_threshold_days smallint NOT NULL DEFAULT 10 CHECK (runway_threshold_days BETWEEN 1 AND 120),
  ADD COLUMN runway_days integer CHECK (runway_days >= 0),
  ADD COLUMN runway_level text CHECK (runway_level IN ('ok', 'low', 'empty')),
  ADD COLUMN runway_reason text CHECK (length(runway_reason) <= 300),
  ADD COLUMN runway_checked_at timestamptz,
  ADD COLUMN runway_alerted_level text CHECK (runway_alerted_level IN ('low', 'empty')),
  ADD COLUMN runway_alerted_at timestamptz,
  -- the connection articles are published through (git or webhook)
  ADD COLUMN publish_connection_id uuid,
  -- the public JSON / RSS feed of published items (off until enabled)
  ADD COLUMN feed_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN feed_token text NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    CHECK (feed_token ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT sites_autopilot_acknowledged CHECK (review_mode <> 'autopilot' OR autopilot_acknowledged_at IS NOT NULL);
CREATE UNIQUE INDEX sites_feed_token ON sites (feed_token);

ALTER TABLE connections ADD CONSTRAINT connections_workspace_id_key UNIQUE (workspace_id, id);
ALTER TABLE authors ADD CONSTRAINT authors_workspace_id_key UNIQUE (workspace_id, id);
ALTER TABLE sites ADD CONSTRAINT sites_publish_connection_fk
  FOREIGN KEY (workspace_id, publish_connection_id) REFERENCES connections (workspace_id, id) ON DELETE SET NULL (publish_connection_id);

-- ---------------------------------------------------------------------------
-- Content items: one calendar slot and the article written for it.
--
-- Status machine (lib/content/status.ts is the single source of transitions):
--   planned → generating → awaiting_review → approved → publishing → published
--                        ↘ failed (retry/resume)   ↘ changes_requested → awaiting_review
--                                                  ↘ rejected (terminal; the slot gets a new planned item)
--   published → unpublished;  planned → skipped
-- ---------------------------------------------------------------------------
CREATE TABLE content_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL,
  site_id             uuid        NOT NULL,
  -- when the article goes live (UTC instant of the site-local slot); moves when someone reschedules
  slot_at             timestamptz NOT NULL,
  -- the schedule slot this item was laid out for (NULL for one-off items); never moves, so a
  -- rescheduled or skipped slot is not laid out again
  schedule_slot_at    timestamptz,
  kind                text        NOT NULL DEFAULT 'new' CHECK (kind IN ('new', 'refresh')),
  refresh_of          uuid,
  status              text        NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('planned', 'generating', 'failed', 'awaiting_review', 'changes_requested', 'approved',
                                        'publishing', 'published', 'rejected', 'unpublished', 'skipped')),
  status_detail       text        CHECK (length(status_detail) <= 500),
  primary_keyword     text        CHECK (length(primary_keyword) <= 200),
  -- rule 5: the near-duplicate key of the primary keyword (lib/research/keywords.ts variantKey)
  head_term           text        CHECK (length(head_term) <= 200),
  secondary_keywords  text[]      NOT NULL DEFAULT '{}',
  cluster             text        NOT NULL DEFAULT '' CHECK (length(cluster) <= 80),
  intent              text        CHECK (intent IN ('informational', 'navigational', 'commercial', 'transactional')),
  author_id           uuid,
  title               text        NOT NULL DEFAULT '' CHECK (length(title) <= 300),
  description         text        NOT NULL DEFAULT '' CHECK (length(description) <= 600),
  slug                text        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 120),
  body_md             text        NOT NULL DEFAULT '' CHECK (length(body_md) <= 200000),
  -- cover art spec, e.g. { "kind": "checklist", "chips": ["…", "…"] } (lumoras.ai's art block)
  cover               jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(cover) = 'object'),
  topic               jsonb,
  brief               jsonb,
  sources             jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources) = 'array'),
  internal_links      jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(internal_links) = 'array'),
  lint                jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(lint) = 'array'),
  lint_passed         boolean,
  lint_at             timestamptz,
  fact_check          jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(fact_check) = 'array'),
  fact_check_passed   boolean,
  unverifiable_claims integer     NOT NULL DEFAULT 0 CHECK (unverifiable_claims >= 0),
  version             integer     NOT NULL DEFAULT 0 CHECK (version >= 0),
  -- rule 3: when the draft was written; the published date is never before it unless back-dating is on
  written_at          timestamptz,
  publish_date        date,
  published_at        timestamptz,
  live_url            text        CHECK (length(live_url) <= 2048),
  current_run_id      uuid,
  created_by          text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, author_id) REFERENCES authors (workspace_id, id) ON DELETE SET NULL (author_id),
  FOREIGN KEY (workspace_id, refresh_of) REFERENCES content_items (workspace_id, id) ON DELETE SET NULL (refresh_of)
);
CREATE INDEX content_items_slot_idx ON content_items (site_id, slot_at);
CREATE INDEX content_items_status_idx ON content_items (workspace_id, status);
-- one item per schedule slot (a rejected item's slot gets a fresh one)
CREATE UNIQUE INDEX content_items_schedule_slot_once ON content_items (site_id, schedule_slot_at)
  WHERE schedule_slot_at IS NOT NULL AND status <> 'rejected';
-- one live item per slug
CREATE UNIQUE INDEX content_items_slug_once ON content_items (site_id, slug)
  WHERE slug IS NOT NULL AND status NOT IN ('rejected', 'skipped', 'unpublished');
-- rule 5 backstop: no two live new articles share a head term (the pipeline checks first, with reasons)
CREATE UNIQUE INDEX content_items_head_term_once ON content_items (site_id, head_term)
  WHERE head_term IS NOT NULL AND kind = 'new' AND status NOT IN ('rejected', 'skipped', 'unpublished', 'failed', 'planned');

-- Version history: every body the item has had, append-only.
CREATE TABLE content_versions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  item_id       uuid        NOT NULL,
  version       integer     NOT NULL CHECK (version > 0),
  title         text        NOT NULL DEFAULT '',
  description   text        NOT NULL DEFAULT '',
  body_md       text        NOT NULL DEFAULT '' CHECK (length(body_md) <= 200000),
  cover         jsonb       NOT NULL DEFAULT '{}',
  source        text        NOT NULL CHECK (source IN ('draft', 'fact_check', 'editor', 'restore')),
  note          text        CHECK (length(note) <= 500),
  actor_id      text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, version),
  FOREIGN KEY (workspace_id, item_id) REFERENCES content_items (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE content_comments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  item_id       uuid        NOT NULL,
  user_id       uuid        NOT NULL REFERENCES auth_user (id) ON DELETE CASCADE,
  version       integer     NOT NULL DEFAULT 0,
  body          text        NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  resolved_at   timestamptz,
  resolved_by   uuid        REFERENCES auth_user (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, item_id) REFERENCES content_items (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX content_comments_item_idx ON content_comments (item_id, created_at);

-- Review decisions (approve / reject / request changes), append-only.
CREATE TABLE content_reviews (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  item_id       uuid        NOT NULL,
  version       integer     NOT NULL,
  decision      text        NOT NULL CHECK (decision IN ('approved', 'rejected', 'changes_requested', 'autopilot')),
  note          text        NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  reviewer_id   text        NOT NULL,
  reviewer_role text        CHECK (reviewer_role IN ('owner', 'editor', 'reviewer', 'system')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, item_id) REFERENCES content_items (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX content_reviews_item_idx ON content_reviews (item_id, created_at);

-- ---------------------------------------------------------------------------
-- Pipeline runs and their ten steps (lib/pipeline/steps.ts names them)
-- ---------------------------------------------------------------------------
CREATE TABLE pipeline_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  site_id       uuid        NOT NULL,
  item_id       uuid        NOT NULL,
  trigger       text        NOT NULL CHECK (trigger IN ('schedule', 'manual', 'retry', 'batch')),
  status        text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'canceled')),
  current_step  text,
  created_by    text        NOT NULL,
  cost_micros   bigint      NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  tokens        integer     NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  error         text        CHECK (length(error) <= 2000),
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, item_id) REFERENCES content_items (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX pipeline_runs_site_idx ON pipeline_runs (site_id, created_at DESC);
CREATE INDEX pipeline_runs_item_idx ON pipeline_runs (item_id, created_at DESC);
ALTER TABLE content_items ADD CONSTRAINT content_items_run_fk
  FOREIGN KEY (workspace_id, current_run_id) REFERENCES pipeline_runs (workspace_id, id) ON DELETE SET NULL (current_run_id);

CREATE TABLE pipeline_steps (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL,
  run_id             uuid        NOT NULL,
  step               text        NOT NULL CHECK (step IN ('context', 'scan', 'topic', 'brief', 'draft', 'factcheck', 'lint', 'review', 'publish', 'after')),
  position           smallint    NOT NULL CHECK (position BETWEEN 1 AND 10),
  status             text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'waiting')),
  attempt            integer     NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  input              jsonb,
  output             jsonb,
  model              text        CHECK (length(model) <= 80),
  input_tokens       integer     NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens      integer     NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens  integer     NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens integer     NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cost_micros        bigint      NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  duration_ms        integer     CHECK (duration_ms >= 0),
  error              text        CHECK (length(error) <= 2000),
  started_at         timestamptz,
  finished_at        timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step),
  FOREIGN KEY (workspace_id, run_id) REFERENCES pipeline_runs (workspace_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Publications: where and how an item went out.
-- ---------------------------------------------------------------------------
CREATE TABLE publications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL,
  site_id         uuid        NOT NULL,
  item_id         uuid        NOT NULL,
  connection_id   uuid,
  publisher       text        NOT NULL CHECK (publisher IN ('github', 'gitea', 'webhook')),
  mode            text        NOT NULL CHECK (mode IN ('pr', 'commit', 'webhook')),
  action          text        NOT NULL DEFAULT 'publish' CHECK (action IN ('publish', 'update', 'unpublish')),
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'merged', 'closed', 'published', 'failed', 'unpublished')),
  remote_id       text        CHECK (length(remote_id) <= 300),
  path            text        CHECK (length(path) <= 500),
  branch          text        CHECK (length(branch) <= 200),
  commit_sha      text        CHECK (commit_sha ~ '^[0-9a-f]{7,64}$'),
  pr_number       integer,
  pr_url          text        CHECK (length(pr_url) <= 2048),
  live_url        text        CHECK (length(live_url) <= 2048),
  live_status     integer,
  live_checked_at timestamptz,
  indexing        jsonb,
  error           text        CHECK (length(error) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, item_id) REFERENCES content_items (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, connection_id) REFERENCES connections (workspace_id, id) ON DELETE SET NULL (connection_id)
);
CREATE INDEX publications_item_idx ON publications (item_id, created_at DESC);

-- Rule 12: every published target keyword is queued for rank tracking (Phase 4 runs the queue).
CREATE TABLE rank_tracking_queue (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  site_id       uuid        NOT NULL,
  item_id       uuid,
  keyword       text        NOT NULL CHECK (length(keyword) BETWEEN 1 AND 200),
  market        text        NOT NULL DEFAULT '' CHECK (length(market) <= 120),
  status        text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'tracking', 'removed')),
  added_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, keyword, market),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, item_id) REFERENCES content_items (workspace_id, id) ON DELETE SET NULL (item_id)
);

-- External link checks (lint rule "external links return 200"), refreshed by a daily job.
CREATE TABLE link_checks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL,
  site_id       uuid        NOT NULL,
  url           text        NOT NULL CHECK (length(url) <= 2048),
  status_code   integer,
  ok            boolean     NOT NULL,
  error         text        CHECK (length(error) <= 500),
  checked_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, url),
  FOREIGN KEY (workspace_id, site_id) REFERENCES sites (workspace_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Row-level security: enabled AND forced, one tenant policy, platform read.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['content_items', 'content_versions', 'content_comments', 'content_reviews', 'pipeline_runs',
                           'pipeline_steps', 'publications', 'rank_tracking_queue', 'link_checks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t || '_tenant_isolation', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO pg_database_owner USING (true)', t || '_platform_read', t);
  END LOOP;
END $$;

-- Version history and review decisions are append-only for the app role.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT grantee, table_name FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name IN ('content_versions', 'content_reviews') AND grantee <> current_user
      AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM %I', r.table_name, r.grantee);
  END LOOP;
END $$;
REVOKE UPDATE, DELETE, TRUNCATE ON content_versions, content_reviews FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- updated_at and audit
-- ---------------------------------------------------------------------------
CREATE TRIGGER touch BEFORE UPDATE ON content_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON pipeline_runs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON pipeline_steps FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch BEFORE UPDATE ON publications FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON content_items
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id', 'body_md', 'brief', 'topic', 'lint', 'fact_check', 'sources');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON content_versions
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id', 'body_md');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON content_comments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON content_reviews
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON pipeline_steps
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id', 'input', 'output');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON publications
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON rank_tracking_queue
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON link_checks
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('workspace_id');

-- ---------------------------------------------------------------------------
-- The worker's site list. Jobs work inside one workspace at a time
-- (withWorkspace: row-level security still applies); to know which
-- workspaces to visit, the worker reads this list of ids and schedule fields
-- and nothing else. Only "system:worker…" actors may call it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION job_sites()
  RETURNS TABLE (workspace_id uuid, site_id uuid, domain text, timezone text, status text, schedule_active boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF coalesce(app_setting('app.actor_id'), '') NOT LIKE 'system:worker%' THEN
    RAISE EXCEPTION 'job_sites: only the worker may list sites across workspaces' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT s.workspace_id, s.id, s.domain, s.timezone, s.status, s.schedule_active FROM sites s ORDER BY s.workspace_id, s.created_at;
END $$;

-- A public feed (/feeds/<token>/feed.json, rss.xml): the token names one site
-- whose feed is enabled. Returns only the ids needed to read it in its own
-- workspace scope.
CREATE FUNCTION feed_site(p_token text)
  RETURNS TABLE (workspace_id uuid, site_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT s.workspace_id, s.id FROM sites s
    WHERE p_token ~ '^[0-9a-f]{64}$' AND s.feed_token = p_token AND s.feed_enabled AND s.status = 'active'
  $$;
