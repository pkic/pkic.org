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
