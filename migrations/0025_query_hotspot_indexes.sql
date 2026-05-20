-- Indexes for D1 Query Insights hotspots. Keep this set deliberately small
-- and prefer partial indexes where the query predicates are stable.

-- Superseded by the partial idx_email_outbox_processing below.
DROP INDEX IF EXISTS idx_email_outbox_status_send_after;

-- Replace the previous full processing index with a partial index over only
-- rows that can still be picked up by outbox processing.
DROP INDEX IF EXISTS idx_email_outbox_processing;

CREATE INDEX idx_email_outbox_processing
  ON email_outbox(status, send_after, created_at)
  WHERE status IN ('queued', 'retrying');

-- Replaced by a partial covering index for the latest user+event outbox status.
DROP INDEX IF EXISTS idx_email_outbox_user_event_status;

CREATE INDEX IF NOT EXISTS idx_email_outbox_provider_message_id
  ON email_outbox(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_outbox_user_event_latest_status
  ON email_outbox(recipient_user_id, event_id, updated_at DESC, status)
  WHERE recipient_user_id IS NOT NULL AND event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_registrations_created_at
  ON registrations(created_at);

CREATE INDEX IF NOT EXISTS idx_invites_created_at
  ON invites(created_at);