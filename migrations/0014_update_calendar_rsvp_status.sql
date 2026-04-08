-- Remove strict CHECK constraint on response_status and add workflow state tracking columns

-- We cannot merely ALTER TABLE MODIFY COLUMN in SQLite to remove a CHECK constraint, 
-- but since this is just D1 (SQLite), we can just create a lighter table recreation specifically 
-- dropping the ENUM CHECK constraint entirely so any status can be logged from email clients.

-- Note: Because D1 processes migrations in batch chunks, dropping and recreating 
-- is generally safe and incredibly fast for small state tables.

PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE calendar_rsvp_events_new (
  id                TEXT    NOT NULL PRIMARY KEY,
  registration_id   TEXT    NOT NULL,
  ics_uid           TEXT    NOT NULL,
  attendee_email    TEXT    NOT NULL DEFAULT '',
  response_status   TEXT    NOT NULL, -- Dropped strict CHECK ('accepted', 'declined', 'tentative', 'needs_action') to natively permit 'bounced'
  provider          TEXT    NOT NULL,
  method            TEXT,
  sequence          INTEGER,
  source_message_id TEXT,
  dedupe_key        TEXT    NOT NULL UNIQUE,
  raw_payload_json  TEXT,
  received_at       TEXT    NOT NULL,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  
  -- State flags for the automated warning/downgrade pipeline
  warning_sent_at       TEXT,
  action_executed_at    TEXT,
  action_taken          TEXT, -- e.g. 'cancelled', 'downgraded_virtual', 'downgraded_on_demand'
  
  FOREIGN KEY(registration_id) REFERENCES registrations(id)
);

INSERT INTO calendar_rsvp_events_new (
  id, registration_id, ics_uid, attendee_email, response_status,
  provider, method, sequence, source_message_id, dedupe_key,
  raw_payload_json, received_at, created_at, updated_at
)
SELECT 
  id, registration_id, ics_uid, attendee_email, response_status,
  provider, method, sequence, source_message_id, dedupe_key,
  raw_payload_json, received_at, created_at, updated_at
FROM calendar_rsvp_events;

DROP TABLE calendar_rsvp_events;

ALTER TABLE calendar_rsvp_events_new RENAME TO calendar_rsvp_events;

CREATE INDEX idx_calendar_rsvp_registration
  ON calendar_rsvp_events(registration_id, received_at DESC);
