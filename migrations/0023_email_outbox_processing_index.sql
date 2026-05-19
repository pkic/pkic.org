-- Replace the (status, send_after) index used by processPendingOutbox with one
-- that also covers the ORDER BY created_at, eliminating the in-memory sort that
-- caused D1 query timeouts when the outbox table grew large.
--
-- The old index (idx_email_outbox_status_send_after) is retained because it is
-- still used by the admin "has_bounced" check and other status-only lookups.
-- The new index supersedes it for the scheduled outbox processing query:
--
--   SELECT * FROM email_outbox
--   WHERE status IN ('queued', 'retrying') AND send_after <= ?
--   ORDER BY created_at ASC
--   LIMIT ?

CREATE INDEX IF NOT EXISTS idx_email_outbox_processing
  ON email_outbox (status, send_after, created_at);
