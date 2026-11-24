-- A code can belong to a sponsor: a member organization, or a sponsorship
-- with no member organization behind it. Consortium sponsors are not tied to
-- one event, so a sponsor's pass codes are unique per event and kind.
ALTER TABLE event_ticket_codes ADD COLUMN organization_id TEXT REFERENCES organizations(id);

UPDATE event_ticket_codes
SET organization_id = (SELECT sponsor.organization_id FROM sponsorships sponsor WHERE sponsor.id = event_ticket_codes.sponsorship_id)
WHERE sponsorship_id IS NOT NULL;

DROP INDEX uq_event_ticket_codes_sponsor_pass;

CREATE UNIQUE INDEX uq_event_ticket_codes_organization_pass
  ON event_ticket_codes(event_id, organization_id, pass_kind)
  WHERE organization_id IS NOT NULL AND pass_kind IS NOT NULL;

CREATE UNIQUE INDEX uq_event_ticket_codes_sponsorship_pass
  ON event_ticket_codes(event_id, sponsorship_id, pass_kind)
  WHERE organization_id IS NULL AND sponsorship_id IS NOT NULL AND pass_kind IS NOT NULL;

CREATE INDEX idx_event_ticket_codes_organization ON event_ticket_codes(event_id, organization_id)
  WHERE organization_id IS NOT NULL;

-- What each code brought in: the tickets issued with it.
CREATE INDEX idx_registration_tickets_code ON registration_tickets(code_id, status) WHERE code_id IS NOT NULL;

-- A ticket decision belongs to a portal organization, which keeps its own name
-- and domains; the decision holds no copy of either. The table it replaces
-- held no rows on preview or production when this migration was written.
DROP TABLE ticket_classifier_decisions;

CREATE TABLE ticket_organization_decisions (
  id                  TEXT NOT NULL PRIMARY KEY,
  organization_id     TEXT NOT NULL REFERENCES organizations(id),
  -- The canonical question (ticket keys and their descriptions), so another
  -- event that asks the same question reuses the answer.
  criteria_sha256     TEXT NOT NULL,
  ticket_key          TEXT NOT NULL,
  confidence          REAL,
  -- 'classifier' or 'organizer'. An organizer's decision is never replaced by a classifier's.
  source              TEXT NOT NULL,
  -- The model that answered, as configured when it did.
  model               TEXT,
  decided_by_user_id  TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (criteria_sha256, organization_id)
);

CREATE INDEX idx_ticket_organization_decisions_organization
  ON ticket_organization_decisions(organization_id, ticket_key);
