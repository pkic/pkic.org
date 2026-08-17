-- Migration 0035: Membership category reference table
--
-- The A-G/H1-H8 category list is already centralized in code
-- (assets/shared/schemas/membership-categories.ts) and imported everywhere
-- it's used. This adds a `membership_categories` reference table so
-- category codes are a real DB-enforced vocabulary via FK — not a CHECK
-- constraint (categories are an evolvable product vocabulary, not a durable
-- structural invariant) and not a bare TEXT column (PR #1 review).
--
-- Created first, before any dependent table, so every later table that
-- references a category code (member_applications, member_category_
-- assignments) can declare the FK in its own initial CREATE TABLE — no
-- rebuild required anywhere in this schema.

CREATE TABLE membership_categories (
  code         TEXT NOT NULL PRIMARY KEY,
  is_individual INTEGER NOT NULL DEFAULT 0 CHECK (is_individual IN (0, 1)),
  -- org-less categories (H5/H6/H7) — mirrors INDIVIDUAL_MEMBERSHIP_CATEGORIES
  is_voting     INTEGER NOT NULL DEFAULT 0 CHECK (is_voting IN (0, 1))
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
