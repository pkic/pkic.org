-- Live sessions: answers to live questions and how questions were asked,
-- event-wide participation blocks, chat totals, and the screens each physical
-- room sets up beside Program. Additive only. Reason, role, code and name
-- rules live in the shared Zod schemas and moderation policy, so they can
-- evolve; no CHECK constraints freeze them here.

-- Why a moderator removed a question (null unless hidden), and when the studio cleared it from its queue.
ALTER TABLE event_session_questions ADD COLUMN removed_reason TEXT;
ALTER TABLE event_session_questions ADD COLUMN done_at TEXT;
-- Whether operators prepared a question ahead (a prepared question reaches the
-- room as an ordinary anonymous one, so only this record tells them apart), and
-- the account of the credited person it was addressed to, if any. Questions
-- prepared but never released stay in the room and are not copied. Existing
-- rows read as asked, for everyone.
ALTER TABLE event_session_questions ADD COLUMN prepared INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_session_questions ADD COLUMN addressed_to_user_id TEXT REFERENCES users(id);

-- The durable copy of a question's answers. Votes are a count only: who voted stays in the room.
CREATE TABLE event_session_question_answers (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL,
 question_id TEXT NOT NULL REFERENCES event_session_questions(id) ON DELETE CASCADE,
 author_user_id TEXT NOT NULL REFERENCES users(id),
 body TEXT NOT NULL,
 created_at TEXT NOT NULL,
 vote_count INTEGER NOT NULL DEFAULT 0,
 accepted_by TEXT REFERENCES users(id),
 accepted_at TEXT,
 hidden_by TEXT REFERENCES users(id),
 hidden_at TEXT,
 removed_reason TEXT,
 -- Set when the author, or the question's author, was anonymized: body is emptied.
 redacted_at TEXT,
 copied_at TEXT NOT NULL
);
CREATE INDEX event_session_question_answers_question ON event_session_question_answers(question_id,created_at,id);
CREATE INDEX event_session_question_answers_occurrence ON event_session_question_answers(event_id,occurrence_id,created_at,id);
CREATE INDEX event_session_question_answers_author ON event_session_question_answers(author_user_id,created_at);

-- An organizer keeps a person from posting, voting and reacting in every session of an event.
-- One open block per person and event; a lifted block stays as history.
CREATE TABLE event_participation_blocks (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL,
 blocked_by TEXT NOT NULL REFERENCES users(id),
 blocked_at TEXT NOT NULL,
 lifted_by TEXT REFERENCES users(id),
 lifted_at TEXT
);
CREATE UNIQUE INDEX event_participation_blocks_open ON event_participation_blocks(event_id,user_id) WHERE lifted_at IS NULL;
CREATE INDEX event_participation_blocks_user ON event_participation_blocks(user_id,blocked_at);

-- How many attendee chat messages each live session received, and from how
-- many people, copied from the session's room like its reaction totals. Only
-- counts reach D1: the messages themselves stay in the room until it erases
-- its storage after the session.
CREATE TABLE event_session_chat_totals (
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL,
 messages INTEGER NOT NULL,
 people INTEGER NOT NULL,
 copied_at TEXT NOT NULL,
 PRIMARY KEY(event_id,occurrence_id)
);

-- The outputs a physical room sets up beside Program: screens in the room and
-- sources in the production software, each with a name, a short code, what it
-- shows and the scene it draws. A room with no rows keeps the outputs it always
-- had. A screen's scene is where it starts; a locked screen keeps that scene
-- whatever a take from Preview brings.
CREATE TABLE event_agenda_room_outputs (
  event_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  output_key TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  role TEXT NOT NULL,
  scene_slug TEXT,
  scene_locked INTEGER NOT NULL DEFAULT 0,
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
-- Grants `agenda:live_studio` (running a room's control desk: what is on air, its screens and overlays) to
-- administrators, event organizers and volunteers, who step in wherever the event needs them.
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),candidate.role_id,'agenda:live_studio',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT 'role-admin' AS role_id UNION ALL SELECT 'role-event_organizer' UNION ALL SELECT 'role-event_volunteer') AS candidate
WHERE NOT EXISTS(SELECT 1 FROM role_permissions existing WHERE existing.role_id=candidate.role_id AND existing.permission='agenda:live_studio');
-- Every event-team role moderates the event's live chat and questions.
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),candidate.role_id,'agenda:live_moderate',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT 'role-program_committee' AS role_id UNION ALL SELECT 'role-event_moderator' UNION ALL SELECT 'role-event_volunteer') AS candidate
WHERE NOT EXISTS(SELECT 1 FROM role_permissions existing WHERE existing.role_id=candidate.role_id AND existing.permission='agenda:live_moderate');
-- Grants `agenda:badge_print` (printing a registered attendee's badge at the desk, without managing badges) to
-- administrators, event organizers and volunteers.
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),candidate.role_id,'agenda:badge_print',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT 'role-admin' AS role_id UNION ALL SELECT 'role-event_organizer' UNION ALL SELECT 'role-event_volunteer') AS candidate
WHERE NOT EXISTS(SELECT 1 FROM role_permissions existing WHERE existing.role_id=candidate.role_id AND existing.permission='agenda:badge_print');
