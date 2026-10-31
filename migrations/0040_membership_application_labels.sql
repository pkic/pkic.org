-- Sentence-case the seeded membership application questions. A label an
-- administrator has already edited no longer matches and is left alone.

UPDATE form_fields
SET label = 'Role or job title'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'job_title'
  AND label = 'Role / Job Title';

UPDATE form_fields
SET label = 'Organization website'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'organization_website'
  AND label = 'Organization Website';

UPDATE form_fields
SET label = 'About yourself'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'about_yourself'
  AND label = 'About Yourself';

UPDATE form_fields
SET label = 'About your organization'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'about_organization'
  AND label = 'About Your Organization';

UPDATE form_fields
SET label = 'Why do you want to join the PKI Consortium?'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'reason'
  AND label = 'Why do you want to join PKI Consortium?';

UPDATE form_fields
SET label = 'Working groups of interest'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'working_groups'
  AND label = 'Working Groups of Interest';
