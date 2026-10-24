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
 last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX event_promotion_render_due ON event_promotion_renders(status,next_attempt_at,lease_expires_at);
CREATE INDEX event_promotion_render_owner ON event_promotion_renders(event_id,user_id,occurrence_id,fingerprint,format);
