-- Migration 0056: Drop dead `working_groups.chair_user_id` column
--
-- Created and seeded once in migration 0034, never read anywhere in
-- functions/ or assets/ — chairs are resolved from `user_roles`
-- (role-wg_chair/role-wg_vice_chair, context_type='working_group'), which
-- members-directory.ts and admin-working-groups.ts already document as the
-- canonical source (PR #1 review: dead/duplicate source of truth).
--
-- SQLite's DROP COLUMN refuses columns that are part of a FOREIGN KEY
-- constraint (chair_user_id has one, referencing users(id)), so this
-- needs the create-new/copy-data/drop-old/rename rebuild migration 0033/
-- 0055 already established. Unlike those, working_groups is the parent of
-- several live FK relationships (working_group_members, mailing_lists,
-- meeting_series, votes/vote_proposals scope_id) with real seeded rows —
-- D1 enforces foreign keys unconditionally (`PRAGMA foreign_keys` cannot
-- be disabled, and `PRAGMA defer_foreign_keys` does not survive a
-- DROP+recreate of the referenced table either — both confirmed directly
-- against local D1), so the rebuild can't proceed while those rows exist.
--
-- Every referencing column here is nullable except
-- working_group_members.working_group_id (NOT NULL) — so for the four
-- nullable ones, the referencing value is backed up and nulled out (rows
-- untouched, no cascade into their own children like meeting_ics_files/
-- member_meeting_preferences), and only working_group_members itself needs
-- a full row backup + delete. Both are restored once the new table exists
-- with the same ids.

CREATE TABLE _wg_backup_members AS SELECT * FROM working_group_members;
DELETE FROM working_group_members;

CREATE TABLE _wg_backup_meeting_series AS
  SELECT id, working_group_id FROM meeting_series WHERE working_group_id IS NOT NULL;
UPDATE meeting_series SET working_group_id = NULL WHERE working_group_id IS NOT NULL;

CREATE TABLE _wg_backup_mailing_lists AS
  SELECT id, working_group_id FROM mailing_lists WHERE working_group_id IS NOT NULL;
UPDATE mailing_lists SET working_group_id = NULL WHERE working_group_id IS NOT NULL;

CREATE TABLE _wg_backup_votes AS
  SELECT id, scope_id FROM votes WHERE scope_id IS NOT NULL;
UPDATE votes SET scope_id = NULL WHERE scope_id IS NOT NULL;

CREATE TABLE _wg_backup_vote_proposals AS
  SELECT id, scope_id FROM vote_proposals WHERE scope_id IS NOT NULL;
UPDATE vote_proposals SET scope_id = NULL WHERE scope_id IS NOT NULL;

CREATE TABLE working_groups_new (
  id                       TEXT NOT NULL PRIMARY KEY,
  name                     TEXT NOT NULL,
  slug                     TEXT NOT NULL UNIQUE,
  description              TEXT,
  mailing_list_email       TEXT,
  min_endorsers_for_ballot INTEGER NOT NULL DEFAULT 0,
  active                   INTEGER NOT NULL DEFAULT 1,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

INSERT INTO working_groups_new
SELECT id, name, slug, description, mailing_list_email, min_endorsers_for_ballot, active, created_at, updated_at
FROM working_groups;

DROP TABLE working_groups;
ALTER TABLE working_groups_new RENAME TO working_groups;

INSERT INTO working_group_members SELECT * FROM _wg_backup_members;
DROP TABLE _wg_backup_members;

UPDATE meeting_series
SET working_group_id = (SELECT working_group_id FROM _wg_backup_meeting_series b WHERE b.id = meeting_series.id)
WHERE id IN (SELECT id FROM _wg_backup_meeting_series);
DROP TABLE _wg_backup_meeting_series;

UPDATE mailing_lists
SET working_group_id = (SELECT working_group_id FROM _wg_backup_mailing_lists b WHERE b.id = mailing_lists.id)
WHERE id IN (SELECT id FROM _wg_backup_mailing_lists);
DROP TABLE _wg_backup_mailing_lists;

UPDATE votes
SET scope_id = (SELECT scope_id FROM _wg_backup_votes b WHERE b.id = votes.id)
WHERE id IN (SELECT id FROM _wg_backup_votes);
DROP TABLE _wg_backup_votes;

UPDATE vote_proposals
SET scope_id = (SELECT scope_id FROM _wg_backup_vote_proposals b WHERE b.id = vote_proposals.id)
WHERE id IN (SELECT id FROM _wg_backup_vote_proposals);
DROP TABLE _wg_backup_vote_proposals;
