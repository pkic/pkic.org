-- Personal presentation choices contain authored promotion text and resource
-- references only. Names, affiliations, portraits, schedule and sponsor data
-- continue to be resolved from their canonical records.
CREATE TABLE event_promotion_kits (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 occurrence_id TEXT REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 1,
 composition_json TEXT NOT NULL CHECK(json_valid(composition_json)),
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX event_promotion_kit_owner ON event_promotion_kits(event_id,user_id,COALESCE(occurrence_id,''));

-- The existing durable renderer now handles both session and attendee kits.
-- This additive successor removes the old queue's mandatory session FK;
-- old derived render state is retained but is no longer drained.
CREATE TABLE event_promotion_renders (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 occurrence_id TEXT REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 fingerprint TEXT NOT NULL,
 format TEXT NOT NULL, origin TEXT NOT NULL, cache_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, download_count INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL, processing_token TEXT, lease_expires_at TEXT,
 last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, requested_at TEXT
);
CREATE INDEX event_promotion_render_due ON event_promotion_renders(status,next_attempt_at,lease_expires_at);
CREATE INDEX event_promotion_render_owner ON event_promotion_renders(event_id,user_id,occurrence_id,fingerprint,format);
-- Keep current kit progress bounded independently of completed or obsolete render history.
CREATE INDEX event_promotion_render_requested ON event_promotion_renders(event_id,user_id,occurrence_id,format,requested_at DESC);

-- A bulk request contains resource references only. The dispatcher prepares
-- bounded recipients for the existing render queue; it never renders a full
-- event inside an HTTP request.
CREATE TABLE event_promotion_batches (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 requested_by TEXT NOT NULL REFERENCES users(id),
 published_revision INTEGER NOT NULL,
 formats_json TEXT NOT NULL CHECK(json_valid(formats_json)),
 origin TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX event_promotion_batch_event ON event_promotion_batches(event_id,created_at);
CREATE TABLE event_promotion_batch_recipients (
 batch_id TEXT NOT NULL REFERENCES event_promotion_batches(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'queued',
 fingerprint TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL,
 processing_token TEXT,
 lease_expires_at TEXT,
 last_error TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(batch_id,occurrence_id,user_id)
);
CREATE INDEX event_promotion_batch_due ON event_promotion_batch_recipients(status,next_attempt_at,lease_expires_at);
