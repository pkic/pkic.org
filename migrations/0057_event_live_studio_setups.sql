-- An event's studio setup, prepared before the show: how each graphic looks
-- when it goes on air (ticker messages, Up next, audience lists, the session
-- graphic, the check-in instruction) and the panel arrangement each studio
-- workspace starts from. One row per event, shared by every room, replaced
-- whole and versioned by updated_at. The shape is validated by the shared
-- contract on every write; a row that no longer reads falls back to the
-- built-in setup.
CREATE TABLE event_live_studio_setups (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  setup_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT REFERENCES users(id)
);
