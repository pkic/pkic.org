ALTER TABLE registrations ADD COLUMN pending_confirmation_deadline_at TEXT;

UPDATE registrations
SET pending_confirmation_deadline_at = datetime('now', '+14 days')
WHERE status = 'pending_email_confirmation'
  AND pending_confirmation_deadline_at IS NULL;