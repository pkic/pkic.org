-- PR #817 introduced daily review digests without migrating their templates.
-- Add only missing active templates; preserve portal edits and version history.
INSERT INTO email_template_versions (
  id, template_key, version, subject_template, body, content_type, r2_object_key,
  checksum_sha256, status, created_by_user_id, created_at
)
SELECT
  '3a6d3f01-2d36-4b8a-be74-6ffd90f56edf',
  'membership-workflow-review-digest',
  COALESCE((SELECT MAX(version) FROM email_template_versions WHERE template_key = 'membership-workflow-review-digest'), 0) + 1,
  '{{stepLabel}}: membership applications — {{reviewDate}} UTC',
  'Dear {{#if isMemberConsultation}}Members{{else}}{{#if isExecutiveCouncil}}Executive Council{{else}}Reviewers{{/if}}{{/if}},

We have received the following membership applications:

{{applicationSummary}}

Applications must be approved by the Executive Council after feedback from the Members. Feedback and approval on a membership application by each Member and the Executive Council shall be based solely on a determination of whether the applicant meets the stated membership criteria, and not on any other basis including competitive considerations.

We would also like to remind you that welcoming new members must not be done with commercial objectives. Outreach should focus on collaboration and community, not on selling products or services.

Please only respond to this email if you have any questions or concerns regarding these membership applications. You can also record questions and objections on each application''s review page.

{{#if deliveryWindowClosesOn}}{{#if isMemberConsultation}}The feedback period{{else}}The review period{{/if}} will close on {{deliveryWindowClosesOn}} (UTC){{#if isMemberConsultation}}, at which point we will forward eligible applications to the Executive Council for final approval{{/if}}.{{else}}The feedback and review period will close {{durationDays}} days after this email is sent.{{/if}} Each review page shows the exact deadline and current requirements.

{{instructions}}

Below you will find the complete application details:

{{applicationDetails}}

Best regards,

PKI Consortium',
  'markdown',
  NULL,
  '0c435818e3a2908521a607200d2523abcd15d28ff218bd44026cfc3a361d3ffb',
  'active',
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (
  SELECT 1
  FROM email_template_versions
  WHERE template_key = 'membership-workflow-review-digest'
    AND status = 'active'
);

INSERT INTO email_template_versions (
  id, template_key, version, subject_template, body, content_type, r2_object_key,
  checksum_sha256, status, created_by_user_id, created_at
)
SELECT
  'c42b5b8c-6c45-45e3-90b9-f433438b32e9',
  'partial_membership_review_summary',
  COALESCE((SELECT MAX(version) FROM email_template_versions WHERE template_key = 'partial_membership_review_summary'), 0) + 1,
  NULL,
  '[Membership application from {{applicationName}}]({{reviewUrl}})',
  'markdown',
  NULL,
  '03e4588ae3c78faf376dde40d55bc4d7263eabf4e343be664ed4ac13c3b64f41',
  'active',
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (
  SELECT 1
  FROM email_template_versions
  WHERE template_key = 'partial_membership_review_summary'
    AND status = 'active'
);

INSERT INTO email_template_versions (
  id, template_key, version, subject_template, body, content_type, r2_object_key,
  checksum_sha256, status, created_by_user_id, created_at
)
SELECT
  'cea415fa-cb89-4c12-b61c-cd170ca7ee5f',
  'partial_membership_review_details',
  COALESCE((SELECT MAX(version) FROM email_template_versions WHERE template_key = 'partial_membership_review_details'), 0) + 1,
  NULL,
  -- Preserve Markdown hard line breaks without trailing whitespace in the SQL source.
  '### Membership application from {{applicationName}}

Category: ({{categoryCode}}) {{categoryLabel}}' || char(32, 32, 10) ||
'Applicant name: {{applicantName}}' || char(32, 32, 10) ||
'Email: {{applicantEmail}}' || char(32, 32, 10) ||
'{{#if organizationName}}Organization: {{organizationName}}' || char(32, 32, 10) ||
'{{/if}}{{#each answerRows}}{{label}}: {{value}}' || char(32, 32, 10) ||
'{{/each}}
{{#each objections}}> {{#if author}}**{{author}}:** {{/if}}{{body}}

{{/each}}[Read the application form and respond]({{reviewUrl}})',
  'markdown',
  NULL,
  'f32d8d6a14a4dc814b947b5927b4dce0447b852a7ad7cef1a86e8644e7b02556',
  'active',
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (
  SELECT 1
  FROM email_template_versions
  WHERE template_key = 'partial_membership_review_details'
    AND status = 'active'
);
