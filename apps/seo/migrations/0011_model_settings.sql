-- 0011 model choice (owner request, 10 October 2026)
--
-- Platform admins choose which model each pipeline step uses (topic choice,
-- brief, draft, fact-check) from the provider's catalog, without a deploy.
-- One platform-wide row; the env defaults (LLM_MODEL_DRAFT / _REVIEW) apply
-- to any step left unset.
--
-- platform_settings is not a tenant table: row-level security is on with no
-- policy, so the app role reads and writes nothing directly. Reads go through
-- llm_model_settings() (non-secret: model names and their list prices);
-- writes through platform_set_llm_models(), which requires a platform admin
-- (not while impersonating) and writes an audit row.

CREATE TABLE platform_settings (
  key         text        PRIMARY KEY CHECK (key ~ '^[a-z_]{1,40}$'),
  value       jsonb       NOT NULL CHECK (jsonb_typeof(value) = 'object' AND octet_length(value::text) <= 20000),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION llm_model_settings() RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT coalesce((SELECT value FROM platform_settings WHERE key = 'llm_models'), '{}'::jsonb) $$;

CREATE FUNCTION platform_set_llm_models(p_value jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  actor uuid := platform_require_admin();
  old jsonb := llm_model_settings();
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'llm models: an object is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('llm_models', p_value, now(), actor)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = actor;
  PERFORM app_audit_event('platform.llm_models.set', 'platform_settings', 'llm_models', jsonb_build_object('before', old -> 'models', 'after', p_value -> 'models'));
END $$;
