-- Migration 0037: Membership category assignment + organization representatives
--
-- `members` (migration 0000) already models the aggregate this PR needs —
-- one row per organization or per individual, mutual exclusivity of
-- user_id/organization_id already enforced — so it is never rebuilt or
-- altered by this PR. What was missing is a home for (1) the membership
-- category of an aggregate and (2) the N people who represent an
-- organization-tied aggregate. Both are additive, 1:1-or-1:N tables keyed
-- off members.id, not columns bolted onto members/organizations.
--
-- Representative *roles* (primary contact, secondary contact, voting
-- delegate) deliberately do not get their own table here — they reuse the
-- existing roles/user_roles RBAC system (see migration 0038's additive
-- delta), scoped by context_type='organization'/context_id=members.id.

-- ── Membership category assignment ──────────────────────────────────────
-- One category per aggregate (organization-tied or individual), in its own
-- table rather than a column on members (which the review flagged as
-- table-widening churn) or organizations (which would need syncing back to
-- members for individuals, who have no organizations row at all).
CREATE TABLE member_category_assignments (
  member_id     TEXT NOT NULL PRIMARY KEY,
  category_code TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(category_code) REFERENCES membership_categories(code)
);

-- ── Organization representatives ─────────────────────────────────────────
-- The N people who represent an org-tied membership aggregate. Temporal
-- (joined_at/left_at) — active/inactive is exactly what left_at IS NULL/IS
-- NOT NULL means, so transfer (close old row, open new one) and rejoin
-- (open a fresh row) both fall out of ordinary inserts/updates.
CREATE TABLE organization_representatives (
  id                  TEXT NOT NULL PRIMARY KEY,
  member_id           TEXT NOT NULL,
  -- FK to members.id — the organization's aggregate row
  user_id             TEXT NOT NULL,
  show_on_org_profile INTEGER NOT NULL DEFAULT 1 CHECK (show_on_org_profile IN (0, 1)),
  joined_at           TEXT NOT NULL,
  left_at             TEXT,
  -- NULL while active
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK (left_at IS NULL OR left_at >= joined_at),
  UNIQUE (id, member_id),
  -- lets a service-layer check prove a representative row belongs to a
  -- specific member before granting a representative role against it
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- A person may represent more than one organization at a time (confirmed
-- product decision — e.g. someone representing both their own employer and
-- PKI Consortium, or multiple member organizations simultaneously), so this
-- constrains only the active pair, not "one active representative row per
-- user" globally. Partial so a former representative can rejoin: their old,
-- now-inactive (left_at IS NOT NULL) row no longer occupies the pair.
CREATE UNIQUE INDEX uq_organization_representatives_active_pair
  ON organization_representatives(member_id, user_id)
  WHERE left_at IS NULL;

CREATE INDEX idx_organization_representatives_member_active
  ON organization_representatives(member_id, left_at, joined_at);
CREATE INDEX idx_organization_representatives_user_active
  ON organization_representatives(user_id, left_at, joined_at);
