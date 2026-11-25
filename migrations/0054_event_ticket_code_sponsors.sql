-- A code can belong to a sponsor: a member organization, or a sponsorship
-- with no member organization behind it. Consortium sponsors are not tied to
-- one event, so a sponsor's pass codes are unique per event and kind.
ALTER TABLE event_ticket_codes ADD COLUMN organization_id TEXT REFERENCES organizations(id);

-- One pass code of each kind per organization and event takes the organization: the
-- earliest one still usable, else the earliest. Another one, from a second sponsorship
-- of the same organization, keeps only its sponsorship and stays valid, so the unique
-- index below always holds.
UPDATE event_ticket_codes
SET organization_id = (SELECT sponsor.organization_id FROM sponsorships sponsor WHERE sponsor.id = event_ticket_codes.sponsorship_id)
WHERE sponsorship_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM event_ticket_codes earlier
    JOIN sponsorships mine ON mine.id = event_ticket_codes.sponsorship_id
    JOIN sponsorships theirs ON theirs.id = earlier.sponsorship_id
    WHERE event_ticket_codes.pass_kind IS NOT NULL AND earlier.pass_kind = event_ticket_codes.pass_kind
      AND earlier.event_id = event_ticket_codes.event_id AND theirs.organization_id = mine.organization_id
      AND ((earlier.revoked_at IS NULL AND event_ticket_codes.revoked_at IS NOT NULL)
           OR ((earlier.revoked_at IS NULL) = (event_ticket_codes.revoked_at IS NULL)
               AND (earlier.created_at < event_ticket_codes.created_at
                    OR (earlier.created_at = event_ticket_codes.created_at AND earlier.id < event_ticket_codes.id)))));

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
  -- The ticket the organization gets at every event that offers this key.
  -- Tuning the ticket's description keeps the decision; created_at and the
  -- audit log tell which description it was made under.
  ticket_key          TEXT NOT NULL,
  confidence          REAL,
  -- 'classifier' or 'organizer'. An organizer's decision is never replaced by a classifier's.
  source              TEXT NOT NULL,
  -- The model that answered, as configured when it did.
  model               TEXT,
  decided_by_user_id  TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (organization_id, ticket_key)
);
