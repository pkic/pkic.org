-- Clean-URL slug for public organization/member profile pages
-- (`/members/<slug>` instead of `/members/profile/?id=<uuid>`).
--
-- The legacy Hugo member YAML files (`data/members/*.yaml`) each carry a
-- top-level `id:` key (e.g. `id: keyfactor`) that scripts/migrate-members-
-- yaml-to-d1.mjs previously only used transiently for logo/photo directory
-- lookups, never persisting it. This column gives it a permanent home so
-- the migration script (and, later, admin-authored orgs) can back a stable,
-- human-readable public URL. Individuals (H5/H6/H7, no `organizations` row)
-- are out of scope here — they keep UUID-keyed profile URLs.
ALTER TABLE organizations ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX idx_organizations_slug ON organizations(slug) WHERE slug IS NOT NULL;
