-- Keep immutable scan attempts while allowing an operator or sponsor contact to withdraw captured leads.
CREATE TABLE event_sponsor_lead_removed_attempts (
  attempt_id TEXT PRIMARY KEY REFERENCES event_scan_attempts(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES event_sponsor_leads(id) ON DELETE CASCADE,
  removal_id TEXT NOT NULL,
  removed_by_user_id TEXT NOT NULL REFERENCES users(id),
  removed_at TEXT NOT NULL
);
CREATE INDEX event_sponsor_lead_removed_attempts_lead ON event_sponsor_lead_removed_attempts(lead_id, removal_id);
