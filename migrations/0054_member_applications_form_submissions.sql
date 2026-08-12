-- Migration 0054: member_applications off answers_json, onto form_submissions
--
-- PR review (vanbroup, migrations/0034 line 45): member_applications reserved
-- a form_submission_id FK to the generic forms/form_submissions system but
-- never used it, instead inventing a second answers store in answers_json.
-- This closes that gap: every existing application's answers_json becomes a
-- real form_submissions row (linked to the 'membership-application' form
-- already seeded by migration 0034) plus one form_submission_answers row per
-- key, form_submission_id is backfilled to point at it, and answers_json is
-- dropped. Going forward, functions/_lib/services/member-applications.ts
-- writes new applications directly into form_submissions/form_submission_answers.
--
-- The backfilled form_submissions.id intentionally reuses the owning
-- member_applications.id (a fresh UUID in a different table's primary key
-- space, so no collision risk) — this gives each INSERT..SELECT below a
-- shared join key without needing an intermediate temp table to correlate
-- freshly-generated random ids across statements.

INSERT INTO form_submissions (id, form_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
SELECT
  ma.id,
  (SELECT id FROM forms WHERE key = 'membership-application'),
  NULL,
  'membership',
  ma.id,
  'submitted',
  ma.created_at
FROM member_applications ma
WHERE ma.answers_json IS NOT NULL
  AND (SELECT id FROM forms WHERE key = 'membership-application') IS NOT NULL;

-- json_each's `value` column is already dequoted for scalar entries (e.g. a
-- JSON string yields the bare TEXT) but is the raw JSON text for array/object
-- entries (e.g. `working_groups`/`legalAgreements`) — re-quote only the
-- scalar case so `data_json` always holds valid, parseable JSON, matching
-- what form_submission_answers holds everywhere else it's read (see
-- functions/api/v1/admin/forms/[formKey]/submissions.ts).
INSERT INTO form_submission_answers (id, submission_id, field_key, data_json, created_at)
SELECT
  lower(hex(randomblob(16))),
  ma.id,
  je.key,
  CASE je.type
    WHEN 'array' THEN je.value
    WHEN 'object' THEN je.value
    WHEN 'true' THEN 'true'
    WHEN 'false' THEN 'false'
    WHEN 'null' THEN 'null'
    ELSE json_quote(je.value)
  END,
  ma.created_at
FROM member_applications ma, json_each(ma.answers_json) je
WHERE ma.answers_json IS NOT NULL
  AND (SELECT id FROM forms WHERE key = 'membership-application') IS NOT NULL;

UPDATE member_applications
SET form_submission_id = id
WHERE answers_json IS NOT NULL
  AND (SELECT id FROM forms WHERE key = 'membership-application') IS NOT NULL;

ALTER TABLE member_applications DROP COLUMN answers_json;
