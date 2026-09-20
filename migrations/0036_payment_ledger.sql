-- Shared payment ledger and immutable payment-event history.
--
-- Domain tables continue to own their workflows. The ledger provides one
-- financial lifecycle across donations, membership fees, sponsorships, and
-- future event payments without making those workflows depend on each other.

CREATE TABLE payment_ledger_entries (
  id TEXT NOT NULL PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('donation', 'membership', 'sponsorship', 'event')),
  resource_type TEXT,
  resource_id TEXT,
  provider TEXT CHECK (provider IS NULL OR provider IN ('stripe', 'offline')),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'processing', 'paid', 'failed', 'expired', 'refunded', 'disputed', 'cancelled', 'requires_review')
  ),
  amount INTEGER CHECK (amount IS NULL OR amount >= 0),
  currency TEXT CHECK (currency IS NULL OR (length(currency) = 3 AND currency = lower(currency))),
  provider_checkout_session_id TEXT,
  provider_payment_intent_id TEXT,
  provider_invoice_id TEXT,
  provider_subscription_id TEXT,
  payment_method TEXT,
  latest_provider_event_created INTEGER,
  latest_provider_event_id TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_payment_ledger_provider_checkout
  ON payment_ledger_entries(provider, provider_checkout_session_id)
  WHERE provider IS NOT NULL AND provider_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX uq_payment_ledger_provider_intent
  ON payment_ledger_entries(provider, provider_payment_intent_id)
  WHERE provider IS NOT NULL AND provider_payment_intent_id IS NOT NULL;
CREATE INDEX idx_payment_ledger_resource
  ON payment_ledger_entries(purpose, resource_type, resource_id, created_at DESC);
CREATE INDEX idx_payment_ledger_status
  ON payment_ledger_entries(status, updated_at DESC, id);

CREATE TABLE payment_ledger_events (
  id TEXT NOT NULL PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payment_ledger_entries(id),
  source TEXT NOT NULL CHECK (source IN ('stripe', 'staff', 'system')),
  external_event_id TEXT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  domain_outcome TEXT,
  actor_user_id TEXT REFERENCES users(id),
  payment_method TEXT,
  amount INTEGER CHECK (amount IS NULL OR amount >= 0),
  currency TEXT CHECK (currency IS NULL OR (length(currency) = 3 AND currency = lower(currency))),
  reference TEXT,
  note TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_payment_ledger_external_event
  ON payment_ledger_events(source, external_event_id)
  WHERE external_event_id IS NOT NULL;
CREATE INDEX idx_payment_ledger_events_payment
  ON payment_ledger_events(payment_id, occurred_at DESC, id);

-- Preserve the payment records that existed before the shared ledger. These
-- system events describe the migration snapshot; provider webhooks continue
-- the same entries because the service resolves by resource and provider IDs.
INSERT INTO payment_ledger_entries
  (id, purpose, resource_type, resource_id, provider, status, amount, currency,
   provider_checkout_session_id, provider_payment_intent_id, payment_method, paid_at, created_at, updated_at)
SELECT
  'payment:donation:' || id, 'donation', 'donation', id, 'stripe',
  CASE status
    WHEN 'completed' THEN 'paid'
    WHEN 'awaiting_payment' THEN 'processing'
    WHEN 'failed' THEN 'failed'
    WHEN 'expired' THEN 'expired'
    ELSE 'pending'
  END,
  gross_amount, lower(currency), checkout_session_id, payment_intent_id, payment_method_type, completed_at, created_at,
  COALESCE(completed_at, created_at)
FROM donations;

INSERT INTO payment_ledger_entries
  (id, purpose, resource_type, resource_id, provider, status, amount, currency,
   provider_checkout_session_id, provider_payment_intent_id, paid_at, created_at, updated_at)
SELECT
  'payment:membership:' || fee.id, 'membership', 'membership_fee', fee.id,
  CASE WHEN fee.checkout_session_id IS NOT NULL OR fee.payment_intent_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM membership_fee_checkouts checkout
    WHERE checkout.fee_id = fee.id AND checkout.provider_session_id IS NOT NULL
  ) THEN 'stripe' ELSE NULL END,
  CASE
    WHEN fee.status = 'paid' THEN 'paid'
    WHEN fee.status = 'failed' THEN 'failed'
    WHEN fee.status = 'expired' THEN 'expired'
    ELSE 'pending'
  END,
  fee.amount, lower(fee.currency),
  COALESCE(
    fee.checkout_session_id,
    (SELECT checkout.provider_session_id FROM membership_fee_checkouts checkout
      WHERE checkout.fee_id = fee.id AND checkout.provider_session_id IS NOT NULL
      ORDER BY checkout.created_at DESC, checkout.id DESC LIMIT 1)
  ),
  fee.payment_intent_id, fee.paid_at, fee.created_at, fee.updated_at
FROM membership_fee_intents fee;

INSERT INTO payment_ledger_entries
  (id, purpose, resource_type, resource_id, provider, status, amount, currency,
   provider_checkout_session_id, paid_at, created_at, updated_at)
SELECT
  'payment:sponsorship:' || id, 'sponsorship', 'sponsorship', id, 'stripe', 'paid',
  price_amount_cents, lower(price_currency), checkout_session_id, created_at, created_at, updated_at
FROM sponsorships
WHERE checkout_session_id IS NOT NULL AND price_amount_cents IS NOT NULL AND price_currency IS NOT NULL;

INSERT INTO payment_ledger_events
  (id, payment_id, source, external_event_id, event_type, from_status, to_status,
   domain_outcome, occurred_at, created_at)
SELECT
  'payment-event:backfill:' || id, id, 'system', NULL, 'migration.backfill', NULL, status,
  'existing_record', updated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM payment_ledger_entries;
