-- Replace organizations' five per-provider social_* columns (migration
-- 0037) with one canonical `links_json` array, matching the same
-- `linksSchema`/`links_json` convention `users` already uses (migration
-- 0050) and reusing the existing generic links UI (ProfileLinksInput)
-- instead of a bespoke per-provider form. Flagged in PR #1 review: these
-- columns made the schema depend on whichever social networks happen to
-- exist today, despite the repo already having a generic links contract.
-- blog/press/careers stay dedicated columns — those have distinct
-- application behavior (feed URLs), unlike display-only social links.
ALTER TABLE organizations ADD COLUMN links_json TEXT;

UPDATE organizations
SET links_json = (
  SELECT json_group_array(value)
  FROM (
    SELECT organizations.social_x AS value WHERE organizations.social_x IS NOT NULL
    UNION ALL
    SELECT organizations.social_linkedin AS value WHERE organizations.social_linkedin IS NOT NULL
    UNION ALL
    SELECT organizations.social_facebook AS value WHERE organizations.social_facebook IS NOT NULL
    UNION ALL
    SELECT organizations.social_instagram AS value WHERE organizations.social_instagram IS NOT NULL
    UNION ALL
    SELECT organizations.social_youtube AS value WHERE organizations.social_youtube IS NOT NULL
  )
)
WHERE social_x IS NOT NULL
   OR social_linkedin IS NOT NULL
   OR social_facebook IS NOT NULL
   OR social_instagram IS NOT NULL
   OR social_youtube IS NOT NULL;

ALTER TABLE organizations DROP COLUMN social_x;
ALTER TABLE organizations DROP COLUMN social_linkedin;
ALTER TABLE organizations DROP COLUMN social_facebook;
ALTER TABLE organizations DROP COLUMN social_instagram;
ALTER TABLE organizations DROP COLUMN social_youtube;
