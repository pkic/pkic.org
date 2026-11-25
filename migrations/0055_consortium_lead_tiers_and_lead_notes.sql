-- Consortium sponsors have no event of their own. An event lets the consortium
-- tiers listed here capture leads at it; each such consortium sponsorship then
-- scans for itself, keyed by its own sponsorship id, unless its organization
-- also sponsors the event directly. The tier is checked against the active
-- consortium tier catalog on every write, so the vocabulary stays evolvable.
CREATE TABLE event_consortium_lead_tiers (
  event_id   TEXT NOT NULL REFERENCES events(id),
  tier       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, tier)
);

-- Sponsorship-wide lookups ask whether a tier captures at any event.
CREATE INDEX event_consortium_lead_tiers_tier ON event_consortium_lead_tiers(tier, event_id);

-- The sponsor team's one shared note about a lead. It lives and is removed with
-- the lead row, so retention purges, capture removal and account deletion cover
-- it. Withdrawn consent hides the lead and its note, as it hides the lead itself.
ALTER TABLE event_sponsor_leads ADD COLUMN note TEXT;
ALTER TABLE event_sponsor_leads ADD COLUMN note_updated_at TEXT;

-- Event pages find the sponsorships whose contact mailbox is the viewer's own
-- without reading every sponsorship.
CREATE INDEX idx_sponsorships_contact_mailbox ON sponsorships(lower(trim(contact_email)))
  WHERE contact_email IS NOT NULL;
