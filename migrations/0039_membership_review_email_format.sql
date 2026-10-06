-- Preserve migration history and portal-authored template customizations.
-- Upgrade only the untouched digest baseline and seed editable application fragments.
INSERT INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key,
   checksum_sha256, status, created_by_user_id, created_at, message_type)
SELECT lower(hex(randomblob(16))), 'membership-workflow-review-digest', 2, '{{stepLabel}}: membership applications — {{reviewDate}} UTC',
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

PKI Consortium', 'markdown', NULL, '0c435818e3a2908521a607200d2523abcd15d28ff218bd44026cfc3a361d3ffb',
  'draft', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'transactional'
WHERE EXISTS (SELECT 1 FROM email_template_versions WHERE template_key = 'membership-workflow-review-digest' AND version = 1 AND status = 'active' AND created_by_user_id IS NULL AND checksum_sha256 = '8ebd2f4be3bd4293874b8894d098284ed524921237bdcfab3cdf1c6343726a45')
  AND NOT EXISTS (SELECT 1 FROM email_template_versions WHERE template_key = 'membership-workflow-review-digest' AND version > 1);

UPDATE email_template_versions SET status = 'archived'
WHERE template_key = 'membership-workflow-review-digest' AND version = 1 AND status = 'active'
  AND created_by_user_id IS NULL AND checksum_sha256 = '8ebd2f4be3bd4293874b8894d098284ed524921237bdcfab3cdf1c6343726a45'
  AND EXISTS (SELECT 1 FROM email_template_versions candidate WHERE candidate.template_key = 'membership-workflow-review-digest'
    AND candidate.version = 2 AND candidate.status = 'draft' AND candidate.created_by_user_id IS NULL AND candidate.checksum_sha256 = '0c435818e3a2908521a607200d2523abcd15d28ff218bd44026cfc3a361d3ffb');

UPDATE email_template_versions SET status = 'active'
WHERE template_key = 'membership-workflow-review-digest' AND version = 2 AND status = 'draft'
  AND created_by_user_id IS NULL AND checksum_sha256 = '0c435818e3a2908521a607200d2523abcd15d28ff218bd44026cfc3a361d3ffb'
  AND NOT EXISTS (SELECT 1 FROM email_template_versions candidate WHERE candidate.template_key = 'membership-workflow-review-digest' AND candidate.status = 'active');

INSERT INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key,
   checksum_sha256, status, created_by_user_id, created_at, message_type)
SELECT lower(hex(randomblob(16))), 'partial_membership_review_summary', 1, NULL,
  '[Membership application from {{applicationName}}]({{reviewUrl}})', 'markdown', NULL, '03e4588ae3c78faf376dde40d55bc4d7263eabf4e343be664ed4ac13c3b64f41',
  'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'transactional'
WHERE NOT EXISTS (SELECT 1 FROM email_template_versions WHERE template_key = 'partial_membership_review_summary');

INSERT INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key,
   checksum_sha256, status, created_by_user_id, created_at, message_type)
SELECT lower(hex(randomblob(16))), 'partial_membership_review_details', 1, NULL,
  '### Membership application from {{applicationName}}

Category: ({{categoryCode}}) {{categoryLabel}}  
Applicant name: {{applicantName}}  
Email: {{applicantEmail}}  
{{#if organizationName}}Organization: {{organizationName}}  
{{/if}}{{#each answerRows}}{{label}}: {{value}}  
{{/each}}
{{#each objections}}> {{#if author}}**{{author}}:** {{/if}}{{body}}

{{/each}}[Read the application form and respond]({{reviewUrl}})', 'markdown', NULL, 'f32d8d6a14a4dc814b947b5927b4dce0447b852a7ad7cef1a86e8644e7b02556',
  'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'transactional'
WHERE NOT EXISTS (SELECT 1 FROM email_template_versions WHERE template_key = 'partial_membership_review_details');

