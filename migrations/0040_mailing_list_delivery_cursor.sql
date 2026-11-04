-- One durable progress cursor for the scheduled mailing-list delivery sweep.
-- A revision fences stale concurrent progress updates; the scheduled job owns retries.
CREATE TABLE mailing_list_delivery_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  list_email TEXT NOT NULL,
  address_email TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
