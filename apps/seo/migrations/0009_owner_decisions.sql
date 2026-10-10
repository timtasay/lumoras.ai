-- 0009 owner decisions (10 October 2026, docs/owner-decisions.md)
--
-- 1. Bylines: "Lumoras team" is acceptable. An author is either a person or
--    an organization. Both are configured by the client per site and never
--    invented; an organization byline carries no personal title or
--    credential (role stays empty) and is published as schema.org
--    Organization, a person as Person. Existing rows are people.
-- 2. SEO data provider: OpenSEO on the owner's hosted account. A site may
--    name the OpenSEO project its research runs in; empty means the default
--    project (OPENSEO_PROJECT_ID), else one found or created for its domain.
--
-- Both tables are tenant tables already (forced RLS, audit triggers from
-- 0004); new columns are covered by the existing policies and triggers.

ALTER TABLE authors
  ADD COLUMN kind text NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'organization'));
-- an organization has no job title or credentials: role is a person's real title only
ALTER TABLE authors
  ADD CONSTRAINT authors_organization_has_no_title CHECK (kind = 'person' OR role = '');

ALTER TABLE sites
  -- OpenSEO project ids are opaque; no ':' because tracker and audit ids are "<projectId>:<id>"
  ADD COLUMN openseo_project_id text CHECK (openseo_project_id IS NULL OR openseo_project_id ~ '^[A-Za-z0-9._-]{1,100}$');
