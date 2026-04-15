-- ── Donation promoter share links ─────────────────────────────────────────────
--
-- Each row represents a personalized shareable link that points to /donate/.
-- A donor receives one after a successful donation; admins may also create
-- non-donor "advocate" links (donation_id IS NULL) for members or sponsors
-- who want to promote the donation page without having donated themselves.
--
-- Attribution: when a visitor arrives via /donate/r/:code and subsequently
-- donates, the checkout flow stores the code in donations.source so that
-- donations can be attributed back to the promoter.

CREATE TABLE donation_promoters (
  code                TEXT    NOT NULL PRIMARY KEY CHECK (length(code) BETWEEN 6 AND 12),
  donation_id         TEXT,   -- NULL for non-donor/advocate links
  checkout_session_id TEXT,   -- cached for OG badge image lookup (no extra JOIN)
  name                TEXT,   -- display name shown in admin; defaults to donor's first name
  clicks              INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL,
  FOREIGN KEY(donation_id) REFERENCES donations(id)
);

CREATE INDEX idx_donation_promoters_donation ON donation_promoters(donation_id);
