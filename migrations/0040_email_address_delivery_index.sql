-- Address-level delivery evidence reuses the outbox and its provider-event audit rows.
-- Include legacy messages with no user id while keeping lookups bounded by address.
CREATE INDEX IF NOT EXISTS idx_email_outbox_recipient_address
  ON email_outbox(recipient_email COLLATE NOCASE, recipient_user_id);
