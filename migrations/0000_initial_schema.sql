-- Migration 0000: Initial schema (consolidated)
--
-- This is the single authoritative migration for a fresh database.
-- It consolidates what were previously migrations 0000–0012 (events backend v2,
-- event terms, day attendance, waitlist, configurable attendance, email
-- templates + seeds, event base_path, speaker management, event permissions).
--
-- Seed data for email templates and partials is included at the end.

PRAGMA foreign_keys = OFF;

-- ── Core domain tables ────────────────────────────────────────────────────────

CREATE TABLE events (
  id                      TEXT    NOT NULL PRIMARY KEY,
  slug                    TEXT    NOT NULL UNIQUE,
  name                    TEXT    NOT NULL,
  timezone                TEXT    NOT NULL,
  starts_at               TEXT,
  ends_at                 TEXT,
  source_path             TEXT,
  base_path               TEXT,
  capacity_in_person      INTEGER,
  registration_mode       TEXT    NOT NULL DEFAULT 'invite_or_open',
  invite_limit_attendee   INTEGER NOT NULL DEFAULT 5,
  settings_json           TEXT    NOT NULL DEFAULT '{}',
  created_at              TEXT    NOT NULL,
  updated_at              TEXT    NOT NULL
);

CREATE TABLE event_terms (
  id            TEXT    NOT NULL PRIMARY KEY,
  event_id      TEXT    NOT NULL,
  audience_type TEXT    NOT NULL,
  term_key      TEXT    NOT NULL,
  version       TEXT    NOT NULL,
  required      INTEGER NOT NULL DEFAULT 1,
  content_ref   TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  display_text  TEXT,
  help_text     TEXT,
  created_at    TEXT    NOT NULL,
  UNIQUE(event_id, audience_type, term_key, version),
  FOREIGN KEY(event_id) REFERENCES events(id)
);

CREATE TABLE organizations (
  id              TEXT NOT NULL PRIMARY KEY,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  data_json       TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE users (
  id                TEXT    NOT NULL PRIMARY KEY,
  email             TEXT    NOT NULL UNIQUE,
  normalized_email  TEXT    NOT NULL UNIQUE,
  first_name        TEXT,
  last_name         TEXT,
  preferred_name    TEXT,
  organization_name TEXT,
  job_title         TEXT,
  biography         TEXT,
  links_json        TEXT,
  data_json         TEXT,
  role              TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'guest')),
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  headshot_r2_key   TEXT,
  headshot_updated_at TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  pii_redacted_at   TEXT
);

CREATE TABLE auth_magic_links (
  id              TEXT NOT NULL PRIMARY KEY,
  user_id         TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TEXT NOT NULL,
  used_at         TEXT,
  request_ip_hash TEXT,
  user_agent_hash TEXT,
  created_at      TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE sessions (
  id           TEXT NOT NULL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'auth' CHECK (session_type IN ('auth', 'api', 'service')),
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE members (
  id              TEXT NOT NULL PRIMARY KEY,
  member_type     TEXT NOT NULL CHECK (member_type IN ('individual', 'organization')),
  user_id         TEXT,
  organization_id TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending', 'lapsed')),
  tier            TEXT,
  data_json       TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(user_id),
  UNIQUE(organization_id),
  CHECK (
    (member_type = 'individual' AND user_id IS NOT NULL AND organization_id IS NULL) OR
    (member_type = 'organization' AND user_id IS NULL AND organization_id IS NOT NULL)
  ),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id)
);

-- ── Forms ─────────────────────────────────────────────────────────────────────

CREATE TABLE forms (
  id          TEXT NOT NULL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('event', 'community', 'organization', 'global')),
  scope_ref   TEXT,
  purpose     TEXT NOT NULL CHECK (purpose IN ('event_registration', 'proposal_submission', 'survey', 'feedback', 'application')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  title       TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE form_fields (
  id              TEXT    NOT NULL PRIMARY KEY,
  form_id         TEXT    NOT NULL,
  key             TEXT    NOT NULL,
  label           TEXT    NOT NULL,
  field_type      TEXT    NOT NULL CHECK (field_type IN ('text', 'textarea', 'select', 'multi_select', 'boolean', 'number', 'date', 'email', 'url')),
  required        INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  options_json    TEXT,
  validation_json TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL,
  UNIQUE(form_id, key),
  FOREIGN KEY(form_id) REFERENCES forms(id)
);

CREATE TABLE form_submissions (
  id                   TEXT NOT NULL PRIMARY KEY,
  form_id              TEXT NOT NULL,
  submitted_by_user_id TEXT,
  context_type         TEXT CHECK (context_type IN ('registration', 'proposal', 'membership', 'survey', 'feedback')),
  context_ref          TEXT,
  status               TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'draft', 'withdrawn')),
  submitted_at         TEXT NOT NULL,
  FOREIGN KEY(form_id) REFERENCES forms(id),
  FOREIGN KEY(submitted_by_user_id) REFERENCES users(id)
);

CREATE TABLE form_submission_answers (
  id            TEXT NOT NULL PRIMARY KEY,
  submission_id TEXT NOT NULL,
  field_key     TEXT NOT NULL,
  data_json     TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE(submission_id, field_key),
  FOREIGN KEY(submission_id) REFERENCES form_submissions(id)
);

-- ── Event days & attendance ───────────────────────────────────────────────────

CREATE TABLE event_days (
  id                      TEXT    NOT NULL PRIMARY KEY,
  event_id                TEXT    NOT NULL,
  day_date                TEXT    NOT NULL,
  label                   TEXT,
  in_person_capacity      INTEGER,
  attendance_options_json TEXT,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT    NOT NULL,
  updated_at              TEXT    NOT NULL,
  UNIQUE(event_id, day_date),
  FOREIGN KEY(event_id) REFERENCES events(id)
);

-- ── Invites & unsubscribes ────────────────────────────────────────────────────

CREATE TABLE invites (
  id                    TEXT    NOT NULL PRIMARY KEY,
  event_id              TEXT    NOT NULL,
  inviter_user_id       TEXT,
  inviter_registration_id TEXT,
  invitee_email         TEXT    NOT NULL,
  invitee_first_name    TEXT,
  invitee_last_name     TEXT,
  invite_type           TEXT    NOT NULL CHECK (invite_type IN ('attendee', 'speaker')),
  token_hash            TEXT    NOT NULL UNIQUE,
  status                TEXT    NOT NULL CHECK (status IN ('sent', 'accepted', 'declined', 'expired', 'revoked')),
  decline_reason_code   TEXT,
  decline_reason_note   TEXT,
  unsubscribe_future    INTEGER NOT NULL DEFAULT 0 CHECK (unsubscribe_future IN (0, 1)),
  nps_score             INTEGER CHECK (nps_score IS NULL OR (nps_score >= 1 AND nps_score <= 10)),
  reminder_count        INTEGER NOT NULL DEFAULT 0 CHECK (reminder_count >= 0 AND reminder_count <= 3),
  max_uses              INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1 AND max_uses <= 20),
  used_count            INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  source_type           TEXT    NOT NULL DEFAULT 'direct' CHECK (length(source_type) >= 2 AND length(source_type) <= 64),
  expires_at            TEXT,
  accepted_at           TEXT,
  declined_at           TEXT,
  created_at            TEXT    NOT NULL,
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(inviter_user_id) REFERENCES users(id)
);

CREATE TABLE unsubscribes (
  id         TEXT NOT NULL PRIMARY KEY,
  email      TEXT NOT NULL,
  channel    TEXT NOT NULL CHECK (length(channel) >= 2 AND length(channel) <= 64),
  scope_type TEXT NOT NULL DEFAULT 'global',
  scope_ref  TEXT,
  reason     TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(email, channel, scope_type, scope_ref)
);

-- ── Registrations ─────────────────────────────────────────────────────────────

CREATE TABLE registrations (
  id                              TEXT    NOT NULL PRIMARY KEY,
  event_id                        TEXT    NOT NULL,
  user_id                         TEXT    NOT NULL,
  invite_id                       TEXT,
  status                          TEXT    NOT NULL CHECK (status IN ('pending_email_confirmation', 'registered', 'waitlisted', 'cancelled')),
  attendance_type                 TEXT    NOT NULL CHECK (attendance_type IN ('in_person', 'virtual', 'on_demand')),
  source_type                     TEXT    NOT NULL CHECK (length(source_type) >= 2 AND length(source_type) <= 64),
  source_ref                      TEXT,
  custom_answers_json             TEXT,
  referred_by_code                TEXT,
  confirmation_token_hash         TEXT    UNIQUE,
  confirmation_token_expires_at   TEXT,
  manage_token_hash               TEXT    NOT NULL UNIQUE,
  capacity_exempt_in_person       INTEGER NOT NULL DEFAULT 0 CHECK (capacity_exempt_in_person IN (0, 1)),
  capacity_exempt_reason          TEXT,
  confirmed_at                    TEXT,
  cancelled_at                    TEXT,
  created_at                      TEXT    NOT NULL,
  updated_at                      TEXT    NOT NULL,
  UNIQUE(event_id, user_id),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(invite_id) REFERENCES invites(id)
);

CREATE TABLE registration_attendance_history (
  id              TEXT NOT NULL PRIMARY KEY,
  registration_id TEXT NOT NULL,
  from_type       TEXT,
  to_type         TEXT NOT NULL,
  changed_by      TEXT NOT NULL,
  changed_at      TEXT NOT NULL,
  FOREIGN KEY(registration_id) REFERENCES registrations(id)
);

-- attendance_type is intentionally unconstrained — valid values are driven by
-- event_days.attendance_options_json and validated at the application layer.
CREATE TABLE registration_day_attendance (
  id              TEXT NOT NULL PRIMARY KEY,
  registration_id TEXT NOT NULL,
  event_day_id    TEXT NOT NULL,
  attendance_type TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(registration_id, event_day_id),
  FOREIGN KEY(registration_id) REFERENCES registrations(id),
  FOREIGN KEY(event_day_id) REFERENCES event_days(id)
);

CREATE TABLE event_day_waitlist_entries (
  id              TEXT NOT NULL PRIMARY KEY,
  event_id        TEXT NOT NULL,
  event_day_id    TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  priority_lane   TEXT NOT NULL CHECK (priority_lane IN ('continuity', 'general')),
  status          TEXT NOT NULL CHECK (status IN ('waiting', 'offered', 'accepted', 'expired', 'removed')),
  position        INTEGER NOT NULL,
  offer_expires_at TEXT,
  reason_code     TEXT,
  reason_note     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(event_day_id, registration_id),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(event_day_id) REFERENCES event_days(id),
  FOREIGN KEY(registration_id) REFERENCES registrations(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- ── Event participants & waitlist ─────────────────────────────────────────────

CREATE TABLE event_participants (
  id          TEXT    NOT NULL PRIMARY KEY,
  event_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('attendee', 'speaker', 'moderator', 'panelist', 'organizer', 'staff')),
  subrole     TEXT,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'invited', 'waitlisted')),
  source_type TEXT,
  source_ref  TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  UNIQUE(event_id, user_id, role, subrole),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE waitlist_entries (
  id              TEXT    NOT NULL PRIMARY KEY,
  event_id        TEXT    NOT NULL,
  registration_id TEXT    NOT NULL,
  status          TEXT    NOT NULL CHECK (status IN ('waiting', 'offered', 'claimed', 'expired', 'removed')),
  position        INTEGER NOT NULL,
  offer_expires_at TEXT,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  UNIQUE(event_id, registration_id),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(registration_id) REFERENCES registrations(id)
);

-- ── Consent ───────────────────────────────────────────────────────────────────

CREATE TABLE consent_acceptances (
  id              TEXT NOT NULL PRIMARY KEY,
  registration_id TEXT,
  proposal_id     TEXT,
  event_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  audience_type   TEXT NOT NULL,
  term_key        TEXT NOT NULL,
  term_version    TEXT NOT NULL,
  accepted_at     TEXT NOT NULL,
  ip_hash         TEXT,
  user_agent_hash TEXT,
  UNIQUE(event_id, user_id, audience_type, term_key, term_version),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- ── Session proposals & speakers ──────────────────────────────────────────────

CREATE TABLE session_proposals (
  id                        TEXT NOT NULL PRIMARY KEY,
  event_id                  TEXT NOT NULL,
  proposer_user_id          TEXT NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN ('submitted', 'under_review', 'accepted', 'rejected', 'needs_work', 'withdrawn')),
  proposal_type             TEXT NOT NULL CHECK (length(proposal_type) >= 2 AND length(proposal_type) <= 64),
  title                     TEXT NOT NULL,
  abstract                  TEXT NOT NULL,
  details_json              TEXT,
  referral_code             TEXT,
  manage_token_hash         TEXT NOT NULL UNIQUE,
  presentation_r2_key       TEXT,
  presentation_deadline     TEXT,
  presentation_uploaded_at  TEXT,
  submitted_at              TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  withdrawn_at              TEXT,
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(proposer_user_id) REFERENCES users(id)
);

CREATE TABLE proposal_speakers (
  id                TEXT NOT NULL PRIMARY KEY,
  proposal_id       TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('proposer', 'speaker', 'co_speaker', 'moderator', 'panelist')),
  status            TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'invited', 'confirmed', 'declined')),
  manage_token_hash TEXT,
  terms_accepted_at TEXT,
  confirmed_at      TEXT,
  declined_at       TEXT,
  decline_reason    TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE(proposal_id, user_id),
  FOREIGN KEY(proposal_id) REFERENCES session_proposals(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE proposal_reviews (
  id                 TEXT NOT NULL PRIMARY KEY,
  proposal_id        TEXT NOT NULL,
  reviewer_user_id   TEXT NOT NULL,
  recommendation     TEXT NOT NULL CHECK (recommendation IN ('accept', 'reject', 'needs-work')),
  score              INTEGER,
  reviewer_comment   TEXT,
  applicant_note     TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE(proposal_id, reviewer_user_id),
  FOREIGN KEY(proposal_id) REFERENCES session_proposals(id),
  FOREIGN KEY(reviewer_user_id) REFERENCES users(id)
);

CREATE TABLE proposal_decisions (
  id                  TEXT    NOT NULL PRIMARY KEY,
  proposal_id         TEXT    NOT NULL UNIQUE,
  decided_by_user_id  TEXT    NOT NULL,
  final_status        TEXT    NOT NULL CHECK (final_status IN ('accepted', 'rejected', 'needs_work')),
  decision_note       TEXT,
  min_reviews_required INTEGER NOT NULL,
  review_count        INTEGER NOT NULL,
  decided_at          TEXT    NOT NULL,
  FOREIGN KEY(proposal_id) REFERENCES session_proposals(id),
  FOREIGN KEY(decided_by_user_id) REFERENCES users(id)
);

CREATE TABLE proposal_feedback_external (
  id                   TEXT NOT NULL PRIMARY KEY,
  proposal_id          TEXT NOT NULL,
  source_type          TEXT NOT NULL,
  identity_hash        TEXT NOT NULL,
  identity_hash_version TEXT NOT NULL,
  feedback_json        TEXT,
  created_at           TEXT NOT NULL,
  UNIQUE(proposal_id, source_type, identity_hash),
  FOREIGN KEY(proposal_id) REFERENCES session_proposals(id)
);

-- ── Referrals ─────────────────────────────────────────────────────────────────

CREATE TABLE referral_codes (
  code              TEXT    NOT NULL PRIMARY KEY CHECK (length(code) BETWEEN 6 AND 12),
  event_id          TEXT    NOT NULL,
  owner_type        TEXT    NOT NULL,
  owner_id          TEXT    NOT NULL,
  created_by_user_id TEXT,
  channel_hint      TEXT,
  clicks            INTEGER NOT NULL DEFAULT 0,
  conversions       INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL,
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id)
);

CREATE TABLE referral_clicks (
  id              TEXT NOT NULL PRIMARY KEY,
  code            TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  ip_hash         TEXT,
  user_agent_hash TEXT,
  created_at      TEXT NOT NULL,
  FOREIGN KEY(code) REFERENCES referral_codes(code),
  FOREIGN KEY(event_id) REFERENCES events(id)
);

-- ── Email ─────────────────────────────────────────────────────────────────────

CREATE TABLE email_template_versions (
  id                  TEXT    NOT NULL PRIMARY KEY,
  template_key        TEXT    NOT NULL,
  version             INTEGER NOT NULL,
  subject_template    TEXT,
  body                TEXT,
  content_type        TEXT    NOT NULL DEFAULT 'markdown'
                              CHECK (content_type IN ('markdown', 'html', 'text')),
  r2_object_key       TEXT,
  checksum_sha256     TEXT    NOT NULL DEFAULT '',
  status              TEXT    NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'active', 'archived')),
  created_by_user_id  TEXT,
  created_at          TEXT    NOT NULL,
  UNIQUE(template_key, version)
);

CREATE TABLE email_outbox (
  id                  TEXT    NOT NULL PRIMARY KEY,
  event_id            TEXT,
  template_key        TEXT    NOT NULL,
  template_version    INTEGER,
  recipient_user_id   TEXT,
  recipient_email     TEXT    NOT NULL,
  subject             TEXT,
  payload_json        TEXT    NOT NULL,
  message_type        TEXT    NOT NULL,
  provider            TEXT    NOT NULL,
  provider_message_id TEXT,
  status              TEXT    NOT NULL,
  attempts            INTEGER NOT NULL DEFAULT 0,
  send_after          TEXT    NOT NULL,
  last_error          TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  sent_at             TEXT,
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(recipient_user_id) REFERENCES users(id)
);

-- ── Retention ─────────────────────────────────────────────────────────────────

CREATE TABLE retention_policies (
  event_id             TEXT    NOT NULL PRIMARY KEY,
  user_retention_days  INTEGER NOT NULL,
  updated_at           TEXT    NOT NULL,
  FOREIGN KEY(event_id) REFERENCES events(id)
);

-- ── Sponsors ──────────────────────────────────────────────────────────────────

CREATE TABLE sponsors (
  id                TEXT NOT NULL PRIMARY KEY,
  organization_id   TEXT NOT NULL UNIQUE,
  sponsorship_level TEXT NOT NULL DEFAULT 'supporter',
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  data_json         TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES organizations(id)
);

CREATE TABLE sponsor_events (
  id                  TEXT NOT NULL PRIMARY KEY,
  sponsor_id          TEXT NOT NULL,
  event_id            TEXT NOT NULL,
  sponsorship_level   TEXT NOT NULL,
  sponsorship_subject TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  data_json           TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE(event_id, sponsor_id, sponsorship_level),
  FOREIGN KEY(sponsor_id) REFERENCES sponsors(id),
  FOREIGN KEY(event_id) REFERENCES events(id)
);

-- ── Engagement & audit ────────────────────────────────────────────────────────

CREATE TABLE engagement_events (
  id           TEXT    NOT NULL PRIMARY KEY,
  user_id      TEXT    NOT NULL,
  event_id     TEXT,
  subject_type TEXT    NOT NULL DEFAULT 'community'
                       CHECK (subject_type IN ('community', 'event', 'organization', 'member', 'registration', 'proposal', 'invite', 'referral', 'sponsorship', 'system')),
  subject_ref  TEXT,
  action_type  TEXT    NOT NULL,
  points       INTEGER NOT NULL DEFAULT 0,
  source_type  TEXT,
  source_ref   TEXT,
  data_json    TEXT,
  created_at   TEXT    NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(event_id) REFERENCES events(id)
);

CREATE TABLE audit_log (
  id          TEXT NOT NULL PRIMARY KEY,
  actor_type  TEXT NOT NULL,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  details_json TEXT,
  created_at  TEXT NOT NULL
);

-- ── Event permissions ─────────────────────────────────────────────────────────

CREATE TABLE event_permissions (
  id            TEXT NOT NULL PRIMARY KEY,
  event_id      TEXT NOT NULL,
  user_email    TEXT NOT NULL,
  user_id       TEXT,
  permission    TEXT NOT NULL CHECK (permission IN ('organizer', 'program_committee', 'moderator', 'volunteer')),
  granted_by_id TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE(event_id, user_email, permission),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

PRAGMA foreign_keys = ON;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_event_terms_event                ON event_terms(event_id, audience_type, active);
CREATE INDEX idx_invites_event_status             ON invites(event_id, status, invite_type);
CREATE INDEX idx_registrations_event_status       ON registrations(event_id, status, attendance_type);
CREATE INDEX idx_event_participants_event_role    ON event_participants(event_id, role, status);
CREATE INDEX idx_waitlist_event_status            ON waitlist_entries(event_id, status, position);
CREATE INDEX idx_proposals_event_status           ON session_proposals(event_id, status);
CREATE INDEX idx_proposal_reviews_proposal        ON proposal_reviews(proposal_id);
CREATE INDEX idx_forms_scope                      ON forms(scope_type, scope_ref, purpose, status);
CREATE INDEX idx_form_fields_form                 ON form_fields(form_id, sort_order);
CREATE INDEX idx_form_submissions_form            ON form_submissions(form_id, submitted_at);
CREATE INDEX idx_members_type_status              ON members(member_type, status);
CREATE INDEX idx_email_outbox_status_send_after   ON email_outbox(status, send_after);
CREATE INDEX idx_referral_codes_event             ON referral_codes(event_id);
CREATE INDEX idx_sponsors_org                     ON sponsors(organization_id, status);
CREATE INDEX idx_sponsor_events_event             ON sponsor_events(event_id, status);
CREATE INDEX idx_engagement_events_user           ON engagement_events(user_id, created_at);
CREATE INDEX idx_engagement_events_subject        ON engagement_events(subject_type, subject_ref, created_at);
CREATE INDEX idx_event_days_event_sort            ON event_days(event_id, sort_order, day_date);
CREATE INDEX idx_registration_day_attendance_day  ON registration_day_attendance(event_day_id, attendance_type);
CREATE INDEX idx_day_waitlist_day_status_pos      ON event_day_waitlist_entries(event_day_id, status, priority_lane, position);
CREATE INDEX idx_day_waitlist_user_status         ON event_day_waitlist_entries(event_id, user_id, status, offer_expires_at);
CREATE INDEX idx_email_template_versions_key_status ON email_template_versions(template_key, status);
CREATE UNIQUE INDEX idx_proposal_speakers_manage_token
  ON proposal_speakers(manage_token_hash)
  WHERE manage_token_hash IS NOT NULL;
CREATE INDEX idx_event_permissions_event          ON event_permissions(event_id);
CREATE INDEX idx_event_permissions_email          ON event_permissions(user_email);

-- ── Seed: email templates ─────────────────────────────────────────────────────

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type,
   r2_object_key, checksum_sha256, status, created_by_user_id, created_at)
VALUES
  -- ── registration_confirm_email ──────────────────────────────────────────
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'registration_confirm_email', 1,
    'Confirm your registration for {{eventName}}',
    'Hi {{attendeeName}},

Please confirm your registration for **{{eventName}}** by clicking the link below:

[Confirm my registration]({{confirmationUrl}})

Once confirmed you will receive a calendar invite and a personal link to manage your registration.

If you did not request this, you can safely ignore this email.

[Manage registration]({{manageUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now')
  ),
  -- ── registration_confirmed ──────────────────────────────────────────────
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'registration_confirmed', 1,
    'Registration confirmed for {{eventName}}',
    'Hi {{attendeeName}},

Great news — your registration for **{{eventName}}** is confirmed! We have attached a calendar invite for your convenience.

**Event details**
- Date: {{eventStartDate}}
- Location: {{eventLocation}}

You can update your registration or invite colleagues at any time:
[Manage registration]({{manageUrl}})

Share your attendance:
[{{shareUrl}}]({{shareUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now')
  ),
  -- ── registration_updated ────────────────────────────────────────────────
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'registration_updated', 1,
    'Registration updated for {{eventName}}',
    'Hi {{attendeeName}},

Your registration for **{{eventName}}** has been updated.

Status: **{{status}}**

[Manage registration]({{manageUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now')
  ),
  -- ── attendee_invite ─────────────────────────────────────────────────────
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'attendee_invite', 1,
    'You''re invited to {{eventName}}',
    'Hi,

You have been invited to attend **{{eventName}}**.

[Register now]({{registrationUrl}})

{{#if declineUrl}}[No thanks, decline this invitation]({{declineUrl}}){{/if}}

We hope to see you there!',
    'markdown', NULL, '', 'active', NULL, datetime('now')
  ),
  -- ── speaker_invite ──────────────────────────────────────────────────────
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'speaker_invite', 1,
    'Speaker invitation for {{eventName}}',
    'Hi {{attendeeName}},

We would love to have you speak at **{{eventName}}**.

Please submit your proposal at the link below:
[Submit proposal]({{proposalUrl}})

{{#if declineUrl}}[No thanks, decline this invitation]({{declineUrl}}){{/if}}

Thank you for considering this opportunity.',
    'markdown', NULL, '', 'active', NULL, datetime('now')
  ),
  -- ── proposal_submitted ──────────────────────────────────────────────────
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'proposal_submitted', 1,
    'Proposal submitted: {{proposalTitle}}',
    'Hi {{attendeeName}},

Your proposal **{{proposalTitle}}** has been received. We will review it and get back to you as soon as possible.

[Manage submission]({{manageUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now')
  ),
  -- ── proposal_decision ───────────────────────────────────────────────────
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'proposal_decision', 1,
    'Proposal decision: {{proposalTitle}}',
    'Hi {{attendeeName}},

We have reached a decision regarding your proposal **{{proposalTitle}}**.

Outcome: **{{finalStatus}}**

{{decisionNote}}

Thank you for your submission.',
    'markdown', NULL, '', 'active', NULL, datetime('now')
  ),
  -- ── admin_magic_link ────────────────────────────────────────────────────
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'admin_magic_link', 1,
    'Your admin sign-in link',
    'Use the secure link below to sign in. It expires in **{{expiresInMinutes}} minutes** and can only be used once.

[Sign in]({{magicLinkUrl}})

If you did not request this link, you can safely ignore this email.',
    'markdown', NULL, '', 'active', NULL, datetime('now')
  );

-- ── Seed: email partials ──────────────────────────────────────────────────────

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type,
   r2_object_key, checksum_sha256, status, created_by_user_id, created_at)
VALUES
  -- ── partial_sponsors_block ───────────────────────────────────────────────
  -- Conditional sponsors image block. Reference with {{> sponsors_block}}.
  -- Renders only when sponsorsImageUrl is provided in the email data.
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'partial_sponsors_block', 1,
    NULL,
    '{{#if sponsorsImageUrl}}

<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #e5e9ef;margin:28px 0 0;">
  <tr>
    <td align="center" style="padding:24px 0 8px;">
      <p style="margin:0 0 16px;font-family:''Segoe UI'',''Helvetica Neue'',Helvetica,Arial,sans-serif;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Event sponsors</p>
      <a href="{{baseUrl}}/sponsors/" target="_blank" style="display:block;text-decoration:none;">
        <img src="{{sponsorsImageUrl}}" alt="Event sponsors" width="504" style="display:block;max-width:100%;height:auto;border:0;">
      </a>
    </td>
  </tr>
</table>

{{/if}}',
    'html', NULL, '', 'active', NULL, datetime('now')
  ),
  -- ── partial_about_pkic ───────────────────────────────────────────────────
  -- Standard "About the PKI Consortium" blurb. Reference with {{> about_pkic}}.
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'partial_about_pkic', 1,
    NULL,
    '**About the PKI Consortium**

The PKI Consortium is a vendor-neutral community of PKI practitioners dedicated to advancing trust, security, and interoperability in digital infrastructure. [Learn more &rarr;]({{baseUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now')
  ),
  -- ── partial_reg_details ──────────────────────────────────────────────────
  -- Blockquote summary of a registrant''s details. Reference with {{> reg_details}}.
  -- Renders only the fields that are present in the email data payload.
  (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    'partial_reg_details', 1,
    NULL,
    '## Your registration details

> {{#if firstName}}**Name:** {{firstName}} {{lastName}}  
> {{/if}}{{#if email}}**Email:** {{email}}  
> {{/if}}{{#if organizationName}}**Organization:** {{organizationName}}  
> {{/if}}{{#if jobTitle}}**Title / Role:** {{jobTitle}}  
> {{/if}}{{#each dayAttendance}}**{{dayLabel}}:** {{attendanceLabel}}  
> {{/each}}{{#if attendanceLabel}}**Attendance:** {{attendanceLabel}}  
> {{/if}}{{#each customAnswerRows}}**{{label}}:** {{displayValue}}  
> {{/each}}{{#if acceptedTermsText}}**Terms agreed:**  
> - {{acceptedTermsText}}{{/if}}',
    'markdown', NULL, '', 'active', NULL, datetime('now')
  );
