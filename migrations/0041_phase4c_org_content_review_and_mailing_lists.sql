-- Migration 0041: Phase 4C — Organization Profile Moderation & Managed
-- Mailing List Configuration
--
-- PRD §4.11 (the *workflow* half — the data-bearing half was pulled forward
-- by migration 0037; see that migration's own header and prd.md §0.6 finding
-- #19) and §4.14. No CHECK constraints, per this repo's standing convention
-- — allowed values are documented in `-- allowed:` comments and validated at
-- the application layer (Zod) instead.

-- ── §4.11 workflow-only columns, deferred by migration 0037 ──────────────
ALTER TABLE organizations ADD COLUMN voting_delegate_user_id TEXT REFERENCES users(id);
-- NULL means primary_contact_user_id is the default voting delegate for
-- forum-level votes (§4.8, Phase 4B — not yet built, column added now so
-- Phase 4B has somewhere to read/write it without another schema pull).
ALTER TABLE organizations ADD COLUMN pending_secondary_contact_user_id TEXT REFERENCES users(id);
-- Holds a secondary contact nomination (PATCH /api/v1/me/organization/secondary-contact)
-- until confirmed by a staff admin.
ALTER TABLE organizations ADD COLUMN logo_staging_r2_key TEXT;
-- Pending logo awaiting moderation approval; promoted to logo_r2_key when
-- the review it's attached to is approved.

-- ── Organization content moderation queue (§4.11) ────────────────────────
CREATE TABLE organization_content_reviews (
  id                    TEXT NOT NULL PRIMARY KEY,
  organization_id       TEXT NOT NULL,
  submitted_by_user_id  TEXT NOT NULL,
  proposed_changes_json TEXT NOT NULL,
  -- snapshot of every changed field, { [field]: newValue }
  logo_staging_r2_key   TEXT,
  -- set when this submission includes a proposed logo change
  status                TEXT NOT NULL DEFAULT 'pending',
  -- allowed: pending | approved | rejected | withdrawn
  reviewer_user_id      TEXT,
  reviewer_note         TEXT,
  submitted_at          TEXT NOT NULL,
  reviewed_at           TEXT,
  created_at            TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES organizations(id),
  FOREIGN KEY(submitted_by_user_id) REFERENCES users(id),
  FOREIGN KEY(reviewer_user_id) REFERENCES users(id)
);

CREATE INDEX idx_org_content_reviews_org_status ON organization_content_reviews(organization_id, status);
CREATE INDEX idx_org_content_reviews_status ON organization_content_reviews(status, submitted_at);

-- ── §4.14 Managed mailing list configuration ─────────────────────────────
-- Replaces the hardcoded PKIC_ALL_MEMBERS_LIST/CONSULTATION_LIST constants
-- in membership-onboarding.ts, which had no staff-editable home before this.
-- Working-group lists keep working_groups.mailing_list_email as their
-- operational sync target (see prd.md Phase 4C status, decision on this) —
-- the working_group_id rows below are seeded for inventory/visibility in
-- the unified Admin -> Mailing Lists screen only.
CREATE TABLE mailing_lists (
  id                        TEXT NOT NULL PRIMARY KEY,
  email                     TEXT NOT NULL UNIQUE,
  label                     TEXT NOT NULL,
  list_type                 TEXT NOT NULL,
  -- allowed: all_members | consultation | ec | working_group | custom
  working_group_id          TEXT REFERENCES working_groups(id),
  auto_sync_categories_json TEXT,
  -- JSON array of category letters, e.g. ["A","B","C","D","E","F","G"].
  -- Only consulted for list_type IN ('all_members','consultation') — see
  -- resolveAutoSyncListEmails in mailing-lists.ts. NULL means "every
  -- membership category" (used by the all_members list).
  active                    INTEGER NOT NULL DEFAULT 1,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);

CREATE INDEX idx_mailing_lists_type_active ON mailing_lists(list_type, active);

-- Seeded on migration: the 9 known lists (PRD §4.14). working_group_id is
-- always NULL here, deliberately not resolved by a subquery against
-- working_groups at migration time — migration 0034 seeds 6 canonical
-- working_groups rows (pqc/ca/tcwg/cm/pkimm/cbom) that would match, but
-- linking to them here would make these rows carry a real FK reference into
-- a table this codebase's test suite otherwise treats as ordinary per-test
-- business data (tests/helpers/reset-db.ts's own comment: "working_groups,
-- which tests already re-seed themselves when they need it"). Staff link
-- each working_group-type row to its working group via the admin UI
-- (PATCH .../admin/mailing-lists/:id) after migration instead.
INSERT INTO mailing_lists (id, email, label, list_type, working_group_id, auto_sync_categories_json, active, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'pkic@lists.pkic.org', 'All Members', 'all_members', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'consultation@lists.pkic.org', 'Member Consultation', 'consultation', NULL, '["A","B","C","D","E","F","G"]', 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'ec@lists.pkic.org', 'Executive Council', 'ec', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'pqc@lists.pkic.org', 'Post-Quantum Cryptography WG', 'working_group', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'ca@lists.pkic.org', 'Certificate Authority WG', 'working_group', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'tcwg@lists.pkic.org', 'Trust Chain WG', 'working_group', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'cm@lists.pkic.org', 'Certificate Management WG', 'working_group', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'pkimm@lists.pkic.org', 'PKI Maturity Model WG', 'working_group', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'cbom@lists.pkic.org', 'Crypto Bill of Materials WG', 'working_group', NULL, NULL, 1, datetime('now'), datetime('now'));

-- ── New email templates (§4.11) ──────────────────────────────────────────
-- org-contact-assigned already shipped with migration 0038 (wired to
-- application-approval onboarding). These three are net-new, wired to the
-- content moderation workflow this migration's tables support.
INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'org-content-submitted', 1,
    'Organization content change submitted for review — {{organizationName}}',
    'A content change has been submitted for **{{organizationName}}** by {{submitterName}}.

[Review the submission]({{reviewUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'org-content-approved', 1,
    'Your organization profile update was approved',
    'Hi {{contactName}},

The content changes you submitted for {{organizationName}}''s profile have been approved and are now live.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'org-content-rejected', 1,
    'Your organization profile update was not approved',
    'Hi {{contactName}},

The content changes you submitted for {{organizationName}}''s profile were not approved.

{{reviewerNote}}

You may revise and resubmit at any time.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  );
