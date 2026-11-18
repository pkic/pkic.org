-- Reporting keeps two more facts about each question a live room copies here:
-- whether operators prepared it ahead (a prepared question reaches the room as
-- an ordinary anonymous one, so only this record tells them apart), and the
-- account of the credited person it was addressed to, if any. Questions that
-- were prepared but never released stay in the room and are not copied.
-- Both columns are additive: existing rows read as asked, for everyone.
ALTER TABLE event_session_questions ADD COLUMN prepared INTEGER NOT NULL DEFAULT 0 CHECK(prepared IN (0,1));
ALTER TABLE event_session_questions ADD COLUMN addressed_to_user_id TEXT REFERENCES users(id);
