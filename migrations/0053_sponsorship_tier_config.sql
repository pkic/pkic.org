-- Canonical, data-backed display order for public sponsorship surfaces.
-- Keeping this vocabulary in D1 avoids hard-coded tier maps in browser code
-- and lets new tiers be introduced without changing every client.
CREATE TABLE sponsorship_tier_catalog (
  sponsor_type   TEXT NOT NULL,
  tier           TEXT NOT NULL,
  -- Validated by the shared API/application schema. Do not encode a narrow
  -- range as a D1 CHECK: SQLite cannot alter it when the presentation model
  -- evolves without rebuilding and backfilling the table.
  display_weight INTEGER NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (sponsor_type, tier)
);

INSERT INTO sponsorship_tier_catalog (sponsor_type, tier, display_weight, active, created_at, updated_at) VALUES
  ('consortium', 'Bronze',      1, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('consortium', 'Silver',      2, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('consortium', 'Gold',        3, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('consortium', 'Platinum',    4, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('consortium', 'Titanium',    5, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('consortium', 'Diamond',     6, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('event',      'Ambassador',  1, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('event',      'Innovator',   2, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('event',      'Inspirator',  3, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('event',      'Leader',      4, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Moves sponsorship tier pricing out of code
-- (EVENT_SPONSOR_TIER_PRICES_USD_CENTS) into managed D1 config, so a price
-- change doesn't require a deployment and code/UI/payment configuration
-- can't diverge (PR #1 review: "Launch pricing and tier availability are
-- business policy, not immutable code constants"). Scoped to
-- sponsor_type='event' — the Path B self-service Stripe checkout this
-- feeds; consortium tiers remain negotiated annual contracts (see
-- sponsorship.ts's original comment), not self-service, so out of scope.
CREATE TABLE sponsorship_tier_config (
  id           TEXT NOT NULL PRIMARY KEY,
  sponsor_type TEXT NOT NULL,
  tier         TEXT NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'usd',
  amount_cents INTEGER NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(sponsor_type, tier),
  FOREIGN KEY (sponsor_type, tier) REFERENCES sponsorship_tier_catalog(sponsor_type, tier)
);

-- Seed with the exact figures EVENT_SPONSOR_TIER_PRICES_USD_CENTS already
-- used (still placeholders pending finance confirmation, per the constant's
-- original comment) — this migration is a pure storage move, not a price
-- change.
INSERT INTO sponsorship_tier_config (id, sponsor_type, tier, currency, amount_cents, active, created_at, updated_at) VALUES
  (lower(hex(randomblob(16))), 'event', 'Ambassador', 'usd', 500000,  1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'event', 'Innovator',  'usd', 1000000, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'event', 'Inspirator', 'usd', 2000000, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'event', 'Leader',     'usd', 3500000, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- sponsorships.price_amount_cents/price_currency (the price snapshot this
-- config feeds) are defined directly in migration 0036's initial
-- sponsorships table, not added here.
