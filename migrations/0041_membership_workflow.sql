-- Migration 0041: Membership Workflow Migration
--
-- Built application submission and the
-- public read API; built access control; built passkeys.
-- Nothing yet takes an application through review -> consultation ->
-- EC review -> approval -> onboarding, and nothing lets an approved member
-- log in and self-manage. This migration adds the schema those flows need.
--
-- Enforcement policy (PR #1 review, §1.3): boolean-as-integer flags get a
-- DB CHECK (durable structural invariant, not expected to gain a third
-- value) — see `is_ec_member` below. Evolvable closed-state vocabularies
-- (application/sponsorship stage, on-hold subtype, sync-queue status) stay
-- `-- allowed:` comments validated by a shared Zod schema on every write
-- path instead of a CHECK, since retiring/adding a workflow stage should be
-- additive, not a migration.

-- ── EC member designation ─────────────────────────────────────────
-- A distinct designation from `membership:approve` — controls who receives
-- ec-review-batch emails and who sees the EC decision screen, independent
-- of staff/processor role.
ALTER TABLE users ADD COLUMN is_ec_member INTEGER NOT NULL DEFAULT 0 CHECK (is_ec_member IN (0, 1));

-- ── Organization domain(s) (duplicate-check gap) ────────────────────
-- Duplicate-domain check only covered member_applications, not approved
-- members, because organizations had no domain relation. Domains are
-- normalized identity data used for uniqueness and lookup, not flexible
-- display metadata, so they get a real indexed table directly rather than a
-- JSON column normalized later. Populated at approval time from the
-- applicant's email domain; existing organizations are not backfilled.
CREATE TABLE organization_domains (
  id              TEXT NOT NULL PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  domain          TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_organization_domains_domain ON organization_domains(domain);
CREATE INDEX idx_organization_domains_org ON organization_domains(organization_id);

-- ── EC decisions ───────────────────────
CREATE TABLE ec_decisions (
  id                TEXT NOT NULL PRIMARY KEY,
  application_id    TEXT NOT NULL,
  ec_member_user_id TEXT NOT NULL,
  decision          TEXT NOT NULL,
  -- allowed: approve | decline
  reason            TEXT,
  -- required (application layer) when decision = decline
  created_at        TEXT NOT NULL,
  UNIQUE(application_id, ec_member_user_id),
  FOREIGN KEY(application_id) REFERENCES member_applications(id),
  FOREIGN KEY(ec_member_user_id) REFERENCES users(id)
);

CREATE INDEX idx_ec_decisions_application ON ec_decisions(application_id);

-- ── Application concerns ────────────────────────────────────
-- Visible only to staff/processors, never to the applicant — enforced at
-- the application layer (no public read endpoint returns this table).
CREATE TABLE application_concerns (
  id                  TEXT NOT NULL PRIMARY KEY,
  application_id      TEXT NOT NULL,
  submitted_by_user_id TEXT NOT NULL,
  concern_text        TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES member_applications(id),
  FOREIGN KEY(submitted_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_application_concerns_application ON application_concerns(application_id);

-- ── Application communications & notes ────────────────────────────
-- The table distinguishes two write operations: a templated/free-form
-- email to the applicant (recorded here for the staff-only audit trail —
-- the email itself is queued via the existing email_outbox) and an internal
-- note (never emailed). Reusing member_application_events for either would
-- conflate "stage transition happened" with "someone wrote something", so
-- they get their own table with a `kind` discriminator instead.
CREATE TABLE application_communications (
  id             TEXT NOT NULL PRIMARY KEY,
  application_id TEXT NOT NULL,
  kind           TEXT NOT NULL,
  -- allowed: communication | note
  actor_user_id  TEXT NOT NULL,
  subject        TEXT,
  -- set for kind='communication' (templated or free-form email subject)
  body           TEXT NOT NULL,
  template_key   TEXT,
  -- set when kind='communication' was sent from a template
  email_outbox_id TEXT,
  -- set when kind='communication' — links to the queued email
  created_at     TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES member_applications(id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);

CREATE INDEX idx_application_communications_application ON application_communications(application_id, created_at);

-- ── Google Groups sync queue ────────────────────────────────
-- Zero existing code for Google Groups sync prior to this migration. Every
-- trigger point (approval onboarding, WG join/leave, deactivation) writes a
-- row here; a processor (folded into the existing 15-minute due-work cron)
-- calls the Google Admin Directory API when service-account secrets are
-- configured, and leaves the row `pending` with a logged reason otherwise.
CREATE TABLE google_groups_sync_queue (
  id                TEXT NOT NULL PRIMARY KEY,
  user_id           TEXT NOT NULL,
  action            TEXT NOT NULL,
  -- allowed: add_to_list | remove_from_list
  google_group_email TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  -- allowed: pending | processing | completed | failed
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  created_at        TEXT NOT NULL,
  processed_at      TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX idx_google_groups_sync_queue_status ON google_groups_sync_queue(status, created_at);

-- ── Membership workflow settings ───────────────────────────────────
-- Single configurable row (id is always 'default') rather than a generic
-- key-value table — every setting is a distinct, typed field the
-- consultation/EC batch jobs and the admin settings screen both read
-- directly, and there is exactly one workflow-wide configuration, not a
-- per-entity one.
CREATE TABLE membership_settings (
  id                            TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  consultation_window_days      INTEGER NOT NULL DEFAULT 7,
  ec_review_window_days         INTEGER NOT NULL DEFAULT 7,
  on_hold_response_deadline_days INTEGER NOT NULL DEFAULT 7,
  consultation_email_recipients TEXT NOT NULL DEFAULT 'consultation@lists.pkic.org',
  ec_email_recipients           TEXT NOT NULL DEFAULT 'ec@lists.pkic.org',
  cc_applicant_emails           TEXT NOT NULL DEFAULT 'members@pkic.org',
  auto_reminder_on_holds        INTEGER NOT NULL DEFAULT 1 CHECK (auto_reminder_on_holds IN (0, 1)),
  forum_vote_min_endorsers      INTEGER NOT NULL DEFAULT 0,
  updated_at                    TEXT NOT NULL,
  updated_by_user_id            TEXT,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id)
);

INSERT INTO membership_settings (id, updated_at) VALUES ('default', datetime('now'));

-- ── Email templates ────────────────────────────────────────────────
-- 14 net-new templates wired to a trigger in this stage, plus
-- existing-member-claim (seeded for schema completeness but not wired
-- to any trigger this stage actually calls — the Interim Admin Tool
-- deliberately sends no email).

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'application-hold-authority', 1,
    'Action needed on your PKI Consortium membership application',
    'Hi {{applicantName}},

Before we can continue reviewing your application, please confirm that you are authorized to represent {{organizationName}} as a PKI Consortium member.

Reply to this email or update your application: [Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-hold-org-email', 1,
    'Please resubmit with your organization email address',
    'Hi {{applicantName}},

The email address on your application appears to be a personal address rather than an organizational one. Please resubmit your application using your organization''s email domain.

[Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-hold-pki-experience', 1,
    'Additional information needed for your PKI Consortium application',
    'Hi {{applicantName}},

As an individual (H6) applicant, please provide additional detail about your PKI background and experience within the next {{deadlineDays}} days.

Reply to this email or update your application: [Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-hold-org-application', 1,
    'Please resubmit as an organizational member',
    'Hi {{applicantName}},

Based on your application, we believe you should apply as an organizational member rather than an individual. Please resubmit your application under the appropriate organizational category.

[Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-hold-information', 1,
    'We need more information about your PKI Consortium application',
    'Hi {{applicantName}},

{{requestDetails}}

Reply to this email or update your application: [Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-in-consultation', 1,
    'Your PKI Consortium application has entered member consultation',
    'Hi {{applicantName}},

Your application has moved into our member consultation period, during which current members may raise questions or concerns. This typically takes up to {{consultationWindowDays}} days.

[Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-declined', 1,
    'Update on your PKI Consortium membership application',
    'Hi {{applicantName}},

After review, we are unable to approve your PKI Consortium membership application at this time.{{#reason}}

{{reason}}{{/reason}}

If you have questions, please reply to this email.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-closed-no-response', 1,
    'Your PKI Consortium membership application has been closed',
    'Hi {{applicantName}},

We did not receive a response to our request within the {{deadlineDays}}-day window, so your application has been closed. You are welcome to reapply at any time.

If this was a mistake, please reply to this email.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'consultation-batch', 1,
    'PKI Consortium member consultation — {{applicationCount}} application(s)',
    'The following prospective member application(s) are open for consultation:

{{#applications}}
- {{maskedEmail}} — {{organizationName}} ({{membershipCategory}})
{{/applications}}

Members with concerns may reply to this list or submit a concern via the portal.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'ec-review-batch', 1,
    'PKI Consortium EC review — {{applicationCount}} application(s)',
    'The following prospective member application(s) are ready for Executive Council review:

{{#applications}}
- {{organizationName}} ({{membershipCategory}}) — [Review]({{reviewUrl}})
{{/applications}}

If no EC member records a decision within {{ecReviewWindowDays}} days, applications are auto-approved.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-approved-welcome', 1,
    'Welcome to the PKI Consortium!',
    'Hi {{applicantName}},

Congratulations — your PKI Consortium membership application has been approved!

[Log in to the portal]({{loginUrl}})
{{#workingGroups}}
Working groups joined: {{workingGroups}}
{{/workingGroups}}

We look forward to your participation.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'org-contact-assigned', 1,
    'You have been designated an organization contact',
    'Hi {{memberName}},

You have been designated the {{contactRole}} contact for your organization''s PKI Consortium profile. You can now submit organization profile changes for staff review.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'member-account-claim', 1,
    'Set up your PKI Consortium member account',
    'Hi {{memberName}},

Your PKI Consortium member account has been created. Use the link below to sign in for the first time:

[Sign in]({{loginUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'mailing-list-enrolled', 1,
    'You have been added to PKI Consortium mailing lists',
    'Hi {{memberName}},

You have been added to the following PKI Consortium mailing lists:

{{#lists}}
- {{.}}
{{/lists}}',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'wg-calendar-invite', 1,
    'You joined the {{workingGroupName}} working group',
    'Hi {{memberName}},

You have joined the {{workingGroupName}} working group. Meeting calendar invites will be sent separately once available.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'member_magic_link', 1,
    'Your PKI Consortium member sign-in link',
    'Use the secure link below to sign in. It expires in **{{expiresInMinutes}} minutes** and can only be used once.

[Sign in]({{magicLinkUrl}})

If you did not request this link, you can safely ignore this email.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'existing-member-claim', 1,
    'Claim your PKI Consortium member account',
    'Hi {{memberName}},

As part of our transition to the new PKI Consortium member portal, an account has been created for you. Use the link below to claim it:

[Claim your account]({{loginUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  );
