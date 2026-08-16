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
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(sponsor_type, tier)
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
