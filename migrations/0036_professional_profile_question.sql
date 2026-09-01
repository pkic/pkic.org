-- The membership application's profile question, opened up (maintainer ruling,
-- 2026-09-01): any professional profile that verifies the applicant is
-- accepted — LinkedIn works, and so does a leadership page at their employer.
-- The label names LinkedIn as the example so applicants still know what kind
-- of link is meant, and the placeholder shows the shape. The field's KEY stays
-- 'linkedin': it identifies stored answers, and on approval the answer already
-- flows into the canonical links list, where no platform is special.
UPDATE form_fields
SET label = 'Professional profile (e.g., LinkedIn)',
    validation_json = json_patch(
      coalesce(validation_json, '{}'),
      '{"placeholder": "https://www.linkedin.com/in/your-name or your employer''s page about you"}'
    )
WHERE key = 'linkedin'
  AND form_id = (SELECT id FROM forms WHERE key = 'membership-application');
