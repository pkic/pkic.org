-- Reminder state for speaker-invite follow-ups.

ALTER TABLE proposal_speakers ADD COLUMN speaker_invite_reminder_count INTEGER NOT NULL DEFAULT 0
  CHECK (speaker_invite_reminder_count >= 0 AND speaker_invite_reminder_count <= 24);
ALTER TABLE proposal_speakers ADD COLUMN speaker_invite_last_communication_at TEXT;
ALTER TABLE proposal_speakers ADD COLUMN speaker_invite_reminders_paused_until TEXT;

UPDATE proposal_speakers
SET speaker_invite_last_communication_at = COALESCE(speaker_invite_last_communication_at, created_at)
WHERE speaker_invite_last_communication_at IS NULL;

CREATE INDEX idx_proposal_speakers_speaker_invite_reminder_due
  ON proposal_speakers(status, speaker_invite_reminder_count, speaker_invite_last_communication_at, speaker_invite_reminders_paused_until);