-- Migration 0055: Membership category reference table + FK invariant
--
-- The A-G/H1-H8 category list is already centralized in code
-- (assets/shared/schemas/membership-categories.ts, per migration message
-- history) and imported everywhere it's used. What's still missing (PR #1
-- review, reopened) is a DB-level invariant: members.member_type,
-- organizations.membership_category, and member_applications.
-- membership_category are plain TEXT columns that accept any string.
--
-- This adds a `membership_categories` reference table and a FOREIGN KEY
-- from each of those three columns to it — a real DB-enforced invariant
-- via FK, not a CHECK constraint (this schema has an established,
-- documented no-CHECK-constraint convention — see migration 0033 — so a
-- reference table + FK is the mechanism consistent with that convention
-- and with how this schema already relies on FKs elsewhere, e.g.
-- working_groups.chair_user_id). NULL stays allowed wherever the column
-- itself is nullable (a NULL foreign key value is exempt from FK
-- enforcement) — no existing nullability changes.
--
-- SQLite cannot ALTER a column to add a FOREIGN KEY constraint, so members/
-- organizations/member_applications are rebuilt (create-new/copy-data/
-- drop-old/rename), the same pattern migration 0033 already established.

PRAGMA foreign_keys = OFF;

CREATE TABLE membership_categories (
  code         TEXT NOT NULL PRIMARY KEY,
  is_individual INTEGER NOT NULL DEFAULT 0,
  -- org-less categories (H5/H6/H7) — mirrors INDIVIDUAL_MEMBERSHIP_CATEGORIES
  is_voting     INTEGER NOT NULL DEFAULT 0
  -- forum + WG voting rights (A-G only) — mirrors VOTING_CATEGORIES
);

INSERT INTO membership_categories (code, is_individual, is_voting) VALUES
  ('A', 0, 1),
  ('B', 0, 1),
  ('C', 0, 1),
  ('D', 0, 1),
  ('E', 0, 1),
  ('F', 0, 1),
  ('G', 0, 1),
  ('H1', 0, 0),
  ('H2', 0, 0),
  ('H3', 0, 0),
  ('H4', 0, 0),
  ('H5', 1, 0),
  ('H6', 1, 0),
  ('H7', 1, 0),
  ('H8', 0, 0);

-- ── members ─────────────────────────────────────────────────────────────

CREATE TABLE members_new (
  id              TEXT NOT NULL PRIMARY KEY,
  member_type     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  organization_id TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  tier            TEXT,
  data_json       TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  show_on_org_profile INTEGER NOT NULL DEFAULT 1,
  member_since    TEXT,
  UNIQUE(user_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id),
  FOREIGN KEY(member_type) REFERENCES membership_categories(code)
);

INSERT INTO members_new
SELECT id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at,
       show_on_org_profile, member_since
FROM members;

DROP TABLE members;
ALTER TABLE members_new RENAME TO members;

CREATE INDEX idx_members_organization ON members(organization_id);
CREATE INDEX idx_members_type_status ON members(member_type, status);

-- ── organizations ──────────────────────────────────────────────────────

CREATE TABLE organizations_new (
  id              TEXT NOT NULL PRIMARY KEY,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  data_json       TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  description     TEXT,
  website         TEXT,
  content_markdown TEXT,
  slogan          TEXT,
  logo_r2_key     TEXT,
  blog_url        TEXT,
  blog_feed_url   TEXT,
  press_url       TEXT,
  press_feed_url  TEXT,
  careers_url     TEXT,
  primary_contact_user_id TEXT REFERENCES users(id),
  secondary_contact_user_id TEXT REFERENCES users(id),
  organization_domains_json TEXT,
  membership_category TEXT,
  voting_delegate_user_id TEXT REFERENCES users(id),
  pending_secondary_contact_user_id TEXT REFERENCES users(id),
  logo_staging_r2_key TEXT,
  sponsor_tier    TEXT,
  sponsor_start_date TEXT,
  member_since    TEXT,
  slug            TEXT,
  links_json      TEXT,
  FOREIGN KEY(membership_category) REFERENCES membership_categories(code)
);

INSERT INTO organizations_new
SELECT id, name, normalized_name, data_json, created_at, updated_at, description, website,
       content_markdown, slogan, logo_r2_key, blog_url, blog_feed_url, press_url, press_feed_url,
       careers_url, primary_contact_user_id, secondary_contact_user_id, organization_domains_json,
       membership_category, voting_delegate_user_id, pending_secondary_contact_user_id,
       logo_staging_r2_key, sponsor_tier, sponsor_start_date, member_since, slug, links_json
FROM organizations;

DROP TABLE organizations;
ALTER TABLE organizations_new RENAME TO organizations;

CREATE UNIQUE INDEX idx_organizations_slug ON organizations(slug) WHERE slug IS NOT NULL;

-- ── member_applications ────────────────────────────────────────────────

CREATE TABLE member_applications_new (
  id                   TEXT NOT NULL PRIMARY KEY,
  applicant_email      TEXT NOT NULL,
  applicant_name       TEXT NOT NULL,
  organization_name    TEXT,
  organization_domain  TEXT,
  membership_category  TEXT NOT NULL,
  form_submission_id   TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  stage                TEXT NOT NULL DEFAULT 'pending',
  stage_entered_at     TEXT NOT NULL,
  review_notes         TEXT,
  assigned_to_user_id  TEXT,
  manage_token_hash    TEXT NOT NULL UNIQUE,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  on_hold_subtype      TEXT,
  FOREIGN KEY(form_submission_id) REFERENCES form_submissions(id),
  FOREIGN KEY(assigned_to_user_id) REFERENCES users(id),
  FOREIGN KEY(membership_category) REFERENCES membership_categories(code)
);

INSERT INTO member_applications_new
SELECT id, applicant_email, applicant_name, organization_name, organization_domain,
       membership_category, form_submission_id, status, stage, stage_entered_at, review_notes,
       assigned_to_user_id, manage_token_hash, created_at, updated_at, on_hold_subtype
FROM member_applications;

DROP TABLE member_applications;
ALTER TABLE member_applications_new RENAME TO member_applications;

CREATE INDEX idx_member_applications_domain_status ON member_applications(organization_domain, status);
CREATE INDEX idx_member_applications_email ON member_applications(applicant_email);
CREATE INDEX idx_member_applications_stage ON member_applications(stage);

PRAGMA foreign_keys = ON;
