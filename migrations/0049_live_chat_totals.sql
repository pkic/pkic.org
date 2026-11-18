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
