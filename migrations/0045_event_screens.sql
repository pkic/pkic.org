-- Event screens: physical displays that pair once and stay signed in.
-- A screen's ID is the device's own stable, non-secret identifier. Staff give
-- it a name saying where it stands and assign it one room of one event and
-- one output. Output and layout values are product vocabulary, enforced by the
-- shared contracts, not by CHECK constraints.
CREATE TABLE screens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  room_id TEXT REFERENCES event_agenda_rooms(id) ON DELETE SET NULL,
  output TEXT,
  layout TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  assigned_by TEXT REFERENCES users(id),
  assigned_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX screens_event_name ON screens(event_id, name, id);

-- A pairing a staff member approved is a pending session holding a hash of
-- the pairing code; the screen activates it with its signed challenge. Only
-- active, unrevoked, unexpired sessions authorize the screen.
CREATE TABLE screen_sessions (
  id TEXT PRIMARY KEY,
  screen_id TEXT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  pairing_code_hash TEXT,
  approved_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  activated_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT
);
CREATE INDEX screen_sessions_screen_state ON screen_sessions(screen_id, activated_at, revoked_at);

-- Pairing, naming, assigning and revoking screens is its own capability, held
-- by administrators and event organizers and grantable to other staff per
-- event. It does not steer the program.
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),candidate.role_id,'agenda:screens_manage',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT 'role-admin' AS role_id UNION ALL SELECT 'role-event_organizer') AS candidate
WHERE EXISTS(SELECT 1 FROM roles WHERE roles.id=candidate.role_id)
  AND NOT EXISTS(SELECT 1 FROM role_permissions existing WHERE existing.role_id=candidate.role_id AND existing.permission='agenda:screens_manage');
