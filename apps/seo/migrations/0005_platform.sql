-- 0005 platform
-- The platform-admin (Lumoras staff) cross-workspace read path.
--
-- The app role cannot see across workspaces: row-level security binds it to
-- app.workspace_id. Platform admins read across workspaces ONLY through the
-- SECURITY DEFINER functions below. They run as the owner role, whose
-- SELECT-only policies (TO pg_database_owner, 0003/0004) see every row, and
-- each one:
--   1. checks that app.actor_id is a platform admin (auth_user.role = 'admin',
--      not banned) and refuses otherwise;
--   2. writes an audit row (platform.*) before returning anything;
--   3. returns aggregates or the audit trail, never secrets.
-- There is no write path: platform admins change a workspace by impersonating
-- one of its members, which is itself audited (impersonation.start/stop).

CREATE FUNCTION platform_require_admin() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  actor uuid;
BEGIN
  BEGIN
    actor := app_setting('app.actor_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    actor := NULL;
  END;
  IF actor IS NULL OR app_setting('app.impersonator_id') IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM auth_user u
    WHERE u.id = actor AND u.role = 'admin' AND (u.banned IS NOT TRUE OR (u.ban_expires IS NOT NULL AND u.ban_expires < now()))
  ) THEN
    RAISE EXCEPTION 'platform: % is not a platform admin', coalesce(app_setting('app.actor_id'), '(no actor)')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN actor;
END $$;

-- Every workspace with health at a glance (Phase 1 numbers; runway, clicks,
-- budget and review counts arrive with their phases).
CREATE FUNCTION platform_workspace_summaries()
  RETURNS TABLE (
    id uuid, name text, slug text, created_at timestamptz, status text, onboarding_step text,
    sites integer, members integer, owners text[], routes integer,
    failing_connections integer, last_crawl_at timestamptz, last_activity_at timestamptz
  )
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM platform_require_admin();
  PERFORM app_audit_event('platform.workspaces.read', 'workspaces', NULL, NULL);
  RETURN QUERY
    SELECT o.id, o.name, o.slug, o.created_at, w.status, w.onboarding_step,
      (SELECT count(*)::int FROM sites s WHERE s.workspace_id = o.id),
      (SELECT count(*)::int FROM auth_member m WHERE m.organization_id = o.id),
      (SELECT coalesce(array_agg(u.email ORDER BY u.email), '{}') FROM auth_member m JOIN auth_user u ON u.id = m.user_id
        WHERE m.organization_id = o.id AND m.role = 'owner'),
      (SELECT count(*)::int FROM site_routes r WHERE r.workspace_id = o.id),
      (SELECT count(*)::int FROM connections c WHERE c.workspace_id = o.id AND c.status = 'error'),
      (SELECT max(s.last_crawl_at) FROM sites s WHERE s.workspace_id = o.id),
      (SELECT max(a.at) FROM audit_log a WHERE a.workspace_id = o.id)
    FROM auth_organization o
    LEFT JOIN workspaces w ON w.id = o.id
    ORDER BY o.name;
END $$;

-- Members of one workspace (to pick whom to impersonate).
CREATE FUNCTION platform_workspace_members(p_workspace uuid)
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
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.email;
END $$;

-- The audit trail across every workspace (or one), newest first, keyset-paginated.
CREATE FUNCTION platform_audit_log(p_workspace uuid DEFAULT NULL, p_before bigint DEFAULT NULL, p_limit integer DEFAULT 50)
  RETURNS TABLE (
    id bigint, at timestamptz, workspace_id uuid, workspace_name text, actor_id text, actor_email text,
    impersonator_id uuid, impersonator_email text, action text, entity_type text, entity_id text,
    before jsonb, after jsonb, details jsonb
  )
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM platform_require_admin();
  PERFORM app_audit_event('platform.audit.read', 'audit_log', p_workspace::text, jsonb_build_object('before', p_before));
  RETURN QUERY
    SELECT a.id, a.at, a.workspace_id, o.name, a.actor_id, au.email, a.impersonator_id, iu.email,
           a.action, a.entity_type, a.entity_id, a.before, a.after, a.details
    FROM audit_log a
    LEFT JOIN auth_organization o ON o.id = a.workspace_id
    LEFT JOIN auth_user au ON au.id::text = a.actor_id
    LEFT JOIN auth_user iu ON iu.id = a.impersonator_id
    WHERE (p_workspace IS NULL OR a.workspace_id = p_workspace)
      AND (p_before IS NULL OR a.id < p_before)
    ORDER BY a.id DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END $$;

REVOKE EXECUTE ON FUNCTION platform_require_admin(), platform_workspace_summaries(),
  platform_workspace_members(uuid), platform_audit_log(uuid, bigint, integer) FROM PUBLIC;
