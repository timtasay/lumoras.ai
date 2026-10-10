-- 0010 "Lumoras Growth serves it" (owner decision, 10 October 2026)
--
-- sonorch.ai and seasonx.ai read new articles from Lumoras Growth at request
-- time instead of from files in their repositories, so publishing needs no
-- commit, merge or deploy (docs/content-api.md).
--
-- 1. A publishing connection of kind content_api: no remote, no credential.
-- 2. Publishing through it records the article exactly as the site will show
--    it (publications.payload); the public endpoint serves those snapshots,
--    never the live, editable draft.
-- 3. posts_feed_site(token): the site whose feed token this is, when its
--    publishing connection is content_api. Ids only, like feed_site(); the
--    articles are then read inside that workspace under row-level security.

ALTER TABLE connections DROP CONSTRAINT connections_kind_check;
ALTER TABLE connections ADD CONSTRAINT connections_kind_check
  CHECK (kind IN ('git', 'wordpress', 'webflow', 'ghost', 'webhook', 'content_api', 'search_console', 'ga4', 'social'));

ALTER TABLE publications DROP CONSTRAINT publications_publisher_check;
ALTER TABLE publications ADD CONSTRAINT publications_publisher_check CHECK (publisher IN ('github', 'gitea', 'webhook', 'content_api'));
ALTER TABLE publications DROP CONSTRAINT publications_mode_check;
ALTER TABLE publications ADD CONSTRAINT publications_mode_check CHECK (mode IN ('pr', 'commit', 'webhook', 'api'));

-- the article as served (docs/content-api.md "posts" item), set when publisher = content_api
ALTER TABLE publications
  ADD COLUMN payload jsonb CHECK (payload IS NULL OR (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 200000));
CREATE INDEX publications_api_idx ON publications (site_id, created_at DESC) WHERE publisher = 'content_api';

CREATE FUNCTION posts_feed_site(p_token text)
  RETURNS TABLE (workspace_id uuid, site_id uuid, domain text, connection_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT s.workspace_id, s.id, s.domain, c.id FROM sites s
    JOIN connections c ON c.id = s.publish_connection_id AND c.site_id = s.id AND c.kind = 'content_api'
    WHERE p_token ~ '^[0-9a-f]{64}$' AND s.feed_token = p_token AND s.status = 'active'
  $$;
