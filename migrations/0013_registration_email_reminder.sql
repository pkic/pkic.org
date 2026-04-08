-- Track when we've sent an email confirmation reminder so we don't spam.
ALTER TABLE registrations ADD COLUMN confirmation_reminder_sent_at TEXT;
