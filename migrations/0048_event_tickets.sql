-- Event tickets: what a registration costs, who gets which ticket, and its payment.
--
-- Additive only. A registration keeps its lifecycle; its ticket carries the
-- price and the payment state. Statuses and sources are an evolvable product
-- vocabulary validated by the shared domain module, not by CHECK constraints.

-- One row per event that sells tickets: its currency and how unpaid tickets are chased.
CREATE TABLE event_ticket_settings (
  event_id               TEXT    NOT NULL PRIMARY KEY REFERENCES events(id),
  currency               TEXT    NOT NULL CHECK (length(currency) = 3 AND currency = lower(currency)),
  reminder_interval_days INTEGER NOT NULL CHECK (reminder_interval_days > 0),
  reminder_period_days   INTEGER NOT NULL CHECK (reminder_period_days >= 0),
  -- Whether the payment provider issues an invoice for each paid ticket, besides its receipt.
  send_invoice           INTEGER NOT NULL DEFAULT 1 CHECK (send_invoice IN (0, 1)),
  -- The refund policy: empty for no refunds, otherwise refunds until this many days before the event starts.
  refund_days_before_event INTEGER CHECK (refund_days_before_event IS NULL OR refund_days_before_event >= 0),
  -- Optional text shown to registrants above the tickets and above the days.
  ticket_intro           TEXT,
  attendance_intro       TEXT,
  -- The tickets a sponsor's passes give: one for its staff, one for the customers it invites.
  sponsor_staff_ticket_type_id    TEXT,
  sponsor_customer_ticket_type_id TEXT,
  -- Advances with every change to the event's tickets, prices, or these settings.
  revision               INTEGER NOT NULL DEFAULT 0,
  updated_at             TEXT    NOT NULL
);

CREATE TABLE event_ticket_types (
  id                       TEXT    NOT NULL PRIMARY KEY,
  event_id                 TEXT    NOT NULL REFERENCES events(id),
  -- Stable across events ("pqcc_vendor"): a stored classifier decision is reused by key.
  ticket_key               TEXT    NOT NULL,
  name                     TEXT    NOT NULL,
  description_markdown     TEXT    NOT NULL DEFAULT '',
  -- Who qualifies, as the classifier is asked. NULL keeps the ticket out of automatic assignment.
  classifier_description   TEXT,
  classifier_threshold     REAL    NOT NULL DEFAULT 0.85 CHECK (classifier_threshold > 0 AND classifier_threshold <= 1),
  -- The ticket given when nothing else decides. At most one per event.
  is_default               INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  free_requires_work_email INTEGER NOT NULL DEFAULT 0 CHECK (free_requires_work_email IN (0, 1)),
  sort_order               INTEGER NOT NULL DEFAULT 0,
  active                   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at               TEXT    NOT NULL,
  updated_at               TEXT    NOT NULL,
  UNIQUE (event_id, ticket_key)
);
CREATE UNIQUE INDEX uq_event_ticket_types_default ON event_ticket_types(event_id) WHERE is_default = 1;

-- Price periods are shared by every ticket of an event. The opening period has no date.
CREATE TABLE event_ticket_price_periods (
  id        TEXT NOT NULL PRIMARY KEY,
  event_id  TEXT NOT NULL REFERENCES events(id),
  -- Calendar date in the event's zone; the change starts at that day's midnight.
  starts_on TEXT CHECK (starts_on IS NULL OR starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
CREATE UNIQUE INDEX uq_event_ticket_price_periods ON event_ticket_price_periods(event_id, IFNULL(starts_on, ''));

-- A price belongs to a ticket and a way of attending, for every day or for one day.
CREATE TABLE event_ticket_prices (
  id               TEXT NOT NULL PRIMARY KEY,
  ticket_type_id   TEXT NOT NULL REFERENCES event_ticket_types(id) ON DELETE CASCADE,
  attendance_value TEXT NOT NULL,
  day_date         TEXT CHECK (day_date IS NULL OR day_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  charged          TEXT NOT NULL DEFAULT 'once'
);
CREATE UNIQUE INDEX uq_event_ticket_prices ON event_ticket_prices(ticket_type_id, attendance_value, IFNULL(day_date, ''));

CREATE TABLE event_ticket_price_amounts (
  price_id  TEXT    NOT NULL REFERENCES event_ticket_prices(id) ON DELETE CASCADE,
  period_id TEXT    NOT NULL REFERENCES event_ticket_price_periods(id) ON DELETE CASCADE,
  amount    INTEGER NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (price_id, period_id)
);

-- A code names its ticket and sets a fixed price or a percentage off, for a limited number of uses.
CREATE TABLE event_ticket_codes (
  id             TEXT    NOT NULL PRIMARY KEY,
  event_id       TEXT    NOT NULL REFERENCES events(id),
  ticket_type_id TEXT    NOT NULL REFERENCES event_ticket_types(id),
  label          TEXT    NOT NULL,
  -- Uppercase, without separators. A code is a shared pass, not a credential.
  code           TEXT    NOT NULL,
  amount         INTEGER CHECK (amount IS NULL OR amount >= 0),
  percent_off    INTEGER CHECK (percent_off IS NULL OR (percent_off BETWEEN 1 AND 100)),
  max_uses       INTEGER NOT NULL CHECK (max_uses > 0),
  used_count     INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  revoked_at     TEXT,
  -- Set on a sponsor's pass code: the sponsorship it belongs to and whether it is for staff or customers.
  sponsorship_id TEXT REFERENCES sponsorships(id),
  pass_kind      TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  CHECK ((amount IS NULL) <> (percent_off IS NULL)),
  CHECK (used_count <= max_uses),
  UNIQUE (event_id, code)
);

-- How many passes a sponsor of each tier gets. A sponsor's two codes are made from these.
CREATE TABLE event_ticket_sponsor_passes (
  event_id        TEXT    NOT NULL REFERENCES events(id),
  tier_name       TEXT    NOT NULL,
  staff_passes    INTEGER NOT NULL DEFAULT 0 CHECK (staff_passes >= 0),
  customer_passes INTEGER NOT NULL DEFAULT 0 CHECK (customer_passes >= 0),
  PRIMARY KEY (event_id, tier_name)
);

CREATE UNIQUE INDEX uq_event_ticket_codes_sponsor_pass ON event_ticket_codes(sponsorship_id, pass_kind)
  WHERE sponsorship_id IS NOT NULL;

-- One decision per organization name and email domain for one classifier question.
-- `criteria` is the canonical form of the question (ticket keys and their
-- descriptions), so another event that asks the same question reuses the answer.
CREATE TABLE ticket_classifier_decisions (
  id                  TEXT NOT NULL PRIMARY KEY,
  organization_name   TEXT NOT NULL,
  email_domain        TEXT NOT NULL,
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
  UNIQUE (criteria_sha256, organization_name, email_domain)
);

-- What a signed-in person picked before registering: a ticket where one may be
-- chosen, a code, or a dispute. The registration reads it and deletes it.
CREATE TABLE event_ticket_selections (
  event_id       TEXT NOT NULL REFERENCES events(id),
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_type_id TEXT REFERENCES event_ticket_types(id) ON DELETE CASCADE,
  code_id        TEXT REFERENCES event_ticket_codes(id) ON DELETE CASCADE,
  dispute_reason TEXT,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

-- A registration a signed-in person started and has not finished. They are
-- reminded a fixed number of times, and can say that they will not register.
CREATE TABLE unfinished_registrations (
  event_id         TEXT    NOT NULL REFERENCES events(id),
  user_id          TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at       TEXT    NOT NULL,
  reminders_sent   INTEGER NOT NULL DEFAULT 0,
  next_reminder_at TEXT,
  -- Set when the person says they will not register; the reason is theirs to give.
  stopped_at       TEXT,
  stop_reason      TEXT,
  stop_note        TEXT,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX idx_unfinished_registrations_due ON unfinished_registrations(next_reminder_at)
  WHERE next_reminder_at IS NOT NULL;

-- The ticket a registration holds. Its amount is fixed when it is issued.
CREATE TABLE registration_tickets (
  id                    TEXT    NOT NULL PRIMARY KEY,
  registration_id       TEXT    NOT NULL UNIQUE REFERENCES registrations(id) ON DELETE CASCADE,
  event_id              TEXT    NOT NULL REFERENCES events(id),
  ticket_type_id        TEXT    NOT NULL REFERENCES event_ticket_types(id),
  assignment_source     TEXT    NOT NULL,
  code_id               TEXT    REFERENCES event_ticket_codes(id),
  amount                INTEGER NOT NULL CHECK (amount >= 0),
  currency              TEXT    NOT NULL CHECK (length(currency) = 3 AND currency = lower(currency)),
  status                TEXT    NOT NULL,
  -- Set when the person chose another ticket than the one decided for their organization.
  dispute_reason        TEXT,
  dispute_resolved_at   TEXT,
  -- The confirmation email held until the ticket is settled.
  held_email_id         TEXT,
  reminders_sent        INTEGER NOT NULL DEFAULT 0,
  next_reminder_at      TEXT,
  reminders_end_at      TEXT,
  paid_at               TEXT,
  -- The payment that settled the ticket: what it was for, and how much of it the provider has returned.
  -- `amount` is what the ticket costs for its days now; after a move to cheaper days it is less than was paid.
  payment_intent_id     TEXT,
  paid_amount           INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  refunded_amount       INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  -- The provider's time of the newest refund fact applied; an older one that arrives later is not applied over it.
  refunds_seen_at       TEXT,
  -- Set when a refund failed: what was returned is then read again from the provider, not worked out here.
  refund_reconcile_at   TEXT,
  revision              INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL,
  updated_at            TEXT    NOT NULL
);
CREATE INDEX idx_registration_tickets_event_status ON registration_tickets(event_id, status, created_at, id);
CREATE INDEX idx_registration_tickets_reminders ON registration_tickets(next_reminder_at)
  WHERE status = 'pending_payment' AND next_reminder_at IS NOT NULL;
CREATE INDEX idx_registration_tickets_refund_reconcile ON registration_tickets(refund_reconcile_at)
  WHERE refund_reconcile_at IS NOT NULL;

-- One row per Checkout Session requested for a ticket; its id is the provider idempotency key.
CREATE TABLE registration_ticket_checkouts (
  id                  TEXT NOT NULL PRIMARY KEY,
  ticket_id           TEXT NOT NULL REFERENCES registration_tickets(id) ON DELETE CASCADE,
  request_params      TEXT,
  provider_session_id TEXT UNIQUE,
  checkout_url        TEXT,
  payment_intent_id   TEXT UNIQUE,
  created_at          TEXT NOT NULL,
  expires_at          TEXT NOT NULL
);
CREATE INDEX idx_registration_ticket_checkouts_ticket ON registration_ticket_checkouts(ticket_id, created_at, id);

CREATE TABLE registration_ticket_payment_events (
  provider_event_id TEXT NOT NULL PRIMARY KEY,
  ticket_id         TEXT NOT NULL REFERENCES registration_tickets(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,
  outcome           TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

-- Durable refunds, one per payment being returned; the row id is the provider idempotency key and the job is the
-- only retry owner. Sent to the provider (submitted), confirmed by it (completed) and refused (failed) are apart:
-- a refund the provider accepted can still fail later, and a failed one can be asked for again.
CREATE TABLE registration_ticket_refunds (
  id                   TEXT    NOT NULL PRIMARY KEY,
  ticket_id            TEXT    NOT NULL REFERENCES registration_tickets(id) ON DELETE CASCADE,
  payment_intent_id    TEXT,
  amount               INTEGER NOT NULL CHECK (amount > 0),
  reason               TEXT    NOT NULL,
  -- Empty for a payment returned without an organizer asking: one that arrived for a ticket that no longer needed it.
  requested_by_user_id TEXT    REFERENCES users(id),
  provider_refund_id   TEXT    UNIQUE,
  attempts             INTEGER NOT NULL DEFAULT 0,
  next_attempt_at      TEXT    NOT NULL,
  lease_token          TEXT,
  lease_expires_at     TEXT,
  submitted_at         TEXT,
  completed_at         TEXT,
  failed_at            TEXT,
  last_error           TEXT,
  created_at           TEXT    NOT NULL
);
CREATE INDEX idx_registration_ticket_refunds_due ON registration_ticket_refunds(next_attempt_at)
  WHERE submitted_at IS NULL AND failed_at IS NULL;
CREATE INDEX idx_registration_ticket_refunds_ticket ON registration_ticket_refunds(ticket_id, created_at, id);

INSERT INTO scheduled_jobs (job_key, interval_seconds, next_run_at) VALUES
  ('event_ticket_payments', 300, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('unfinished_registrations', 900, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
