-- Remove legacy whole-registration waitlist storage and normalize any stale statuses.

UPDATE registrations
SET status = 'registered', updated_at = datetime('now')
WHERE status = 'waitlisted';

DROP INDEX IF EXISTS idx_waitlist_event_status;
DROP TABLE IF EXISTS waitlist_entries;
