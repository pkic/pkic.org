-- Migration 0040: Organization content columns
--
-- Step 2 (YAML → D1 import) needs somewhere real to write the
-- organization/member fields that data/members/*.yaml carries today
-- (description, long-form content, slogan, logo, blog/press/careers,
-- links). Those columns are formally defined in (Organization Profile
-- Management), which hasn't shipped and isn't on the critical path.
-- Resolution, only the *data-bearing* columns from that list are pulled
-- forward now; workflow-only additions (logo_staging_r2_key,
-- organization_content_reviews) land in migration 0044.
--
-- Primary/secondary contact and per-representative profile visibility are
-- NOT columns here: primary/secondary contact are organization-context
-- role-primary_contact/role-secondary_contact grants in user_roles
-- (migration 0038), and per-representative visibility is
-- organization_representatives.show_on_org_profile (migration 0037) — both
-- are relationship-owned, not organization- or member-owned facts.
--
-- Social links use the same canonical `links_json` array
-- (assets/shared/schemas/api.ts's linksSchema) that `users.links_json`
-- already uses (migration 0000), reusing the existing generic links UI
-- (ProfileLinksInput) instead of per-provider columns that make the schema
-- depend on whichever social networks happen to exist today. blog/press/
-- careers stay dedicated columns — those have distinct application
-- behavior (feed URLs), unlike display-only social links.
--
-- No CHECK constraints, per this repo's standing convention — every column
-- here is free text.

ALTER TABLE organizations ADD COLUMN description TEXT;
ALTER TABLE organizations ADD COLUMN website TEXT;
ALTER TABLE organizations ADD COLUMN content_markdown TEXT;
ALTER TABLE organizations ADD COLUMN slogan TEXT;
ALTER TABLE organizations ADD COLUMN logo_r2_key TEXT;
ALTER TABLE organizations ADD COLUMN blog_url TEXT;
ALTER TABLE organizations ADD COLUMN blog_feed_url TEXT;
ALTER TABLE organizations ADD COLUMN press_url TEXT;
ALTER TABLE organizations ADD COLUMN press_feed_url TEXT;
ALTER TABLE organizations ADD COLUMN careers_url TEXT;
ALTER TABLE organizations ADD COLUMN links_json TEXT;
