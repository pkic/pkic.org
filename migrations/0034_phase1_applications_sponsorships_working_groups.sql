-- Migration 0034: Phase 1 — RESTful API & Portal-Managed Forms
--
-- PRD §1.2 (Membership Application Endpoint), §1.3 (Sponsor Interest
-- Endpoint), and §1.5 (public members / working-groups endpoints) all need
-- tables that don't exist yet. Per this document's no-CHECK-constraint
-- convention (§2.3), status/stage/type columns below carry `-- allowed:`
-- comments only; validation lives in the application layer (Zod).
--
-- Three groups of tables, each pulled forward from a later-numbered PRD
-- section because a Phase 1 endpoint needs them now:
--
-- 1. member_applications / member_application_events / application_documents
--    — defined in §2.3 (Phase 2 text) and §2.3's application_documents, but
--    required immediately by §1.2's POST /api/v1/members/applications.
--
-- 2. sponsorships / sponsorship_events — defined in §4.13 (Phase 4E), but
--    required immediately by §1.3's POST /api/v1/sponsorship/inquiries and
--    /checkout. Only the columns needed to record an inquiry/checkout are
--    exercised in Phase 1; the full sales-pipeline admin UI is Phase 4E.
--    Two columns beyond the §4.13 schema are added here because Phase 1
--    inquiries commonly come from people with no existing member/org
--    record: `contact_name` / `contact_email` (submitter identity — §4.13's
--    schema had no way to reach the submitter at all, a gap in the same
--    spirit as the Phase 0 findings in §9) and `checkout_session_id`
--    (idempotency key for the Stripe webhook, mirroring `donations.
--    checkout_session_id`).
--
-- 3. working_groups / working_group_members — defined in §2.3 (Phase 2
--    text), but required immediately by §1.5's GET /api/v1/working-groups
--    (list) and GET /api/v1/working-groups/:id (detail + member list).
--    Seeded here with the six working groups already published under
--    content/wg/ so the public endpoints return real data before Phase 2
--    or Phase 4A touch this table again (e.g. adding chair assignment UI).

-- ── Membership applications (§1.2, §2.3, §4.2) ──────────────────────────────

CREATE TABLE member_applications (
  id                   TEXT NOT NULL PRIMARY KEY,
  applicant_email      TEXT NOT NULL,
  applicant_name       TEXT NOT NULL,
  organization_name    TEXT,
  organization_domain  TEXT,
  membership_category  TEXT NOT NULL,
  -- allowed: A | B | C | D | E | F | G | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8
  form_submission_id   TEXT,
  -- reserved for a future form_submissions-backed write path; unused for now
  -- (see functions/_lib/services/member-applications.ts) — answers are
  -- stored directly on this row in answers_json, the same pattern already
  -- used by registrations.custom_answers_json.
  answers_json         TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  -- allowed: pending | in_review | on_hold | in_consultation | ec_review | approved | declined | withdrawn
  stage                TEXT NOT NULL DEFAULT 'pending',
  stage_entered_at     TEXT NOT NULL,
  review_notes         TEXT,
  assigned_to_user_id  TEXT,
  manage_token_hash    TEXT NOT NULL UNIQUE,
  -- sha256 of the applicant's status/document-upload token; plaintext is
  -- returned once at submission time and emailed, never stored.
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  FOREIGN KEY(form_submission_id) REFERENCES form_submissions(id),
  FOREIGN KEY(assigned_to_user_id) REFERENCES users(id)
);

CREATE INDEX idx_member_applications_email ON member_applications(applicant_email);
CREATE INDEX idx_member_applications_domain_status ON member_applications(organization_domain, status);
CREATE INDEX idx_member_applications_stage ON member_applications(stage);

CREATE TABLE member_application_events (
  id             TEXT NOT NULL PRIMARY KEY,
  application_id TEXT NOT NULL,
  from_stage     TEXT,
  to_stage       TEXT NOT NULL,
  actor_user_id  TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES member_applications(id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);

CREATE INDEX idx_member_application_events_app ON member_application_events(application_id, created_at);

CREATE TABLE application_documents (
  id                TEXT NOT NULL PRIMARY KEY,
  application_id    TEXT NOT NULL,
  uploaded_by_email TEXT NOT NULL,
  r2_key            TEXT NOT NULL,
  -- convention: application-docs/{application_id}/{uuid}-{filename}
  filename          TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  file_size_bytes   INTEGER NOT NULL,
  uploaded_at       TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES member_applications(id)
);

CREATE INDEX idx_application_documents_app ON application_documents(application_id);

-- ── Sponsorships (§1.3, §4.13) ──────────────────────────────────────────────

CREATE TABLE sponsorships (
  id                     TEXT NOT NULL PRIMARY KEY,
  sponsor_type           TEXT NOT NULL,
  -- allowed: consortium | event
  organization_id        TEXT,
  -- FK to organizations, for consortium sponsors and member event sponsors
  non_member_name        TEXT,
  non_member_website     TEXT,
  non_member_logo_r2_key TEXT,
  contact_name           TEXT,
  contact_email          TEXT,
  -- submitter identity — see migration header note
  event_id               TEXT,
  -- FK to events, for event sponsors only
  tier                   TEXT,
  -- allowed: Titanium | Diamond | Platinum | Gold | Silver (consortium)
  --        | Leader | Inspirator | Innovator | Ambassador (event)
  pipeline_stage         TEXT NOT NULL DEFAULT 'new_inquiry',
  -- allowed: new_inquiry | contacted | proposal_sent | negotiating | payment_pending | active | lapsed
  checkout_session_id    TEXT UNIQUE,
  -- Stripe Checkout session id, for Path B self-service; idempotency key
  -- for the webhook that creates/updates this row (see migration header).
  start_date             TEXT,
  renewal_date           TEXT,
  assigned_to_user_id    TEXT,
  notes                  TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES organizations(id),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(assigned_to_user_id) REFERENCES users(id)
);

CREATE INDEX idx_sponsorships_stage ON sponsorships(pipeline_stage);
CREATE INDEX idx_sponsorships_event ON sponsorships(event_id);
CREATE INDEX idx_sponsorships_org ON sponsorships(organization_id);

CREATE TABLE sponsorship_events (
  id             TEXT NOT NULL PRIMARY KEY,
  sponsorship_id TEXT NOT NULL,
  from_stage     TEXT,
  to_stage       TEXT NOT NULL,
  actor_user_id  TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY(sponsorship_id) REFERENCES sponsorships(id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);

CREATE INDEX idx_sponsorship_events_sponsorship ON sponsorship_events(sponsorship_id, created_at);

-- ── Working groups (§1.5, §2.3) ─────────────────────────────────────────────

CREATE TABLE working_groups (
  id                       TEXT NOT NULL PRIMARY KEY,
  name                     TEXT NOT NULL,
  slug                     TEXT NOT NULL UNIQUE,
  description              TEXT,
  mailing_list_email       TEXT,
  chair_user_id            TEXT,
  min_endorsers_for_ballot INTEGER NOT NULL DEFAULT 0,
  active                   INTEGER NOT NULL DEFAULT 1,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  FOREIGN KEY(chair_user_id) REFERENCES users(id)
);

CREATE TABLE working_group_members (
  id               TEXT NOT NULL PRIMARY KEY,
  working_group_id TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  joined_at        TEXT NOT NULL,
  left_at          TEXT,
  FOREIGN KEY(working_group_id) REFERENCES working_groups(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX idx_wg_members_wg ON working_group_members(working_group_id, left_at);
CREATE INDEX idx_wg_members_user ON working_group_members(user_id);

INSERT OR IGNORE INTO working_groups
  (id, name, slug, description, mailing_list_email, chair_user_id, min_endorsers_for_ballot, active, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'Post-Quantum Cryptography Working Group', 'pqc',
   'Preparing the PKI ecosystem for the quantum computing era through collaborative research, education, standards alignment, and practical tooling.',
   NULL, NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'Cryptographic Module Working Group', 'cm',
   'A central forum for addressing cryptographic module (CM) and hardware security module (HSM) related topics within the PKI ecosystem.',
   NULL, NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'PKI Maturity Model Working Group', 'pkimm',
   'Building a globally recognized PKI maturity model for evaluating, planning, and comparing PKI implementations.',
   NULL, NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'Training and Certification Working Group', 'tcwg',
   'Advancing PKI knowledge and skills through structured training paths, certification programs, and accessible educational resources.',
   NULL, NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'CA Working Group', 'ca',
   'A working group for discussions and information sharing among publicly trusted Certificate Authorities.',
   NULL, NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'CBOM Profiles Working Group', 'cbom',
   'Developing a neutral, open methodology for defining Cryptographic Bill of Materials (CBOM) profiles that map onto industry BOM standards such as SPDX and CycloneDX.',
   NULL, NULL, 0, 1, datetime('now'), datetime('now'));

-- ── Portal-managed membership application form (§1.4) ───────────────────────
-- forms.purpose already allows 'application' (migration 0000) — no rebuild
-- needed per §0.5. This seeds the default field set mirroring the existing
-- layouts/shortcodes/joinform.html so GET /api/v1/members/applications/form
-- returns a real, staff-editable form from day one.

INSERT OR IGNORE INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
VALUES (
  lower(hex(randomblob(16))), 'membership-application', 'global', NULL, 'application', 'active',
  'PKI Consortium Membership Application',
  'Application form for prospective PKI Consortium members.',
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO form_fields (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
VALUES
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'job_title', 'Role / Job Title', 'text', 0, NULL, NULL, 10, datetime('now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'linkedin', 'LinkedIn Profile', 'url', 0, NULL, NULL, 20, datetime('now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'organization_website', 'Organization Website', 'url', 0, NULL, NULL, 30, datetime('now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'about_yourself', 'About Yourself', 'textarea', 0, NULL, NULL, 40, datetime('now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'about_organization', 'About Your Organization', 'textarea', 0, NULL, NULL, 50, datetime('now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'reason', 'Why do you want to join PKI Consortium?', 'textarea', 1, NULL, NULL, 60, datetime('now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'working_groups', 'Working Groups of Interest', 'multi_select', 0, '["pqc","cm","pkimm","tcwg","ca","cbom"]', NULL, 70, datetime('now'));

-- ── Email templates (§1.2, §1.3, §4.4) ──────────────────────────────────────

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'application-received', 1,
    'We received your PKI Consortium membership application',
    'Hi {{applicantName}},

Thank you for applying for PKI Consortium membership. We have received your application and a member of our team will review it shortly.

You can check the status of your application at any time:
[Check application status]({{statusUrl}})

If you have any questions, just reply to this email.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-brochure', 1,
    'PKI Consortium sponsorship information',
    'Hi {{contactName}},

Thank you for your interest in sponsoring the PKI Consortium{{#eventName}} — {{eventName}}{{/eventName}}. Attached is our sponsorship brochure with tier details and benefits.

Brochure: [{{brochureUrl}}]({{brochureUrl}})

A member of our team will follow up with you shortly to discuss next steps.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-new-inquiry', 1,
    'New sponsorship inquiry: {{contactName}} ({{organizationName}})',
    'A new sponsorship inquiry was submitted.

- Contact: {{contactName}} <{{contactEmail}}>
- Organization: {{organizationName}}
- Sponsor type: {{sponsorType}}
- Tier: {{tier}}
- Notes: {{notes}}

[View in admin]({{adminUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  );
