-- Reminder state for invite and presentation follow-ups.

ALTER TABLE invites ADD COLUMN last_communication_at TEXT;
ALTER TABLE invites ADD COLUMN reminders_paused_until TEXT;

UPDATE invites
SET last_communication_at = COALESCE(last_communication_at, created_at)
WHERE last_communication_at IS NULL;

ALTER TABLE proposal_speakers ADD COLUMN presentation_reminder_count INTEGER NOT NULL DEFAULT 0
  CHECK (presentation_reminder_count >= 0 AND presentation_reminder_count <= 24);
ALTER TABLE proposal_speakers ADD COLUMN presentation_last_communication_at TEXT;
ALTER TABLE proposal_speakers ADD COLUMN presentation_reminders_paused_until TEXT;

CREATE INDEX idx_invites_reminder_due
  ON invites(status, reminder_count, last_communication_at, reminders_paused_until, expires_at);

CREATE INDEX idx_proposal_speakers_presentation_reminder_due
  ON proposal_speakers(status, presentation_reminder_count, presentation_last_communication_at, presentation_reminders_paused_until);