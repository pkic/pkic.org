-- Weekly working-group membership-change digest for WG chairs/vice-chairs
-- (2026-07-31 manual-testing feedback). "Send an email to the chairs when
-- someone joins or leaves the working group... not a spam email every time
-- there is a change" — batched weekly, one email per (working group, chair)
-- pair, only for groups with at least one join/leave in the past 7 days.
-- See functions/_lib/services/wg-chair-digest.ts.
--
-- No schema change needed for the opt-out preference itself — it's a new
-- key (`wgChairMembershipDigest`, default true) on the existing
-- `users.notification_preferences_json` blob added by migration 0045, per
-- that migration's own "no CHECK constraint, validated at the application
-- layer" convention. This migration only seeds the email template.

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES (
  lower(hex(randomblob(16))), 'wg-chair-membership-digest', 1,
  '{{workingGroupName}} — weekly membership update',
  'Hi {{recipientName}},

Here is a summary of {{workingGroupName}} membership changes over the past week:

{{#joined}}
+ {{name}} ({{organizationName}}) joined
{{/joined}}
{{#left}}
- {{name}} ({{organizationName}}) left
{{/left}}

You are receiving this because you are the {{recipientRole}} of this working group. You can turn this off any time in your portal Account Settings under Notification preferences.',
  'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
);
