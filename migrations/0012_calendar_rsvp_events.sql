-- Stores inbound RSVP signals extracted from calendar reply emails.

CREATE TABLE IF NOT EXISTS calendar_rsvp_events (
  id                TEXT    NOT NULL PRIMARY KEY,
  registration_id   TEXT    NOT NULL,
  ics_uid           TEXT    NOT NULL,
  attendee_email    TEXT    NOT NULL DEFAULT '',
  response_status   TEXT    NOT NULL CHECK (response_status IN ('accepted', 'declined', 'tentative', 'needs_action')),
  provider          TEXT    NOT NULL,
  method            TEXT,
  sequence          INTEGER,
  source_message_id TEXT,
  dedupe_key        TEXT    NOT NULL UNIQUE,
  raw_payload_json  TEXT,
  received_at       TEXT    NOT NULL,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  FOREIGN KEY(registration_id) REFERENCES registrations(id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_rsvp_registration
  ON calendar_rsvp_events(registration_id, received_at DESC);