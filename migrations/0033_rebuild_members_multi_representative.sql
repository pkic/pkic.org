-- Migration 0033: Rebuild `members` to allow multiple representatives per organization
--
-- Phase 0 (PRD §0.1) — Schema Reconciliation & Foundations.
--
-- The original members table enforced UNIQUE(organization_id) plus a CHECK
-- tying member_type to exactly one of user_id/organization_id, modeling
-- "the organization is the member" rather than "N people represent this
-- member organization". Phase 4 features (primary/secondary contacts,
-- WG-level voting by individual representative, per-person visibility
-- toggles, acquisition transfers moving representatives one by one) all
-- require multiple members rows per organization_id.
--
-- SQLite cannot ALTER a CHECK/UNIQUE constraint, so this is a
-- create-new/copy-data/drop-old/rename rebuild. UNIQUE(user_id) is kept:
-- each person still has at most one members row. Per this table's own
-- no-CHECK-constraint convention going forward, the member_type/status
-- CHECKs are dropped too; allowed values are documented in comments and
-- validated at the application layer instead.

PRAGMA foreign_keys = OFF;

CREATE TABLE members_new (
  id              TEXT NOT NULL PRIMARY KEY,
  member_type     TEXT NOT NULL,
  -- legacy values: individual | organization
  -- going forward: carries membership category A-H together with `tier`
  user_id         TEXT NOT NULL,
  organization_id TEXT,
  -- set for org-tied categories A-G and H1-H4/H8 (one row per representative)
  -- NULL for individual categories H5/H6/H7
  status          TEXT NOT NULL DEFAULT 'active',
  -- allowed: active | inactive | pending | lapsed
  tier            TEXT,
  data_json       TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(user_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id)
);

-- Existing single-row-per-org data migrates cleanly: the one existing
-- members row per organization becomes that organization's primary
-- contact row.
INSERT INTO members_new (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at)
SELECT id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at
FROM members;

DROP TABLE members;

ALTER TABLE members_new RENAME TO members;

CREATE INDEX idx_members_type_status ON members(member_type, status);
CREATE INDEX idx_members_organization ON members(organization_id);

PRAGMA foreign_keys = ON;
