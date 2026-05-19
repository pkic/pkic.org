-- Remove the CHECK (reminder_count <= 3) constraint from invites.
-- The maximum number of reminders is controlled by MAX_INVITE_REMINDERS in
-- application config, not enforced at the database level.
-- Uses add/update/drop/rename pattern to avoid recreating the whole table.

DROP INDEX IF EXISTS idx_invites_reminder_due;

ALTER TABLE invites ADD COLUMN reminder_count_new INTEGER NOT NULL DEFAULT 0 CHECK (reminder_count_new >= 0);
UPDATE invites SET reminder_count_new = reminder_count;
ALTER TABLE invites DROP COLUMN reminder_count;
ALTER TABLE invites RENAME COLUMN reminder_count_new TO reminder_count;

CREATE INDEX idx_invites_reminder_due
  ON invites(status, reminder_count, last_communication_at, reminders_paused_until, expires_at);
