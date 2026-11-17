-- Answers to live questions, removal reasons and the studio's Done flag, and
-- event-wide participation blocks. Additive only; reason vocabularies are the
-- shared moderation policy's and are not frozen into CHECK constraints.

-- Why a moderator removed a question (null unless hidden), and when the studio cleared it from its queue.
ALTER TABLE event_session_questions ADD COLUMN removed_reason TEXT;
ALTER TABLE event_session_questions ADD COLUMN done_at TEXT;

-- The durable copy of a question's answers. Votes are a count only: who voted stays in the room.
CREATE TABLE event_session_question_answers (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL,
 question_id TEXT NOT NULL REFERENCES event_session_questions(id) ON DELETE CASCADE,
 author_user_id TEXT NOT NULL REFERENCES users(id),
 body TEXT NOT NULL,
 created_at TEXT NOT NULL,
 vote_count INTEGER NOT NULL DEFAULT 0 CHECK(vote_count>=0),
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
