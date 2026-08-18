-- Migration 0036: RESTful API & Portal-Managed Forms
--
-- (Membership Application Endpoint), (Sponsor Interest
-- Endpoint), and (public members / working-groups endpoints) all need
-- tables that don't exist yet. Per the no-CHECK-constraint
-- convention, status/stage/type columns below carry `-- allowed:`
-- comments only; validation lives in the application layer (Zod).
--
-- Three groups of tables, each pulled forward from an endpoint that needs them now:
--
-- 1. member_applications / member_application_events / application_documents
--    — defined in application_documents, but
--    required immediately by POST /api/v1/members/applications.
--
-- 2. sponsorships / sponsorship_events —
--    required immediately by POST /api/v1/sponsorship/inquiries and
--    /checkout. Only the columns needed to record an inquiry/checkout are
--    exercised in the beginning; the full sales-pipeline admin UI is later.
--    Two columns beyond the schema are added here because of initial changes
--    inquiries commonly come from people with no existing member/org
--    record: `contact_name` / `contact_email` (submitter identity —
--    schema had no way to reach the submitter at all, a gap in the same
--    spirit as the findings in code review) and `checkout_session_id`
--    (idempotency key for the Stripe webhook, mirroring `donations.
--    checkout_session_id`).
--
-- 3. working_groups / working_group_members — required immediately by GET /api/v1/working-groups
--    (list) and GET /api/v1/working-groups/:id (detail + member list).
--    Seeded here with the six working groups already published under
--    content/wg/ so the public endpoints return real data before
--    or touch this table again (e.g. adding chair assignment UI).

-- ── Membership applications ──────────────────────────────

CREATE TABLE member_applications (
  id                   TEXT NOT NULL PRIMARY KEY,
  applicant_email      TEXT NOT NULL,
  applicant_name       TEXT NOT NULL,
  organization_name    TEXT,
  organization_domain  TEXT,
  membership_category  TEXT NOT NULL,
  form_submission_id   TEXT,
  -- the application's answers live in form_submissions/form_submission_answers
  -- (against the 'membership-application' form seeded below), not on this row.
  status               TEXT NOT NULL DEFAULT 'pending',
  -- allowed: pending | in_review | on_hold | in_consultation | ec_review | approved | declined | withdrawn
  stage                TEXT NOT NULL DEFAULT 'pending',
  stage_entered_at     TEXT NOT NULL,
  review_notes         TEXT,
  assigned_to_user_id  TEXT,
  manage_token_hash    TEXT NOT NULL UNIQUE,
  -- sha256 of the applicant's status/document-upload token; plaintext is
  -- returned once at submission time and emailed, never stored.
  on_hold_subtype      TEXT,
  -- allowed: request_authority | request_org_email | request_pki_experience
  --        | request_org_application | request_information
  -- distinguishes *why* an application is on_hold; NULL when not on_hold.
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  FOREIGN KEY(form_submission_id) REFERENCES form_submissions(id),
  FOREIGN KEY(assigned_to_user_id) REFERENCES users(id),
  FOREIGN KEY(membership_category) REFERENCES membership_categories(code)
);

CREATE INDEX idx_member_applications_email ON member_applications(applicant_email);
CREATE INDEX idx_member_applications_domain_status ON member_applications(organization_domain, status);
CREATE INDEX idx_member_applications_stage ON member_applications(stage);
-- Supports the scheduled on-hold-reminder/EC-auto-approve due-work queries'
-- ORDER BY stage_entered_at LIMIT ? (PR #1 review §9.1) with a direct index
-- range scan instead of a full per-stage table scan.
CREATE INDEX idx_member_applications_stage_entered_at ON member_applications(stage, stage_entered_at);

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

-- Approval is a one-time, terminal transition (approveApplication is the
-- sole path to status='approved'). This structurally rejects a second
-- concurrent approval batch outright: if two approve() calls both pass the
-- read-time stage check and race to commit, the loser's event insert
-- violates this index, failing its entire db.batch() (one transaction) —
-- so its provisioning/email/audit/Google-Groups writes in the same batch
-- never commit either, without needing per-statement claim-token chaining.
-- Scoped to `from_stage != 'approved'` (a real transition into approved) so
-- it does NOT also reject updateAdminApplication's own
-- from_stage = to_stage = 'approved' marker event, which records a details
-- edit on an application that's already approved without representing a
-- second approval.
CREATE UNIQUE INDEX uq_member_application_events_approved
  ON member_application_events(application_id)
  WHERE to_stage = 'approved' AND (from_stage IS NULL OR from_stage != 'approved');

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

-- ── Sponsorships ──────────────────────────────────────────────

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
  price_amount_cents     INTEGER,
  price_currency         TEXT,
  -- price snapshot on the transaction, so a later sponsorship_tier_config
  -- change never affects an already-completed sponsorship's recorded price.
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES organizations(id),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(assigned_to_user_id) REFERENCES users(id)
);

CREATE INDEX idx_sponsorships_stage ON sponsorships(pipeline_stage);
CREATE INDEX idx_sponsorships_event ON sponsorships(event_id);
CREATE INDEX idx_sponsorships_org ON sponsorships(organization_id);
-- Supports the scheduled sponsorship renewal-reminder/auto-lapse due-work
-- query's ORDER BY renewal_date LIMIT ? (PR #1 review §9.1) with a direct
-- index range scan instead of an unbounded full-stage scan.
CREATE INDEX idx_sponsorships_stage_renewal ON sponsorships(pipeline_stage, renewal_date);

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

-- ── Working groups ─────────────────────────────────────────────

-- Chairs/vice-chairs are resolved from user_roles (role-wg_chair/
-- role-wg_vice_chair, context_type='working_group') — see migration 0038 —
-- not a column here, so there is exactly one source of truth for who chairs
-- a working group.
CREATE TABLE working_groups (
  id                       TEXT NOT NULL PRIMARY KEY,
  name                     TEXT NOT NULL,
  slug                     TEXT NOT NULL UNIQUE,
  description              TEXT,
  mailing_list_email       TEXT,
  min_endorsers_for_ballot INTEGER NOT NULL DEFAULT 0,
  active                   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE TABLE working_group_members (
  id               TEXT NOT NULL PRIMARY KEY,
  working_group_id TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  -- Which membership (individual or organization-tied aggregate, `members.id`
  -- from migration 0037 below) this WG seat is held on behalf of. Nullable:
  -- a staff-driven add for a target holding more than one active membership
  -- has no unambiguous "acting as" context to record (PR #1 review,
  -- phase1-2-review-20260817.md blocker 2 — "Working-group participation...
  -- need an explicit member_id when the person acts on behalf of a
  -- particular member"). Forward references `members`, created by the next
  -- migration in this same unreleased range — SQLite does not validate FK
  -- target existence at CREATE TABLE time, only at DML time, and `members`
  -- exists by the time any row here is ever written.
  member_id        TEXT,
  joined_at        TEXT NOT NULL,
  left_at          TEXT,
  FOREIGN KEY(working_group_id) REFERENCES working_groups(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(member_id) REFERENCES members(id)
);

CREATE INDEX idx_wg_members_wg ON working_group_members(working_group_id, left_at);
CREATE INDEX idx_wg_members_user ON working_group_members(user_id);
CREATE INDEX idx_wg_members_member ON working_group_members(member_id);
-- At most one active (left_at IS NULL) membership per (working_group, user);
-- partial so a user can rejoin after leaving.
CREATE UNIQUE INDEX idx_wg_members_active_unique ON working_group_members(working_group_id, user_id) WHERE left_at IS NULL;

INSERT OR IGNORE INTO working_groups
  (id, name, slug, description, mailing_list_email, min_endorsers_for_ballot, active, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'Post-Quantum Cryptography Working Group', 'pqc',
   'Preparing the PKI ecosystem for the quantum computing era through collaborative research, education, standards alignment, and practical tooling.',
   NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'Cryptographic Module Working Group', 'cm',
   'A central forum for addressing cryptographic module (CM) and hardware security module (HSM) related topics within the PKI ecosystem.',
   NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'PKI Maturity Model Working Group', 'pkimm',
   'Building a globally recognized PKI maturity model for evaluating, planning, and comparing PKI implementations.',
   NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'Training and Certification Working Group', 'tcwg',
   'Advancing PKI knowledge and skills through structured training paths, certification programs, and accessible educational resources.',
   NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'CA Working Group', 'ca',
   'A working group for discussions and information sharing among publicly trusted Certificate Authorities.',
   NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'CBOM Profiles Working Group', 'cbom',
   'Developing a neutral, open methodology for defining Cryptographic Bill of Materials (CBOM) profiles that map onto industry BOM standards such as SPDX and CycloneDX.',
   NULL, 0, 1, datetime('now'), datetime('now'));

-- ── Portal-managed membership application form ───────────────────────
-- forms.purpose already allows 'application' (migration 0000) — no rebuild
-- needed. This seeds the default field set mirroring the existing
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
   'working_groups', 'Working Groups of Interest', 'multi_select', 0,
   '[{"value":"pqc","label":"Post-Quantum Cryptography Working Group"},{"value":"cm","label":"Cryptographic Module Working Group"},{"value":"pkimm","label":"PKI Maturity Model Working Group"},{"value":"tcwg","label":"Training and Certification Working Group"},{"value":"ca","label":"CA Working Group"},{"value":"cbom","label":"CBOM Profiles Working Group"}]',
   '{"uiWidget":"checkboxes"}', 70, datetime('now'));

-- ── Email templates ──────────────────────────────────────

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
