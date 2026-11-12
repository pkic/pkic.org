-- An organizer can email one person the promotion files they picked: session kits,
-- the attendee kit, and badges. The attendee kit belongs to no session, so a render
-- batch row needs an optional session, and each row carries the formats picked for it.
--
-- The session is part of the primary key, which SQLite cannot relax in place.
-- Rejected additive designs:
--   * A second queue table for attendee kits duplicates the claim, retry, and staging owner.
--   * A sentinel session id breaks the foreign key to event_agenda_occurrences.
-- The rebuild keeps every existing row and column; nothing references this table.
-- Recovery: rebuild back with occurrence_id NOT NULL in the primary key, copying only
-- rows with a session (attendee rows are personal requests and can be sent again).

CREATE TABLE event_promotion_batch_recipients_next (
 batch_id TEXT NOT NULL REFERENCES event_promotion_batches(id) ON DELETE CASCADE,
 occurrence_id TEXT REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 -- The formats picked for this row; NULL renders the formats of its batch.
 formats_json TEXT,
 status TEXT NOT NULL DEFAULT 'queued',
 fingerprint TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL,
 processing_token TEXT,
 lease_expires_at TEXT,
 last_error TEXT,
 updated_at TEXT NOT NULL,
 email_status TEXT
);

INSERT INTO event_promotion_batch_recipients_next(batch_id,occurrence_id,user_id,status,fingerprint,attempts,next_attempt_at,processing_token,lease_expires_at,last_error,updated_at,email_status)
SELECT batch_id,occurrence_id,user_id,status,fingerprint,attempts,next_attempt_at,processing_token,lease_expires_at,last_error,updated_at,email_status
FROM event_promotion_batch_recipients;

DROP TABLE event_promotion_batch_recipients;
ALTER TABLE event_promotion_batch_recipients_next RENAME TO event_promotion_batch_recipients;

-- One row per batch, session, and person; the attendee kit is the row without a session.
CREATE UNIQUE INDEX event_promotion_batch_recipient_key ON event_promotion_batch_recipients(batch_id,IFNULL(occurrence_id,''),user_id);
CREATE INDEX event_promotion_batch_due ON event_promotion_batch_recipients(status,next_attempt_at,lease_expires_at);
CREATE INDEX event_promotion_batch_email_pending ON event_promotion_batch_recipients(batch_id,occurrence_id,user_id) WHERE email_status='pending';
CREATE INDEX event_promotion_batch_email_sent ON event_promotion_batch_recipients(occurrence_id,user_id) WHERE email_status IN('pending','queued');
