-- Migration 0003: Donation records for tax reporting
--
-- Stores every completed Stripe donation with:
--   - Gross amount donor paid (in smallest currency unit)
--   - Net amount received after Stripe fees
--   - Donor identity for tax/accounting purposes
--   - Stripe session/payment-intent IDs for reconciliation
--
-- Populated by the Stripe webhook (checkout.session.completed).
-- Stripe Dashboard remains the authoritative record; this table
-- is the internal tax-reporting and badge-generation cache.

CREATE TABLE IF NOT EXISTS donations (
  id                  TEXT PRIMARY KEY,          -- crypto.randomUUID()
  checkout_session_id   TEXT NOT NULL UNIQUE,    -- processor checkout session (e.g. cs_live_… for Stripe)
  payment_intent_id     TEXT,                    -- processor payment intent (nullable until webhook fires)

  -- Donor identity
  donor_name          TEXT NOT NULL,
  donor_email         TEXT NOT NULL,
  donor_organization  TEXT,                      -- nullable

  -- Amounts (smallest currency unit, e.g. cents for USD)
  currency            TEXT NOT NULL,             -- iso 4217 lowercase
  gross_amount        INTEGER NOT NULL,          -- what the donor paid
  net_amount          INTEGER,                   -- gross minus Stripe fee (set on webhook)

  -- Attribution
  source              TEXT,

  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  completed_at        TEXT                       -- set when webhook confirms payment
);

CREATE INDEX IF NOT EXISTS idx_donations_donor_email  ON donations (donor_email);
CREATE INDEX IF NOT EXISTS idx_donations_source       ON donations (source);
CREATE INDEX IF NOT EXISTS idx_donations_created_at   ON donations (created_at);
