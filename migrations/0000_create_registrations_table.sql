CREATE TABLE registrations (
  user_id TEXT,
  session_title TEXT,
  time_slot TEXT,
  PRIMARY KEY (user_id, time_slot)
);
