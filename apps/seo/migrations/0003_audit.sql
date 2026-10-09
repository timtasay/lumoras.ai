-- 0003 audit
-- The audit log: who, what, when, before and after, workspace, impersonator.
--
-- Rows are written ONLY by the trigger functions below, inside the same
-- transaction as the change they describe, so a write and its audit row commit
-- or roll back together. The app role can read its own workspace's rows
-- (row-level security) and cannot insert, update or delete any.
--
-- Context comes from transaction-local settings that lib/db/tenant.ts sets on
-- every tenant transaction (and lib/auth/audited-pool.ts on Better Auth's
-- connections):
--   app.workspace_id    the workspace being acted on (row-level security key)
--   app.actor_id        user uuid, or 'system:<name>' for jobs and scripts
--   app.impersonator_id platform admin's user id while impersonating
--   app.action          intent, e.g. 'site.create' (defaults to '<table>.<op>')
--   app.request_id      correlates rows written by one request
--   app.audit_workspace_id  workspace hint for events on non-tenant tables

-- '' and unset both mean "not set".
CREATE FUNCTION app_setting(name text) RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting(name, true), '') $$;

CREATE TABLE audit_log (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at               timestamptz NOT NULL DEFAULT now(),
  -- no foreign key: the trail outlives a deleted workspace (platform admins can still read it)
  workspace_id     uuid,
  actor_id         text,
  impersonator_id  uuid,
  action           text        NOT NULL,
  entity_type      text        NOT NULL,
  entity_id        text,
  before           jsonb,
  after            jsonb,
  details          jsonb,
  request_id       text
);
CREATE INDEX audit_log_workspace_idx ON audit_log (workspace_id, id DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, id DESC);
COMMENT ON TABLE audit_log IS 'Append-only audit trail, written by trigger functions in the same transaction as each change.';

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
-- tenants read their own workspace's trail (rows with no workspace are platform events)
CREATE POLICY audit_log_tenant_read ON audit_log FOR SELECT
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
-- the owner role (SECURITY DEFINER trigger and platform functions) appends and reads everything
CREATE POLICY audit_log_definer_insert ON audit_log FOR INSERT TO pg_database_owner WITH CHECK (true);
CREATE POLICY audit_log_platform_read ON audit_log FOR SELECT TO pg_database_owner USING (true);

-- Append-only for the app: take back the INSERT/UPDATE/DELETE that the default
-- privileges (deploy/postgres/10-seo-database.sh) granted on this new table.
-- The app role is not named in migrations, so revoke from every grantee.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT grantee FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'audit_log' AND grantee <> current_user
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM %I', r.grantee);
  END LOOP;
END $$;

-- Replaces a secret column's value with a short fingerprint, so the trail shows
-- that it changed without ever holding it (not even the ciphertext).
CREATE FUNCTION audit_redact(j jsonb, col text) RETURNS jsonb
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT CASE
      WHEN j IS NULL OR NOT (j ? col) OR jsonb_typeof(j -> col) = 'null' THEN j
      ELSE jsonb_set(j, ARRAY[col], to_jsonb('[redacted ' || left(md5(j ->> col), 8) || ']'))
    END
  $$;

-- Row-level audit trigger.
--   TG_ARGV[0]   the column holding the workspace id ('' for platform tables)
--   TG_ARGV[1..] columns to redact
-- Tenant tables (anything not prefixed auth_) refuse a write with no actor:
-- every tenant write must say who did it.
CREATE FUNCTION audit_row_change() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  old_j jsonb;
  new_j jsonb;
  row_j jsonb;
  actor text := app_setting('app.actor_id');
  i int;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN old_j := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN new_j := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND old_j = new_j THEN
    RETURN NULL; -- nothing changed
  END IF;
  IF actor IS NULL AND TG_TABLE_NAME NOT LIKE 'auth\_%' THEN
    RAISE EXCEPTION 'audit: % on % has no actor (app.actor_id); tenant writes must go through withWorkspace()', TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    old_j := audit_redact(old_j, TG_ARGV[i]);
    new_j := audit_redact(new_j, TG_ARGV[i]);
  END LOOP;
  row_j := coalesce(new_j, old_j);
  INSERT INTO audit_log (workspace_id, actor_id, impersonator_id, action, entity_type, entity_id, before, after, request_id)
  VALUES (
    CASE WHEN TG_ARGV[0] = '' THEN app_setting('app.audit_workspace_id')::uuid ELSE (row_j ->> TG_ARGV[0])::uuid END,
    actor,
    app_setting('app.impersonator_id')::uuid,
    coalesce(app_setting('app.action'), TG_TABLE_NAME || '.' || lower(TG_OP)),
    TG_TABLE_NAME,
    row_j ->> 'id',
    old_j,
    new_j,
    app_setting('app.request_id')
  );
  RETURN NULL;
END $$;

-- Impersonation trail: an auth_session row with impersonated_by set is an
-- impersonation; its creation and deletion are recorded with the platform
-- admin as the actor and the impersonated user as the entity. The session
-- token is never copied.
CREATE FUNCTION audit_impersonation() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  s auth_session;
BEGIN
  IF TG_OP = 'DELETE' THEN s := OLD; ELSE s := NEW; END IF;
  INSERT INTO audit_log (workspace_id, actor_id, impersonator_id, action, entity_type, entity_id, after, request_id)
  VALUES (
    app_setting('app.audit_workspace_id')::uuid,
    s.impersonated_by::text,
    s.impersonated_by,
    CASE WHEN TG_OP = 'DELETE' THEN 'impersonation.stop' ELSE 'impersonation.start' END,
    'auth_user',
    s.user_id::text,
    jsonb_build_object('session_id', s.id, 'target_user_id', s.user_id, 'expires_at', s.expires_at,
                       'ip_address', s.ip_address, 'user_agent', s.user_agent),
    app_setting('app.request_id')
  );
  RETURN NULL;
END $$;

CREATE TRIGGER audit_impersonation_start AFTER INSERT ON auth_session
  FOR EACH ROW WHEN (NEW.impersonated_by IS NOT NULL) EXECUTE FUNCTION audit_impersonation();
CREATE TRIGGER audit_impersonation_stop AFTER DELETE ON auth_session
  FOR EACH ROW WHEN (OLD.impersonated_by IS NOT NULL) EXECUTE FUNCTION audit_impersonation();

-- Better Auth's tenant-relevant tables: workspaces (organizations), members, invitations, users.
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON auth_organization
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON auth_member
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('organization_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON auth_invitation
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('organization_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON auth_user
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('');

-- Non-row events (a crawl requested, a platform read, a sign-in link sent):
-- recorded against the current workspace (if any) and the current actor.
CREATE FUNCTION app_audit_event(p_action text, p_entity_type text, p_entity_id text, p_details jsonb DEFAULT NULL)
  RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  new_id bigint;
BEGIN
  IF app_setting('app.actor_id') IS NULL THEN
    RAISE EXCEPTION 'audit: event % has no actor (app.actor_id)', p_action USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO audit_log (workspace_id, actor_id, impersonator_id, action, entity_type, entity_id, details, request_id)
  VALUES (
    coalesce(app_setting('app.workspace_id'), app_setting('app.audit_workspace_id'))::uuid,
    app_setting('app.actor_id'),
    app_setting('app.impersonator_id')::uuid,
    p_action, p_entity_type, p_entity_id, p_details,
    app_setting('app.request_id')
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

REVOKE EXECUTE ON FUNCTION audit_row_change(), audit_impersonation() FROM PUBLIC;
