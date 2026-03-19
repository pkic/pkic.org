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
--
-- !! DATA RETENTION WARNING !!
-- Donor PII (name, email, organization — renamed in migration 0004) and financial fields
-- (gross_amount, net_amount, currency) MUST be retained for a minimum of 7 years
-- from the date of the donation to satisfy US IRS record-keeping requirements
-- (IRC §6001 / Publication 4221-NC for 501(c)(6) organizations).
-- These rows MUST NOT be purged, anonymized, or redacted by any retention job.
-- Do not add this table to the retention_policies system.

CREATE TABLE IF NOT EXISTS donations (
  id                  TEXT PRIMARY KEY,          -- crypto.randomUUID()
  checkout_session_id   TEXT NOT NULL UNIQUE,    -- processor checkout session (e.g. cs_live_… for Stripe)
  payment_intent_id     TEXT,                    -- processor payment intent (nullable until webhook fires)

  -- Donor identity (columns renamed to name/email/organization in migration 0004)
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

CREATE INDEX IF NOT EXISTS idx_donations_donor_email  ON donations (donor_email); -- renamed to idx_donations_email in migration 0004
CREATE INDEX IF NOT EXISTS idx_donations_source       ON donations (source);
CREATE INDEX IF NOT EXISTS idx_donations_created_at   ON donations (created_at);
