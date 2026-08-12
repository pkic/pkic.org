-- Migration 0037: Organization content & contact columns
--
-- Step 2 (YAML → D1 import) needs somewhere real to write the
-- organization/member fields that data/members/*.yaml carries today
-- (description, long-form content, slogan, logo, blog/press/careers,
-- social links, primary/secondary contact, per-representative visibility
-- preference). Those columns are formally defined in (
-- Organization Profile Management), which hasn't shipped and isn't on the
-- critical path. Resolution, only the *data-bearing* columns
-- from list are pulled forward now; workflow-only additions
-- (voting_delegate_user_id, pending_secondary_contact_user_id,
-- logo_staging_r2_key, organization_content_reviews) stay —
-- nothing in the YAML import needs them.
--
-- No CHECK constraints, per this repo's standing convention (see migration
-- 0033's header) — every column here is free text or a
-- nullable FK.

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
ALTER TABLE organizations ADD COLUMN social_x TEXT;
ALTER TABLE organizations ADD COLUMN social_linkedin TEXT;
ALTER TABLE organizations ADD COLUMN social_facebook TEXT;
ALTER TABLE organizations ADD COLUMN social_instagram TEXT;
ALTER TABLE organizations ADD COLUMN social_youtube TEXT;
ALTER TABLE organizations ADD COLUMN primary_contact_user_id TEXT REFERENCES users(id);
ALTER TABLE organizations ADD COLUMN secondary_contact_user_id TEXT REFERENCES users(id);

-- Per-representative visibility preference. Defaults to
-- opted-in, matching schema default; the migration script overrides
-- this to 0 for domain-matched-but-unnamed representatives.
ALTER TABLE members ADD COLUMN show_on_org_profile INTEGER NOT NULL DEFAULT 1;
