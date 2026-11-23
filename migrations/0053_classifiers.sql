-- Automatic checks: the PKIC-wide settings for each kind of content, what an
-- event adds to them, and the latest verdict for a proposal, an audience question
-- or uploaded slides. Chat messages keep their verdicts in the live room's own storage.
-- `kind` and `outcome` are validated by the shared domain schema, not here.

CREATE TABLE classifier_settings (
  kind                TEXT    NOT NULL PRIMARY KEY,
  enabled             INTEGER NOT NULL,
  model               TEXT    NOT NULL,
  context             TEXT    NOT NULL,
  -- The flag and score questions, as the shared question schema describes them.
  questions_json      TEXT    NOT NULL,
  revision            INTEGER NOT NULL,
  updated_by_user_id  TEXT REFERENCES users(id),
  updated_at          TEXT    NOT NULL
);

CREATE TABLE event_classifier_additions (
  event_id                    TEXT    NOT NULL REFERENCES events(id),
  kind                        TEXT    NOT NULL,
  context                     TEXT    NOT NULL,
  -- Added questions; one with the id of a PKIC-wide question replaces it for this event.
  questions_json              TEXT    NOT NULL,
  disabled_question_ids_json  TEXT    NOT NULL,
  revision                    INTEGER NOT NULL,
  updated_by_user_id          TEXT REFERENCES users(id),
  updated_at                  TEXT    NOT NULL,
  PRIMARY KEY (event_id, kind)
);

-- One verdict per checked item: a proposal, an audience question, or one uploaded version of slides.
-- It holds the raised flags and scores only, never the checked text.
CREATE TABLE classifier_results (
  kind           TEXT    NOT NULL,
  subject_id     TEXT    NOT NULL,
  outcome        TEXT    NOT NULL,
  verdict_json   TEXT    NOT NULL,
  score_percent  REAL,
  model          TEXT,
  latency_ms     INTEGER NOT NULL,
  checked_at     TEXT    NOT NULL,
  PRIMARY KEY (kind, subject_id)
);

-- Failed checks are counted so a version that keeps failing is given up on.
ALTER TABLE presentation_versions ADD COLUMN classifier_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_presentation_versions_uploaded ON presentation_versions(uploaded_at) WHERE deleted_at IS NULL;

-- Uploaded slides are checked right after upload; this pass retries any
-- recent version still without a verdict.
INSERT INTO scheduled_jobs (job_key, interval_seconds, next_run_at) VALUES
  ('presentation_checks', 600, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
