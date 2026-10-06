-- Daily review notices use an independently editable template.
-- Preserve any existing versions or administrator customizations.
INSERT INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key,
   checksum_sha256, status, created_by_user_id, created_at, message_type)
SELECT lower(hex(randomblob(16))), 'membership-workflow-review-digest', 1,
  '{{stepLabel}}: membership applications — {{reviewDate}} UTC',
  '# {{stepLabel}}

We have received the following membership applications for review:

{{applicationSummary}}

Feedback and approval must be based solely on whether the applicant meets the stated membership criteria, without competitive considerations. Outreach should focus on collaboration and community.

{{instructions}}

Eligible reviewers have {{durationDays}} days after this notice is sent to respond. Each review page shows the exact deadline and current requirements. Record questions and objections on the review page.

## Application details

{{applicationDetails}}

Receiving this notice does not grant review permission. Sign in with your own account; eligibility is checked when you respond.',
  'markdown', NULL, '8ebd2f4be3bd4293874b8894d098284ed524921237bdcfab3cdf1c6343726a45',
  'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'transactional'
WHERE NOT EXISTS (
  SELECT 1 FROM email_template_versions WHERE template_key = 'membership-workflow-review-digest'
);
