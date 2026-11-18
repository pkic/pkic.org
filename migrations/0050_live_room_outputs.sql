-- The outputs a physical room sets up beside Program: screens in the room and
-- sources in the production software, each with a name, a short code, what it
-- shows and the scene it draws. A room with no rows keeps the outputs it always
-- had. Role, code and name rules live in the shared Zod schema
-- (assets/shared/schemas/live-room-output-setup.ts), so they can evolve.
CREATE TABLE event_agenda_room_outputs (
  event_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  output_key TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  role TEXT NOT NULL,
  scene_slug TEXT,
  position INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT REFERENCES users(id),
  PRIMARY KEY (room_id, output_key),
  UNIQUE (room_id, code),
  FOREIGN KEY (event_id, room_id) REFERENCES event_agenda_rooms(event_id, id) ON DELETE CASCADE
);
-- Grants `agenda:live_setup` (changing the scenes every room of an event shares) to administrators and event organizers.
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),candidate.role_id,'agenda:live_setup',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT 'role-admin' AS role_id UNION ALL SELECT 'role-event_organizer') AS candidate
WHERE NOT EXISTS(SELECT 1 FROM role_permissions existing WHERE existing.role_id=candidate.role_id AND existing.permission='agenda:live_setup');
