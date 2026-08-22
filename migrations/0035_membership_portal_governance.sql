-- Consolidated migration 0035: Membership portal, governance, and sponsorship architecture
--
-- This is the single authoritative migration for the membership-portal work.
-- The component migrations were never applied to preview or production, so
-- their final schemas, required legacy-data conversions, indexes, and seed data
-- are kept together here. Legacy members and organizations are extended only
-- with additive columns/relationship tables; neither table is rebuilt.

-- Section: Membership category reference table
--
-- The A-G/H1-H8 category list is already centralized in code
-- (assets/shared/schemas/membership-categories.ts) and imported everywhere
-- it's used. This adds a `membership_categories` reference table so
-- category codes are a real DB-enforced vocabulary via FK — not a CHECK
-- constraint (categories are an evolvable product vocabulary, not a durable
-- structural invariant) and not a bare TEXT column (PR #1 review).
--
-- Created first, before any dependent table, so every later table that
-- references a category code (member_applications, member_category_
-- assignments) can declare the FK in its own initial CREATE TABLE — no
-- rebuild required anywhere in this schema.

-- Admin, member, and MCP OAuth magic links share auth_magic_links. Bind every
-- newly issued link to one verifier context so a user eligible for multiple
-- surfaces cannot exchange one flow's token through another. This remains an
-- open TEXT vocabulary rather than a CHECK constraint so adding another auth
-- flow never requires rebuilding the table. Existing NULL-purpose links fail
-- closed in the application and naturally expire.
ALTER TABLE auth_magic_links ADD COLUMN purpose TEXT;

CREATE TABLE membership_categories (
  code         TEXT NOT NULL PRIMARY KEY,
  is_individual INTEGER NOT NULL DEFAULT 0 CHECK (is_individual IN (0, 1)),
  -- org-less categories (H5/H6/H7) — mirrors INDIVIDUAL_MEMBERSHIP_CATEGORIES
  is_voting     INTEGER NOT NULL DEFAULT 0 CHECK (is_voting IN (0, 1))
  -- forum + WG voting rights (A-G only) — mirrors VOTING_CATEGORIES
);

INSERT INTO membership_categories (code, is_individual, is_voting) VALUES
  ('A', 0, 1),
  ('B', 0, 1),
  ('C', 0, 1),
  ('D', 0, 1),
  ('E', 0, 1),
  ('F', 0, 1),
  ('G', 0, 1),
  ('H1', 0, 0),
  ('H2', 0, 0),
  ('H3', 0, 0),
  ('H4', 0, 0),
  ('H5', 1, 0),
  ('H6', 1, 0),
  ('H7', 1, 0),
  ('H8', 0, 0);

-- Engagement is part of several aggregate transactions. Retried or concurrent
-- requests must not award the same domain action more than once. A nullable
-- application-supplied key keeps repeatable actions possible while giving
-- one-shot actions a durable, shared idempotency primitive.
ALTER TABLE engagement_events ADD COLUMN idempotency_key TEXT;

UPDATE engagement_events
SET idempotency_key = action_type || ':' || source_type || ':' || source_ref
WHERE source_type IS NOT NULL
  AND source_ref IS NOT NULL
  AND action_type IN ('invite_accepted', 'registration_created', 'registration_confirmed', 'proposal_submitted')
  AND id IN (
    SELECT MIN(id)
    FROM engagement_events
    WHERE source_type IS NOT NULL
      AND source_ref IS NOT NULL
      AND action_type IN ('invite_accepted', 'registration_created', 'registration_confirmed', 'proposal_submitted')
    GROUP BY action_type, source_type, source_ref
  );

CREATE UNIQUE INDEX uq_engagement_events_idempotency_key
  ON engagement_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- The audit record for a one-shot operation must be as retry-safe as the
-- state transition it describes. Most audit entries remain append-only and
-- omit this key; transactional workflows can opt into exactly-once logging.
ALTER TABLE audit_log ADD COLUMN idempotency_key TEXT;
-- Child records can be deleted while their audit history must remain visible
-- from the owning aggregate. Store that immutable read scope on the audit row
-- instead of reconstructing it by joining mutable/live child tables.
ALTER TABLE audit_log ADD COLUMN scope_type TEXT;
ALTER TABLE audit_log ADD COLUMN scope_id TEXT;

CREATE UNIQUE INDEX uq_audit_log_idempotency_key
  ON audit_log(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_audit_log_scope
  ON audit_log(scope_type, scope_id, created_at DESC, id);

-- Domain retries must not enqueue duplicate external side effects. Callers
-- that can identify a one-shot notification provide this nullable key and a
-- deterministic outbox id; ordinary repeatable/campaign email remains
-- append-only by omitting it.
ALTER TABLE email_outbox ADD COLUMN idempotency_key TEXT;
ALTER TABLE email_outbox ADD COLUMN processing_token TEXT;
ALTER TABLE email_outbox ADD COLUMN lease_expires_at TEXT;

CREATE UNIQUE INDEX uq_email_outbox_idempotency_key
  ON email_outbox(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP INDEX IF EXISTS idx_email_outbox_processing;
CREATE INDEX idx_email_outbox_due
  ON email_outbox(send_after, created_at, id)
  WHERE status IN ('queued', 'retrying');
CREATE INDEX idx_email_outbox_expired_lease
  ON email_outbox(lease_expires_at, created_at, id)
  WHERE status = 'sending';

-- Identifies the logical co-speaker invitation attempt. Re-inviting a
-- declined speaker advances the generation, while concurrent/retried writes
-- for the same generation share one outbox idempotency key.
ALTER TABLE proposal_speakers ADD COLUMN invite_generation INTEGER NOT NULL DEFAULT 0;

-- Invite acceptance, decline, and manual resend are aggregate transitions:
-- their state change and any engagement, unsubscribe, email, or audit fallout
-- must be based on the same snapshot. A revision guard makes a stale D1 batch
-- abort before any of those statements can commit.
ALTER TABLE invites ADD COLUMN transition_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE invite_transition_guards (
  id                TEXT NOT NULL PRIMARY KEY,
  invite_id         TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  FOREIGN KEY(invite_id) REFERENCES invites(id) ON DELETE CASCADE
);

CREATE TRIGGER trg_invite_transition_guard_validate
BEFORE INSERT ON invite_transition_guards
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT transition_revision FROM invites WHERE id = NEW.invite_id), -1)
         <> NEW.expected_revision
    THEN RAISE(ABORT, 'INVITE_CHANGED')
  END;
END;

CREATE TRIGGER trg_invite_transition_guard_advance
AFTER INSERT ON invite_transition_guards
FOR EACH ROW
BEGIN
  UPDATE invites
  SET transition_revision = transition_revision + 1
  WHERE id = NEW.invite_id;
  DELETE FROM invite_transition_guards WHERE id = NEW.id;
END;

CREATE TRIGGER trg_invite_transition_revision
AFTER UPDATE ON invites
FOR EACH ROW
WHEN OLD.status IS NOT NEW.status
  OR OLD.decline_reason_code IS NOT NEW.decline_reason_code
  OR OLD.decline_reason_note IS NOT NEW.decline_reason_note
  OR OLD.unsubscribe_future IS NOT NEW.unsubscribe_future
  OR OLD.accepted_at IS NOT NEW.accepted_at
  OR OLD.declined_at IS NOT NEW.declined_at
  OR OLD.link_secret IS NOT NEW.link_secret
BEGIN
  UPDATE invites
  SET transition_revision = transition_revision + 1
  WHERE id = NEW.id;
END;

-- Public invitation-link recovery is bounded and ordered by recency. Keep the
-- lookup on normalized email/status inside D1 instead of scanning invitations
-- in Worker memory.
CREATE INDEX idx_invites_recovery_email_created
  ON invites(invitee_email, event_id, invite_type, created_at DESC)
  WHERE status IN ('sent', 'expired');

CREATE INDEX idx_proposal_speakers_user_active
  ON proposal_speakers(user_id, created_at DESC, proposal_id)
  WHERE role <> 'proposer' AND status IN ('invited', 'confirmed');

-- Calendar replies describe one event day, not the entire registration. Keep
-- that identity normalized so enforcement never infers a registration-wide
-- cancellation from a day-level response. Nullable legacy/ambiguous rows are
-- retained for audit but fail closed in the enforcement job.
ALTER TABLE calendar_rsvp_events ADD COLUMN event_day_id TEXT REFERENCES event_days(id);
ALTER TABLE calendar_rsvp_events ADD COLUMN action_due_at TEXT;

-- Older dedupe keys predate provider namespacing. Preserve their original
-- tuple shape while preventing two calendar transports from suppressing each
-- other's events after deployment.
UPDATE calendar_rsvp_events
SET dedupe_key = CASE json_array_length(dedupe_key)
  WHEN 2 THEN json_array(
    provider,
    json_extract(dedupe_key, '$[0]'),
    json_extract(dedupe_key, '$[1]')
  )
  WHEN 3 THEN json_array(
    provider,
    json_extract(dedupe_key, '$[0]'),
    json_extract(dedupe_key, '$[1]'),
    json_extract(dedupe_key, '$[2]')
  )
  ELSE dedupe_key
END;

UPDATE calendar_rsvp_events AS rsvp
SET event_day_id = (
  SELECT ed.id
  FROM registrations r
  JOIN event_days ed ON ed.event_id = r.event_id
  WHERE r.id = rsvp.registration_id
    AND ed.day_date = substr(rsvp.ics_uid, length(rsvp.registration_id) + 2, 10)
  LIMIT 1
)
WHERE event_day_id IS NULL
  AND rsvp.ics_uid LIKE rsvp.registration_id || '-____-__-__@%';

-- Preserve already-issued warnings while making their next action directly
-- indexable. New warnings calculate this timestamp in the application layer.
UPDATE calendar_rsvp_events AS rsvp
SET action_due_at = CASE
  WHEN rsvp.event_day_id IS NULL THEN rsvp.warning_sent_at
  WHEN julianday((SELECT starts_at FROM event_days WHERE id = rsvp.event_day_id)) > julianday('now', '+14 days')
    THEN strftime('%Y-%m-%dT%H:%M:%fZ', rsvp.warning_sent_at, '+48 hours')
  WHEN julianday((SELECT starts_at FROM event_days WHERE id = rsvp.event_day_id)) > julianday('now', '+7 days')
    THEN strftime('%Y-%m-%dT%H:%M:%fZ', rsvp.warning_sent_at, '+24 hours')
  ELSE strftime('%Y-%m-%dT%H:%M:%fZ', rsvp.warning_sent_at, '+2 hours')
END
WHERE rsvp.action_executed_at IS NULL
  AND rsvp.warning_sent_at IS NOT NULL
  AND rsvp.response_status IN ('declined', 'tentative');

CREATE INDEX idx_calendar_rsvp_registration_day_received
  ON calendar_rsvp_events(registration_id, event_day_id, response_status, received_at DESC, id DESC);

CREATE INDEX idx_calendar_rsvp_pending_warning
  ON calendar_rsvp_events(received_at, id)
  WHERE action_executed_at IS NULL
    AND warning_sent_at IS NULL
    AND response_status IN ('declined', 'tentative');

CREATE INDEX idx_calendar_rsvp_pending_action
  ON calendar_rsvp_events(action_due_at, received_at, id)
  WHERE action_executed_at IS NULL
    AND action_due_at IS NOT NULL
    AND response_status IN ('declined', 'tentative');

CREATE INDEX idx_calendar_rsvp_pending_bounce
  ON calendar_rsvp_events(received_at, id)
  WHERE action_executed_at IS NULL AND response_status = 'bounced';

-- Registration status is constrained by the already-deployed base schema.
-- Keep that durable lifecycle vocabulary small and store the extensible reason
-- separately so adding a new cancellation reason never requires rebuilding the
-- registrations table just to replace a SQLite CHECK constraint.
ALTER TABLE registrations ADD COLUMN cancellation_reason_code TEXT;
ALTER TABLE registrations ADD COLUMN transition_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE registration_transition_guards (
  id                TEXT NOT NULL PRIMARY KEY,
  registration_id   TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  FOREIGN KEY(registration_id) REFERENCES registrations(id) ON DELETE CASCADE
);

CREATE TRIGGER trg_registration_transition_guard_validate
BEFORE INSERT ON registration_transition_guards
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT transition_revision FROM registrations WHERE id = NEW.registration_id), -1)
         <> NEW.expected_revision
    THEN RAISE(ABORT, 'REGISTRATION_CHANGED')
  END;
END;

CREATE TRIGGER trg_registration_transition_guard_advance
AFTER INSERT ON registration_transition_guards
FOR EACH ROW
BEGIN
  UPDATE registrations
  SET transition_revision = transition_revision + 1
  WHERE id = NEW.registration_id;
  DELETE FROM registration_transition_guards WHERE id = NEW.id;
END;

CREATE TRIGGER trg_registration_transition_revision
AFTER UPDATE OF status, user_id, confirmation_link_secret, manage_link_secret ON registrations
FOR EACH ROW
WHEN OLD.status IS NOT NEW.status
  OR OLD.user_id IS NOT NEW.user_id
  OR OLD.confirmation_link_secret IS NOT NEW.confirmation_link_secret
  OR OLD.manage_link_secret IS NOT NEW.manage_link_secret
BEGIN
  UPDATE registrations
  SET transition_revision = transition_revision + 1
  WHERE id = NEW.id;
END;

-- Capacity decisions are planned from a bounded snapshot, then committed in a
-- D1 batch with the registration aggregate and its outbox record. Track a
-- revision per day so the batch can reject a stale plan instead of admitting
-- two concurrent registrations into the final seat or emailing stale state.
ALTER TABLE event_days ADD COLUMN capacity_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE event_day_capacity_guards (
  id                    TEXT NOT NULL PRIMARY KEY,
  event_day_id          TEXT NOT NULL,
  expected_revision     INTEGER NOT NULL,
  claim_registration_id TEXT,
  FOREIGN KEY(event_day_id) REFERENCES event_days(id) ON DELETE CASCADE,
  FOREIGN KEY(claim_registration_id) REFERENCES registrations(id) ON DELETE CASCADE
);

CREATE TRIGGER trg_event_day_capacity_guard_validate
BEFORE INSERT ON event_day_capacity_guards
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT capacity_revision FROM event_days WHERE id = NEW.event_day_id), -1)
         <> NEW.expected_revision
    THEN RAISE(ABORT, 'EVENT_DAY_CAPACITY_CHANGED')
  END;
  SELECT CASE
    WHEN NEW.claim_registration_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM event_day_waitlist_entries w
          WHERE w.event_day_id = NEW.event_day_id
            AND w.registration_id = NEW.claim_registration_id
            AND w.status = 'offered'
            AND (
              w.offer_expires_at IS NULL
              OR w.offer_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            )
        )
    THEN RAISE(ABORT, 'DAY_WAITLIST_OFFER_UNAVAILABLE')
  END;
END;

CREATE TRIGGER trg_event_day_capacity_guard_advance
AFTER INSERT ON event_day_capacity_guards
FOR EACH ROW
BEGIN
  UPDATE event_day_waitlist_entries
  SET status = 'accepted', offer_expires_at = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NEW.claim_registration_id IS NOT NULL
    AND event_day_id = NEW.event_day_id
    AND registration_id = NEW.claim_registration_id
    AND status = 'offered'
    AND (
      offer_expires_at IS NULL
      OR offer_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );
  SELECT CASE
    WHEN NEW.claim_registration_id IS NOT NULL AND changes() <> 1
    THEN RAISE(ABORT, 'DAY_WAITLIST_OFFER_UNAVAILABLE')
  END;
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE id = NEW.event_day_id;
  DELETE FROM event_day_capacity_guards WHERE id = NEW.id;
END;

CREATE TRIGGER trg_event_day_capacity_configuration_revision
AFTER UPDATE OF in_person_capacity, attendance_options_json ON event_days
FOR EACH ROW
WHEN OLD.in_person_capacity IS NOT NEW.in_person_capacity
  OR OLD.attendance_options_json IS NOT NEW.attendance_options_json
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER trg_registration_capacity_insert_revision
AFTER INSERT ON registrations
FOR EACH ROW
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE event_id = NEW.event_id;
END;

CREATE TRIGGER trg_registration_capacity_delete_revision
AFTER DELETE ON registrations
FOR EACH ROW
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE event_id = OLD.event_id;
END;

CREATE TRIGGER trg_registration_capacity_update_revision
AFTER UPDATE OF status, capacity_exempt_in_person ON registrations
FOR EACH ROW
WHEN OLD.status IS NOT NEW.status
  OR OLD.capacity_exempt_in_person IS NOT NEW.capacity_exempt_in_person
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE event_id IN (OLD.event_id, NEW.event_id);
END;

CREATE TRIGGER trg_registration_day_attendance_insert_revision
AFTER INSERT ON registration_day_attendance
FOR EACH ROW
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE id = NEW.event_day_id;
END;

CREATE TRIGGER trg_registration_day_attendance_delete_revision
AFTER DELETE ON registration_day_attendance
FOR EACH ROW
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE id = OLD.event_day_id;
END;

CREATE TRIGGER trg_registration_day_attendance_update_revision
AFTER UPDATE OF registration_id, event_day_id, attendance_type ON registration_day_attendance
FOR EACH ROW
WHEN OLD.registration_id IS NOT NEW.registration_id
  OR OLD.event_day_id IS NOT NEW.event_day_id
  OR OLD.attendance_type IS NOT NEW.attendance_type
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE id IN (OLD.event_day_id, NEW.event_day_id);
END;

CREATE TRIGGER trg_event_day_waitlist_insert_revision
AFTER INSERT ON event_day_waitlist_entries
FOR EACH ROW
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE id = NEW.event_day_id;
END;

CREATE TRIGGER trg_event_day_waitlist_delete_revision
AFTER DELETE ON event_day_waitlist_entries
FOR EACH ROW
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE id = OLD.event_day_id;
END;

CREATE TRIGGER trg_event_day_waitlist_update_revision
AFTER UPDATE OF event_day_id, status, offer_expires_at ON event_day_waitlist_entries
FOR EACH ROW
WHEN OLD.event_day_id IS NOT NEW.event_day_id
  OR OLD.status IS NOT NEW.status
  OR OLD.offer_expires_at IS NOT NEW.offer_expires_at
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE id IN (OLD.event_day_id, NEW.event_day_id);
END;

-- A conversion counter alone cannot distinguish a legitimate new conversion
-- from a retry. Keep the conversion identity and use it to update the counter
-- exactly once inside the caller's D1 batch.
CREATE TABLE referral_conversions (
  id              TEXT NOT NULL PRIMARY KEY,
  code            TEXT NOT NULL,
  conversion_type TEXT NOT NULL,
  conversion_ref  TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE(code, conversion_type, conversion_ref),
  FOREIGN KEY(code) REFERENCES referral_codes(code)
);

CREATE INDEX idx_referral_conversions_code_created
  ON referral_conversions(code, created_at);

-- Section: RESTful API & Portal-Managed Forms
--
-- (Membership Application Endpoint), (Sponsor Interest
-- Endpoint), and (public members / working-groups endpoints) all need
-- tables that don't exist yet. Per the no-CHECK-constraint
-- convention, status/stage/type columns below carry `-- allowed:`
-- comments only; validation lives in the application layer (Zod).
--
-- Three groups of tables, each pulled forward from an endpoint that needs them now:
--
-- 1. member_applications / member_application_events / application_documents
--    — defined in application_documents, but
--    required immediately by POST /api/v1/members/applications.
--
-- 2. sponsorships / sponsorship_events —
--    required immediately by POST /api/v1/sponsorship/inquiries and
--    /checkout. Only the columns needed to record an inquiry/checkout are
--    exercised in the beginning; the full sales-pipeline admin UI is later.
--    Two columns beyond the schema are added here because of initial changes
--    inquiries commonly come from people with no existing member/org
--    record: `contact_name` / `contact_email` (submitter identity —
--    schema had no way to reach the submitter at all, a gap in the same
--    spirit as the findings in code review) and `checkout_session_id`
--    (idempotency key for the Stripe webhook, mirroring `donations.
--    checkout_session_id`).
--
-- 3. working_groups / working_group_members — required immediately by GET /api/v1/working-groups
--    (list) and GET /api/v1/working-groups/:id (detail + member list).
--    Seeded here with the six working groups already published under
--    content/wg/ so the public endpoints return real data before
--    or touch this table again (e.g. adding chair assignment UI).

-- ── Membership applications ──────────────────────────────

CREATE TABLE member_applications (
  id                   TEXT NOT NULL PRIMARY KEY,
  applicant_email      TEXT NOT NULL,
  applicant_name       TEXT NOT NULL,
  organization_name    TEXT,
  organization_domain  TEXT,
  membership_category  TEXT NOT NULL,
  form_submission_id   TEXT,
  -- the application's answers live in form_submissions/form_submission_answers
  -- (against the 'membership-application' form seeded below), not on this row.
  stage                TEXT NOT NULL DEFAULT 'pending',
  -- allowed: pending | in_review | on_hold | in_consultation | ec_review | approved | declined | withdrawn
  stage_entered_at     TEXT NOT NULL,
  -- Monotonic stage-entry token. Timestamps remain useful for scheduling and
  -- display, but are not unique enough to guard a concurrent stage cycle.
  transition_revision  INTEGER NOT NULL DEFAULT 0,
  -- Set atomically with the durable consultation-batch outbox record. A
  -- transition back into in_consultation clears it so each consultation
  -- stage entry is announced exactly once without an unbounded batch scan.
  consultation_notified_at TEXT,
  review_notes         TEXT,
  assigned_to_user_id  TEXT,
  manage_token_hash    TEXT NOT NULL UNIQUE,
  -- sha256 of the applicant's status/document-upload token; plaintext is
  -- returned once at submission time and emailed, never stored.
  on_hold_subtype      TEXT,
  -- allowed: request_authority | request_org_email | request_pki_experience
  --        | request_org_application | request_information
  -- distinguishes *why* an application is on_hold; NULL when not on_hold.
  -- Reset on every transition into on_hold. The scheduled reminder claims
  -- this marker atomically with its event, audit, and outbox intent.
  on_hold_reminder_sent_at TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  FOREIGN KEY(form_submission_id) REFERENCES form_submissions(id),
  FOREIGN KEY(assigned_to_user_id) REFERENCES users(id),
  FOREIGN KEY(membership_category) REFERENCES membership_categories(code)
);

CREATE INDEX idx_member_applications_email ON member_applications(applicant_email);
CREATE INDEX idx_member_applications_domain ON member_applications(organization_domain);
CREATE INDEX idx_member_applications_stage ON member_applications(stage);
-- Supports the scheduled on-hold-reminder/EC-auto-approve due-work queries'
-- ORDER BY stage_entered_at LIMIT ? (PR #1 review §9.1) with a direct index
-- range scan instead of a full per-stage table scan.
CREATE INDEX idx_member_applications_stage_entered_at ON member_applications(stage, stage_entered_at, id);
CREATE INDEX idx_member_applications_consultation_due
  ON member_applications(stage, consultation_notified_at, stage_entered_at, id)
  WHERE stage = 'in_consultation' AND consultation_notified_at IS NULL;
CREATE INDEX idx_member_applications_on_hold_closure_due
  ON member_applications(stage_entered_at, id)
  WHERE stage = 'on_hold';
CREATE INDEX idx_member_applications_on_hold_reminder_due
  ON member_applications(stage_entered_at, id)
  WHERE stage = 'on_hold'
    AND on_hold_reminder_sent_at IS NULL
    AND on_hold_subtype IS NOT NULL;

CREATE TABLE member_application_events (
  id             TEXT NOT NULL PRIMARY KEY,
  application_id TEXT NOT NULL,
  from_stage     TEXT,
  to_stage       TEXT NOT NULL,
  actor_user_id  TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES member_applications(id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);

CREATE INDEX idx_member_application_events_app ON member_application_events(application_id, created_at);

-- Approval is a one-time, terminal transition (approveApplication is the
-- sole path to status='approved'). This structurally rejects a second
-- concurrent approval batch outright: if two approve() calls both pass the
-- read-time stage check and race to commit, the loser's event insert
-- violates this index, failing its entire db.batch() (one transaction) —
-- so its provisioning/email/audit/Google-Groups writes in the same batch
-- never commit either, without needing per-statement claim-token chaining.
-- Scoped to `from_stage != 'approved'` (a real transition into approved) so
-- it does NOT also reject updateAdminApplication's own
-- from_stage = to_stage = 'approved' marker event, which records a details
-- edit on an application that's already approved without representing a
-- second approval.
CREATE UNIQUE INDEX uq_member_application_events_approved
  ON member_application_events(application_id)
  WHERE to_stage = 'approved' AND (from_stage IS NULL OR from_stage != 'approved');

CREATE TABLE application_documents (
  id                TEXT NOT NULL PRIMARY KEY,
  application_id    TEXT NOT NULL,
  uploaded_by_email TEXT NOT NULL,
  r2_key            TEXT NOT NULL,
  -- convention: application-docs/{application_id}/{uuid}-{filename}
  filename          TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  file_size_bytes   INTEGER NOT NULL,
  uploaded_at       TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES member_applications(id)
);

CREATE INDEX idx_application_documents_app
  ON application_documents(application_id, uploaded_at, id);

-- ── Sponsorships ──────────────────────────────────────────────

CREATE TABLE sponsorships (
  id                     TEXT NOT NULL PRIMARY KEY,
  sponsor_type           TEXT NOT NULL,
  -- allowed: consortium | event
  organization_id        TEXT,
  -- FK to organizations, for consortium sponsors and member event sponsors
  non_member_name        TEXT,
  non_member_website     TEXT,
  non_member_logo_r2_key TEXT,
  contact_name           TEXT,
  contact_email          TEXT,
  -- submitter identity — see migration header note
  event_id               TEXT,
  -- FK to events, for event sponsors only
  tier                   TEXT,
  -- allowed: Titanium | Diamond | Platinum | Gold | Silver (consortium)
  --        | Leader | Inspirator | Innovator | Ambassador (event)
  pipeline_stage         TEXT NOT NULL DEFAULT 'new_inquiry',
  -- allowed: new_inquiry | contacted | proposal_sent | negotiating | payment_pending | active | lapsed
  transition_revision    INTEGER NOT NULL DEFAULT 0,
  -- Incremented by every pipeline/renewal mutation and used as the compare-and-set
  -- boundary for staff transitions and scheduled automation.
  checkout_session_id    TEXT UNIQUE,
  -- Stripe Checkout session id, for Path B self-service; idempotency key
  -- for the webhook that creates/updates this row (see migration header).
  stripe_event_id        TEXT UNIQUE,
  -- The first paid Stripe event accepted for this checkout. Combined with
  -- checkout_session_id this makes both event retries and the two possible
  -- paid event types idempotent at the database boundary.
  start_date             TEXT,
  renewal_date           TEXT,
  assigned_to_user_id    TEXT,
  -- Materialized next scheduler action. This keeps due-work reads bounded by
  -- an actionable partial index instead of scanning historical effect rows.
  renewal_action_due_at  TEXT,
  notes                  TEXT,
  price_amount_cents     INTEGER,
  price_currency         TEXT,
  -- price snapshot on the transaction, so a later sponsorship_tier_config
  -- change never affects an already-completed sponsorship's recorded price.
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES organizations(id),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(assigned_to_user_id) REFERENCES users(id)
);

CREATE INDEX idx_sponsorships_stage ON sponsorships(pipeline_stage);
CREATE INDEX idx_sponsorships_event ON sponsorships(event_id);
CREATE INDEX idx_sponsorships_org ON sponsorships(organization_id);
CREATE INDEX idx_sponsorships_active_consortium_org_projection
  ON sponsorships(organization_id, start_date DESC, id)
  WHERE sponsor_type = 'consortium' AND pipeline_stage = 'active';
-- Supports the scheduled sponsorship renewal-reminder/auto-lapse due-work
-- query's ORDER BY renewal_action_due_at LIMIT ? (PR #1 review §9.1) with a direct
-- index range scan instead of an unbounded full-stage scan.
CREATE INDEX idx_sponsorships_active_renewal_action_due
  ON sponsorships(renewal_action_due_at, id)
  WHERE pipeline_stage = 'active' AND renewal_action_due_at IS NOT NULL;

CREATE TABLE sponsorship_events (
  id             TEXT NOT NULL PRIMARY KEY,
  sponsorship_id TEXT NOT NULL,
  from_stage     TEXT,
  to_stage       TEXT NOT NULL,
  actor_user_id  TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY(sponsorship_id) REFERENCES sponsorships(id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);

CREATE INDEX idx_sponsorship_events_sponsorship
  ON sponsorship_events(sponsorship_id, created_at DESC, id DESC);

CREATE TABLE sponsorship_automation_effects (
  sponsorship_id TEXT NOT NULL REFERENCES sponsorships(id),
  effect_key     TEXT NOT NULL,
  -- Evolvable, date-scoped application-owned vocabulary (for example
  -- renewal-reminder-60:2027-01-01); deliberately not constrained by a D1 CHECK.
  created_at     TEXT NOT NULL,
  PRIMARY KEY (sponsorship_id, effect_key)
);

-- ── Working groups ─────────────────────────────────────────────

-- Chairs/vice-chairs are resolved from user_roles (role-wg_chair/
-- role-wg_vice_chair, context_type='working_group') — see consolidated migration 0035 —
-- not a column here, so there is exactly one source of truth for who chairs
-- a working group.
CREATE TABLE working_groups (
  id                       TEXT NOT NULL PRIMARY KEY,
  name                     TEXT NOT NULL,
  slug                     TEXT NOT NULL UNIQUE,
  description              TEXT,
  mailing_list_email       TEXT,
  min_endorsers_for_ballot INTEGER NOT NULL DEFAULT 0,
  active                   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE TABLE working_group_members (
  id               TEXT NOT NULL PRIMARY KEY,
  working_group_id TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  -- Which membership (individual or organization-tied aggregate, `members.id`
  -- from consolidated migration 0035 below) this WG seat is held on behalf of. Nullable:
  -- a staff-driven add for a target holding more than one active membership
  -- has no unambiguous "acting as" context to record (PR #1 review,
  -- phase1-2-review-20260817.md blocker 2 — "Working-group participation...
  -- need an explicit member_id when the person acts on behalf of a
  -- particular member"). Forward references `members`, created by the next
  -- migration in this same unreleased range — SQLite does not validate FK
  -- target existence at CREATE TABLE time, only at DML time, and `members`
  -- exists by the time any row here is ever written.
  member_id        TEXT,
  joined_at        TEXT NOT NULL,
  left_at          TEXT,
  FOREIGN KEY(working_group_id) REFERENCES working_groups(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(member_id) REFERENCES members(id)
);

CREATE INDEX idx_wg_members_wg ON working_group_members(working_group_id, left_at);
CREATE INDEX idx_wg_members_user ON working_group_members(user_id);
CREATE INDEX idx_wg_members_member ON working_group_members(member_id);
-- Weekly membership digests query one closed time window across every WG.
-- Put the range column first so both join and leave branches remain indexed
-- without depending on an individual working_group_id predicate.
CREATE INDEX idx_wg_members_joined_window ON working_group_members(joined_at, working_group_id);
CREATE INDEX idx_wg_members_left_window ON working_group_members(left_at, working_group_id)
  WHERE left_at IS NOT NULL;
-- At most one active (left_at IS NULL) membership per (working_group, user);
-- partial so a user can rejoin after leaving.
CREATE UNIQUE INDEX idx_wg_members_active_unique ON working_group_members(working_group_id, user_id) WHERE left_at IS NULL;

INSERT OR IGNORE INTO working_groups
  (id, name, slug, description, mailing_list_email, min_endorsers_for_ballot, active, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'Post-Quantum Cryptography Working Group', 'pqc',
   'Preparing the PKI ecosystem for the quantum computing era through collaborative research, education, standards alignment, and practical tooling.',
   NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'Cryptographic Module Working Group', 'cm',
   'A central forum for addressing cryptographic module (CM) and hardware security module (HSM) related topics within the PKI ecosystem.',
   NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'PKI Maturity Model Working Group', 'pkimm',
   'Building a globally recognized PKI maturity model for evaluating, planning, and comparing PKI implementations.',
   NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'Training and Certification Working Group', 'tcwg',
   'Advancing PKI knowledge and skills through structured training paths, certification programs, and accessible educational resources.',
   NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'CA Working Group', 'ca',
   'A working group for discussions and information sharing among publicly trusted Certificate Authorities.',
   NULL, 0, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'CBOM Profiles Working Group', 'cbom',
   'Developing a neutral, open methodology for defining Cryptographic Bill of Materials (CBOM) profiles that map onto industry BOM standards such as SPDX and CycloneDX.',
   NULL, 0, 1, datetime('now'), datetime('now'));

-- ── Portal-managed membership application form ───────────────────────
-- forms.purpose already allows 'application' (migration 0000) — no rebuild
-- needed. This seeds the default field set mirroring the existing
-- layouts/shortcodes/joinform.html so GET /api/v1/members/applications/form
-- returns a real, staff-editable form from day one.

INSERT OR IGNORE INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
VALUES (
  lower(hex(randomblob(16))), 'membership-application', 'global', NULL, 'application', 'active',
  'PKI Consortium Membership Application',
  'Application form for prospective PKI Consortium members.',
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO form_fields (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
VALUES
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'job_title', 'Role / Job Title', 'text', 0, NULL, NULL, 10, datetime('now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'linkedin', 'LinkedIn Profile', 'url', 0, NULL, NULL, 20, datetime('now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'organization_website', 'Organization Website', 'url', 0, NULL, NULL, 30, datetime('now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'about_yourself', 'About Yourself', 'textarea', 0, NULL, NULL, 40, datetime('now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'about_organization', 'About Your Organization', 'textarea', 0, NULL, NULL, 50, datetime('now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'reason', 'Why do you want to join PKI Consortium?', 'textarea', 1, NULL, NULL, 60, datetime('now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'working_groups', 'Working Groups of Interest', 'multi_select', 0,
   '[{"value":"pqc","label":"Post-Quantum Cryptography Working Group"},{"value":"cm","label":"Cryptographic Module Working Group"},{"value":"pkimm","label":"PKI Maturity Model Working Group"},{"value":"tcwg","label":"Training and Certification Working Group"},{"value":"ca","label":"CA Working Group"},{"value":"cbom","label":"CBOM Profiles Working Group"}]',
   '{"uiWidget":"checkboxes"}', 70, datetime('now'));

-- ── Email templates ──────────────────────────────────────

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'application-received', 1,
    'We received your PKI Consortium membership application',
    'Hi {{applicantName}},

Thank you for applying for PKI Consortium membership. We have received your application and a member of our team will review it shortly.

You can check the status of your application at any time:
[Check application status]({{statusUrl}})

If you have any questions, just reply to this email.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-brochure', 1,
    'PKI Consortium sponsorship information',
    'Hi {{contactName}},

Thank you for your interest in sponsoring the PKI Consortium{{#eventName}} — {{eventName}}{{/eventName}}. Attached is our sponsorship brochure with tier details and benefits.

Brochure: [{{brochureUrl}}]({{brochureUrl}})

A member of our team will follow up with you shortly to discuss next steps.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-new-inquiry', 1,
    'New sponsorship inquiry: {{contactName}} ({{organizationName}})',
    'A new sponsorship inquiry was submitted.

- Contact: {{contactName}} <{{contactEmail}}>
- Organization: {{organizationName}}
- Sponsor type: {{sponsorType}}
- Tier: {{tier}}
- Notes: {{notes}}

[View in admin]({{adminUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  );

-- Section: Membership category assignment + organization representatives
--
-- `members` (migration 0000) already models the aggregate this PR needs —
-- one row per organization or per individual, mutual exclusivity of
-- user_id/organization_id already enforced — so it is never rebuilt or
-- altered by this PR. What was missing is a home for (1) the membership
-- category of an aggregate and (2) the N people who represent an
-- organization-tied aggregate. Both are additive, 1:1-or-1:N tables keyed
-- off members.id, not columns bolted onto members/organizations.
--
-- Representative *roles* (primary contact, secondary contact, voting
-- delegate) deliberately do not get their own table here — they reuse the
-- existing roles/user_roles RBAC system (see consolidated migration 0035's additive
-- delta), scoped by context_type='organization'/context_id=members.id.

-- ── Membership category assignment ──────────────────────────────────────
-- One category per aggregate (organization-tied or individual), in its own
-- table rather than a column on members (which the review flagged as
-- table-widening churn) or organizations (which would need syncing back to
-- members for individuals, who have no organizations row at all).
CREATE TABLE member_category_assignments (
  member_id     TEXT NOT NULL PRIMARY KEY,
  category_code TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(category_code) REFERENCES membership_categories(code)
);

-- ── Organization representatives ─────────────────────────────────────────
-- The N people who represent an org-tied membership aggregate. Temporal
-- (joined_at/left_at) — active/inactive is exactly what left_at IS NULL/IS
-- NOT NULL means, so transfer (close old row, open new one) and rejoin
-- (open a fresh row) both fall out of ordinary inserts/updates.
CREATE TABLE organization_representatives (
  id                  TEXT NOT NULL PRIMARY KEY,
  member_id           TEXT NOT NULL,
  -- FK to members.id — the organization's aggregate row
  user_id             TEXT NOT NULL,
  show_on_org_profile INTEGER NOT NULL DEFAULT 1 CHECK (show_on_org_profile IN (0, 1)),
  joined_at           TEXT NOT NULL,
  left_at             TEXT,
  -- NULL while active
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK (left_at IS NULL OR left_at >= joined_at),
  UNIQUE (id, member_id),
  -- lets a service-layer check prove a representative row belongs to a
  -- specific member before granting a representative role against it
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- A person may represent more than one organization at a time (confirmed
-- product decision — e.g. someone representing both their own employer and
-- PKI Consortium, or multiple member organizations simultaneously), so this
-- constrains only the active pair, not "one active representative row per
-- user" globally. Partial so a former representative can rejoin: their old,
-- now-inactive (left_at IS NOT NULL) row no longer occupies the pair.
CREATE UNIQUE INDEX uq_organization_representatives_active_pair
  ON organization_representatives(member_id, user_id)
  WHERE left_at IS NULL;

CREATE INDEX idx_organization_representatives_member_active
  ON organization_representatives(member_id, left_at, joined_at);
CREATE INDEX idx_organization_representatives_user_active
  ON organization_representatives(user_id, left_at, joined_at);

-- Section: Fine-Grained Access Control
--
-- Adds the roles/user_roles/permission_grants/refresh_tokens model from,
-- seeds the built-in roles from, and executes the
-- backfills (event_permissions → user_roles, users.role='admin' →
-- user_roles), then drops event_permissions resolution.
--
-- Two deviations from the original literal schema:
--
-- 1. `role_permissions` is a new table, not present anywhere in
--    describes each built-in role's default permission bundle in prose only
--    and says bundles must be admin-customizable ("their permission bundles
--    can be customized by an admin as the portal evolves") — that requires
--    somewhere to actually store and edit the bundle. This is the same
--    class of gap.
--
-- 2. `user_roles.user_id` is nullable here (with a parallel `user_email`
--    column), not NOT NULL as shown in SQL sketch.
--    Resolution text requires the opposite of what SQL says: it
--    requires the new model to "preserve this pre-provisioning behavior,
--    since event organizers/PC members are often granted access before
--    their first login" — exactly the nullable-user_id + user_email pattern
--    `event_permissions` already used. A NOT NULL user_id makes that
--    impossible, so the nullable form (matching event_permissions, which
--    this migration backfills from) is what's implemented.
--
-- `permission_grants` and `refresh_tokens` are created exactly as specified.

CREATE TABLE roles (
  id             TEXT    NOT NULL PRIMARY KEY,
  name           TEXT    NOT NULL UNIQUE,
  description    TEXT,
  is_system_role INTEGER NOT NULL DEFAULT 0 CHECK (is_system_role IN (0, 1)),
  single_holder_per_context INTEGER NOT NULL DEFAULT 0 CHECK (single_holder_per_context IN (0, 1)),
  -- when 1, at most one active grant of this role may exist per
  -- (context_type, context_id) — see uq_user_roles_single_holder_per_context
  -- below. Used by the three organization-representative roles seeded at
  -- the end of this migration (one primary contact, one secondary contact,
  -- one voting delegate per organization at a time).
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);

CREATE TABLE role_permissions (
  id         TEXT NOT NULL PRIMARY KEY,
  role_id    TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(role_id, permission),
  FOREIGN KEY(role_id) REFERENCES roles(id)
);

CREATE TABLE user_roles (
  id                 TEXT NOT NULL PRIMARY KEY,
  user_id            TEXT,
  user_email         TEXT,
  role_id            TEXT NOT NULL,
  context_type       TEXT,
  -- allowed: 'event' | 'working_group' | 'organization' | NULL (global)
  context_id         TEXT,
  granted_by_user_id TEXT,
  expires_at         TEXT,
  revoked_at         TEXT,
  single_holder_per_context INTEGER NOT NULL DEFAULT 0 CHECK (single_holder_per_context IN (0, 1)),
  -- denormalized copy of roles.single_holder_per_context, set by the
  -- service layer at insert time. SQLite partial-index predicates can only
  -- reference columns of the indexed table itself, so this is what lets one
  -- index (below) enforce "singleton per context" for only the roles that
  -- need it, without also constraining roles that are legitimately
  -- many-per-context (e.g. role-event_volunteer).
  created_at         TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(role_id) REFERENCES roles(id),
  FOREIGN KEY(granted_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_email ON user_roles(user_email);
CREATE INDEX idx_user_roles_context ON user_roles(context_type, context_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
CREATE UNIQUE INDEX uq_user_roles_single_holder_per_context
  ON user_roles(context_type, context_id, role_id)
  WHERE revoked_at IS NULL AND single_holder_per_context = 1;

-- Preserve the active-grant uniqueness that the legacy event_permissions
-- table enforced and extend it to every non-singleton role assignment. Two
-- partial indexes cover pre-provisioned email grants and account-bound grants.
CREATE UNIQUE INDEX uq_user_roles_active_email_role_context
  ON user_roles(role_id, COALESCE(context_type, ''), COALESCE(context_id, ''), lower(user_email))
  WHERE revoked_at IS NULL AND single_holder_per_context = 0 AND user_email IS NOT NULL;

CREATE UNIQUE INDEX uq_user_roles_active_user_role_context
  ON user_roles(role_id, COALESCE(context_type, ''), COALESCE(context_id, ''), user_id)
  WHERE revoked_at IS NULL AND single_holder_per_context = 0 AND user_email IS NULL AND user_id IS NOT NULL;

CREATE TABLE permission_grants (
  id                 TEXT NOT NULL PRIMARY KEY,
  user_id            TEXT NOT NULL,
  permission         TEXT NOT NULL,
  context_type       TEXT,
  context_id         TEXT,
  granted_by_user_id TEXT,
  expires_at         TEXT,
  revoked_at         TEXT,
  created_at         TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(granted_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_permission_grants_user ON permission_grants(user_id);
CREATE INDEX idx_permission_grants_context ON permission_grants(context_type, context_id);

CREATE TABLE refresh_tokens (
  id           TEXT NOT NULL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  issued_at    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  last_used_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- ── Built-in system roles ────────────────────────────────────────────
--
-- Fixed, human-readable primary keys (not randomblob) so this migration can
-- reference them across statements — plain SQL has no scripting/variables.
--
-- Two roles beyond table are seeded here: `event_moderator` and
-- `event_volunteer`. They exist solely so the event_permissions backfill
-- below is lossless — the old `moderator` and `volunteer` event_permissions
-- values have no equivalent in built-in role list, and silently
-- dropping them during migration would be a data-loss regression the same
-- way (sponsors/sponsor_events) called out. `moderator`
-- functionally granted proposal review (not finalize) under the old
-- REVIEW_PERMISSIONS set in proposal-access.ts; `volunteer` granted no
-- functional capability in the old code at all, so it is preserved as a
-- record with an empty permission bundle.

INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at) VALUES
  ('role-admin', 'admin', 'Full access', 1, datetime('now'), datetime('now')),
  ('role-membership_processor', 'membership_processor', 'Membership workflow only', 1, datetime('now'), datetime('now')),
  ('role-wg_chair', 'wg_chair', 'WG-scoped (assigned per WG)', 1, datetime('now'), datetime('now')),
  ('role-event_organizer', 'event_organizer', 'Full management of a specific event', 1, datetime('now'), datetime('now')),
  ('role-program_committee', 'program_committee', 'Proposal review and agenda setting for a specific event', 1, datetime('now'), datetime('now')),
  ('role-member', 'member', 'Authenticated PKIC member (A-G)', 1, datetime('now'), datetime('now')),
  ('role-interested_parties', 'interested_parties', 'Authenticated PKIC member (H) - no voting rights', 1, datetime('now'), datetime('now')),
  ('role-event_moderator', 'event_moderator', 'Event-scoped proposal review, no finalize (backfilled from event_permissions.moderator)', 1, datetime('now'), datetime('now')),
  ('role-event_volunteer', 'event_volunteer', 'Historical placeholder, no permissions (backfilled from event_permissions.volunteer)', 1, datetime('now'), datetime('now'));

-- ── Default permission bundles ──────────────────────────────────────────────
--
-- `admin` gets every permission string in the system, including the
-- `admin:read` / `admin:write` fallback pair used for admin routes that
-- don't yet belong to one of named modules (stats, portal-managed
-- forms config, bulk email campaigns).
--
-- `event_organizer`'s bundle extends beyond literal
-- events:write/events:manage to also include proposals:read,
-- proposals:score, proposals:manage, agenda:read, agenda:write — justified by
-- persona description ("manage capacity, send communications, manage
-- registrations, and view all attendee and proposal data for that event"),
-- and needed so an organizer's event access isn't missing proposal/agenda
-- management that the old event_permissions 'organizer' value already
-- granted via canFinalize.

INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES
  (lower(hex(randomblob(16))), 'role-admin', 'membership:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'membership:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'membership:approve', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'events:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'events:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'events:manage', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'working-groups:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'working-groups:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'email-templates:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'email-templates:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'donations:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'donations:sync', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'users:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'users:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'users:anonymize', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'audit:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'access:grant', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'access:revoke', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'organizations:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'organizations:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'organizations:content-review', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'sponsorships:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'sponsorships:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'votes:create', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'votes:manage', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'proposals:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'proposals:score', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'proposals:manage', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'agenda:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'agenda:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'sponsor-portal:attendee-data', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'admin:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'admin:write', datetime('now')),

  (lower(hex(randomblob(16))), 'role-membership_processor', 'membership:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-membership_processor', 'membership:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-membership_processor', 'membership:approve', datetime('now')),

  (lower(hex(randomblob(16))), 'role-wg_chair', 'working-groups:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-wg_chair', 'votes:create', datetime('now')),
  (lower(hex(randomblob(16))), 'role-wg_chair', 'votes:manage', datetime('now')),

  (lower(hex(randomblob(16))), 'role-event_organizer', 'events:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'events:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'events:manage', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'proposals:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'proposals:score', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'proposals:manage', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'agenda:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'agenda:write', datetime('now')),

  (lower(hex(randomblob(16))), 'role-program_committee', 'proposals:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'proposals:score', datetime('now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'proposals:manage', datetime('now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'agenda:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'agenda:write', datetime('now')),

  (lower(hex(randomblob(16))), 'role-event_moderator', 'proposals:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_moderator', 'proposals:score', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_moderator', 'agenda:read', datetime('now'));

-- ── Backfill: users.role='admin' → user_roles ────────────────────────

INSERT INTO user_roles (id, user_id, user_email, role_id, context_type, context_id, granted_by_user_id, expires_at, revoked_at, created_at)
SELECT lower(hex(randomblob(16))), u.id, NULL, 'role-admin', NULL, NULL, NULL, NULL, NULL, datetime('now')
FROM users u
WHERE u.role = 'admin';

-- ── Backfill: event_permissions → user_roles ─────────────────────────

INSERT INTO user_roles (id, user_id, user_email, role_id, context_type, context_id, granted_by_user_id, expires_at, revoked_at, created_at)
SELECT
  lower(hex(randomblob(16))),
  ep.user_id,
  ep.user_email,
  CASE ep.permission
    WHEN 'organizer' THEN 'role-event_organizer'
    WHEN 'program_committee' THEN 'role-program_committee'
    WHEN 'moderator' THEN 'role-event_moderator'
    WHEN 'volunteer' THEN 'role-event_volunteer'
  END,
  'event',
  ep.event_id,
  ep.granted_by_id,
  NULL,
  NULL,
  ep.created_at
FROM event_permissions ep;

DROP TABLE event_permissions;

-- ── Organization representative roles ────────────────────────────────────
-- Reuses this same roles/user_roles system for organization representative
-- designations instead of a bespoke organization_representative_roles
-- table. Each is a singleton per organization: at most one active
-- role-primary_contact, one role-secondary_contact, and one
-- role-voting_delegate grant per (context_type='organization',
-- context_id=members.id) at a time — enforced by
-- uq_user_roles_single_holder_per_context above. No default permission
-- bundle: the value of these roles is the designation itself, the same as
-- role-forum_chair/role-forum_vice_chair (consolidated migration 0035).

INSERT INTO roles (id, name, description, is_system_role, single_holder_per_context, created_at, updated_at) VALUES
  ('role-primary_contact', 'primary_contact', 'Primary point of contact for an organization membership', 1, 1, datetime('now'), datetime('now')),
  ('role-secondary_contact', 'secondary_contact', 'Secondary point of contact for an organization membership', 1, 1, datetime('now'), datetime('now')),
  ('role-voting_delegate', 'voting_delegate', 'Casts the organization''s forum-level vote', 1, 1, datetime('now'), datetime('now'));



-- Section: Passkey Authentication
--
-- Adds passkey_credentials. All columns are TEXT/INTEGER, matching
-- the rest of this schema (no other table in this codebase uses a BLOB
-- column) — public_key stores the raw COSE public key bytes returned by the
-- WebAuthn ceremony as a base64url TEXT string rather than BLOB, avoiding a
-- new binary-binding code path for a single column.
--
-- WebAuthn registration/authentication ceremonies carry their server-issued
-- challenge in a short-lived signed JWT between /begin and /complete. The JWT
-- includes a random challenge ID. A successful completion atomically records
-- that ID in passkey_challenge_uses alongside the credential/session changes,
-- making the ceremony single-use even for synced authenticators whose
-- signature counter remains zero. Each successful completion also deletes a
-- bounded batch of expired rows so this replay ledger cannot grow without
-- bound and no separate table-rebuild migration is needed.
--
-- credential_id stores the credential ID as base64url TEXT, in the clear —
-- unlike `sessions.token_hash`/`auth_magic_links.token_hash`, a WebAuthn
-- credential ID is not a bearer secret (security comes from the private key
-- never leaving the authenticator, proven via signature); hashing it would
-- only lose the ability to look it up for `excludeCredentials` at
-- registration time and for authenticate/complete's lookup (a
-- usernameless/discoverable-credential flow, "no auth required"
-- begin endpoint) with no security benefit.

CREATE TABLE passkey_credentials (
  id            TEXT    NOT NULL PRIMARY KEY,
  user_id       TEXT    NOT NULL,
  credential_id TEXT    NOT NULL UNIQUE,
  public_key    TEXT    NOT NULL,
  sign_count    INTEGER NOT NULL DEFAULT 0,
  aaguid        TEXT,
  device_name   TEXT,
  last_used_at  TEXT,
  created_at    TEXT    NOT NULL,
  revoked_at    TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX idx_passkey_credentials_user ON passkey_credentials(user_id);
CREATE INDEX idx_passkey_credentials_active_user_order
  ON passkey_credentials(user_id, created_at, id)
  WHERE revoked_at IS NULL;

CREATE TABLE passkey_challenge_uses (
  challenge_id TEXT NOT NULL PRIMARY KEY,
  purpose      TEXT NOT NULL,
  used_at      TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE INDEX idx_passkey_challenge_uses_expires
  ON passkey_challenge_uses(expires_at, challenge_id);



-- Section: Organization content columns
--
-- Step 2 (YAML → D1 import) needs somewhere real to write the
-- organization/member fields that data/members/*.yaml carries today
-- (description, long-form content, slogan, logo, blog/press/careers,
-- links). Those columns are formally defined in (Organization Profile
-- Management), which hasn't shipped and isn't on the critical path.
-- Resolution, only the *data-bearing* columns from that list are pulled
-- forward now; workflow-only additions (logo_staging_r2_key,
-- organization_content_reviews) land in consolidated migration 0035.
--
-- Primary/secondary contact and per-representative profile visibility are
-- NOT columns here: primary/secondary contact are organization-context
-- role-primary_contact/role-secondary_contact grants in user_roles
-- (consolidated migration 0035), and per-representative visibility is
-- organization_representatives.show_on_org_profile (consolidated migration 0035) — both
-- are relationship-owned, not organization- or member-owned facts.
--
-- Social links use the same canonical `links_json` array
-- (assets/shared/schemas/links.ts) that `users.links_json`
-- already uses (migration 0000), reusing the existing generic links UI
-- (ProfileLinksInput) instead of per-provider columns that make the schema
-- depend on whichever social networks happen to exist today. blog/press/
-- careers stay dedicated columns — those have distinct application
-- behavior (feed URLs), unlike display-only social links.
--
-- No CHECK constraints, per this repo's standing convention — every column
-- here is free text.

ALTER TABLE organizations ADD COLUMN description TEXT;
ALTER TABLE organizations ADD COLUMN website TEXT;
ALTER TABLE organizations ADD COLUMN content_markdown TEXT;
ALTER TABLE organizations ADD COLUMN slogan TEXT;
ALTER TABLE organizations ADD COLUMN logo_r2_key TEXT;
ALTER TABLE organizations ADD COLUMN blog_url TEXT;
ALTER TABLE organizations ADD COLUMN blog_feed_url TEXT;
ALTER TABLE organizations ADD COLUMN press_url TEXT;
ALTER TABLE organizations ADD COLUMN press_feed_url TEXT;
ALTER TABLE organizations ADD COLUMN careers_url TEXT;
ALTER TABLE organizations ADD COLUMN links_json TEXT;

-- Section: Membership Workflow Migration
--
-- Built application submission and the
-- public read API; built access control; built passkeys.
-- Nothing yet takes an application through review -> consultation ->
-- EC review -> approval -> onboarding, and nothing lets an approved member
-- log in and self-manage. This migration adds the schema those flows need.
--
-- Enforcement policy (PR #1 review, §1.3): boolean-as-integer flags get a
-- DB CHECK (durable structural invariant, not expected to gain a third
-- value) — see `is_ec_member` below. Evolvable closed-state vocabularies
-- (application/sponsorship stage, on-hold subtype, sync-queue status) stay
-- `-- allowed:` comments validated by a shared Zod schema on every write
-- path instead of a CHECK, since retiring/adding a workflow stage should be
-- additive, not a migration.

-- ── EC member designation ─────────────────────────────────────────
-- A distinct designation from `membership:approve` — controls who receives
-- ec-review-batch emails and who sees the EC decision screen, independent
-- of staff/processor role.
ALTER TABLE users ADD COLUMN is_ec_member INTEGER NOT NULL DEFAULT 0 CHECK (is_ec_member IN (0, 1));

-- ── Organization-domain claims ─────────────────────────────────────
-- One canonical registry spans both pending applications and approved
-- organizations. Submission atomically claims the domain for an application;
-- approval transfers that same row to the organization; decline/withdrawal
-- releases it. A single UNIQUE(domain) invariant therefore closes the race
-- that two separate application/organization tables could not prevent.
CREATE TABLE organization_domain_claims (
  id                     TEXT NOT NULL PRIMARY KEY,
  domain                 TEXT NOT NULL UNIQUE,
  application_id         TEXT UNIQUE REFERENCES member_applications(id),
  organization_id        TEXT REFERENCES organizations(id),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX idx_organization_domain_claims_org ON organization_domain_claims(organization_id);

-- ── EC decisions ───────────────────────
CREATE TABLE ec_decisions (
  id                TEXT NOT NULL PRIMARY KEY,
  application_id    TEXT NOT NULL,
  ec_member_user_id TEXT NOT NULL,
  decision          TEXT NOT NULL,
  -- allowed: approve | decline
  reason            TEXT,
  -- required (application layer) when decision = decline
  created_at        TEXT NOT NULL,
  UNIQUE(application_id, ec_member_user_id),
  FOREIGN KEY(application_id) REFERENCES member_applications(id),
  FOREIGN KEY(ec_member_user_id) REFERENCES users(id)
);

CREATE INDEX idx_ec_decisions_application_decision ON ec_decisions(application_id, decision);

-- ── Application concerns ────────────────────────────────────
-- Visible only to staff/processors, never to the applicant — enforced at
-- the application layer (no public read endpoint returns this table).
CREATE TABLE application_concerns (
  id                  TEXT NOT NULL PRIMARY KEY,
  application_id      TEXT NOT NULL,
  submitted_by_user_id TEXT NOT NULL,
  concern_text        TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES member_applications(id),
  FOREIGN KEY(submitted_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_application_concerns_application
  ON application_concerns(application_id, created_at, id);

-- ── Application communications & notes ────────────────────────────
-- The table distinguishes two write operations: a templated/free-form
-- email to the applicant (recorded here for the staff-only audit trail —
-- the email itself is queued via the existing email_outbox) and an internal
-- note (never emailed). Reusing member_application_events for either would
-- conflate "stage transition happened" with "someone wrote something", so
-- they get their own table with a `kind` discriminator instead.
CREATE TABLE application_communications (
  id             TEXT NOT NULL PRIMARY KEY,
  application_id TEXT NOT NULL,
  kind           TEXT NOT NULL,
  -- allowed: communication | note
  actor_user_id  TEXT NOT NULL,
  subject        TEXT,
  -- set for kind='communication' (templated or free-form email subject)
  body           TEXT NOT NULL,
  template_key   TEXT,
  -- set when kind='communication' was sent from a template
  email_outbox_id TEXT,
  -- set when kind='communication' — links to the queued email
  created_at     TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES member_applications(id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);

CREATE INDEX idx_application_communications_application
  ON application_communications(application_id, created_at, id);

-- ── Google Groups desired state + sync queue ─────────────────
-- Zero existing code for Google Groups sync prior to this migration. Every
-- trigger point (approval onboarding, WG join/leave, deactivation) writes a
-- row here; a processor (folded into the existing 15-minute due-work cron)
-- calls the Google Admin Directory API when service-account secrets are
-- configured, and leaves the row `pending` with a logged reason otherwise.
CREATE TABLE google_groups_membership_desired_state (
  user_id            TEXT NOT NULL,
  google_group_email TEXT NOT NULL,
  desired_action     TEXT NOT NULL,
  generation         INTEGER NOT NULL,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY(user_id, google_group_email),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE google_groups_sync_queue (
  id                TEXT NOT NULL PRIMARY KEY,
  user_id           TEXT NOT NULL,
  action            TEXT NOT NULL,
  -- allowed: add_to_list | remove_from_list
  google_group_email TEXT NOT NULL,
  idempotency_key   TEXT,
  generation        INTEGER,
  status            TEXT NOT NULL DEFAULT 'pending',
  -- allowed: pending | processing | completed | failed | superseded
  -- 'pending' also covers a row awaiting retry after a transient failure —
  -- next_attempt_at gates when it becomes claimable again (PR #1 review
  -- §9.1: bounded claim/retry/backoff/dead-letter instead of an immediate,
  -- unretried 'failed').
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  next_attempt_at   TEXT,
  processing_token  TEXT,
  lease_expires_at  TEXT,
  created_at        TEXT NOT NULL,
  processed_at      TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX idx_google_groups_sync_queue_due
  ON google_groups_sync_queue(next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX idx_google_groups_sync_queue_expired_lease
  ON google_groups_sync_queue(lease_expires_at)
  WHERE status = 'processing';
CREATE UNIQUE INDEX uq_google_groups_sync_queue_idempotency
  ON google_groups_sync_queue(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_google_groups_sync_queue_pair_order
  ON google_groups_sync_queue(user_id, google_group_email, generation)
  WHERE status IN ('pending', 'processing');
CREATE UNIQUE INDEX uq_google_groups_sync_queue_pair_generation
  ON google_groups_sync_queue(user_id, google_group_email, generation)
  WHERE generation IS NOT NULL;

-- One queue INSERT is the atomic desired-state transition. An ignored
-- idempotent INSERT fires no trigger and therefore cannot advance the desired
-- generation without a matching job. A new generation supersedes older local
-- work; if an already-issued Directory call returns late, the processor
-- reconciles the current desired generation after that external effect.
CREATE TRIGGER trg_google_groups_sync_queue_desired_state
AFTER INSERT ON google_groups_sync_queue
BEGIN
  INSERT INTO google_groups_membership_desired_state
    (user_id, google_group_email, desired_action, generation, updated_at)
  VALUES (NEW.user_id, NEW.google_group_email, NEW.action, 1, NEW.created_at)
  ON CONFLICT(user_id, google_group_email) DO UPDATE SET
    desired_action = excluded.desired_action,
    generation = google_groups_membership_desired_state.generation + 1,
    updated_at = excluded.updated_at;

  UPDATE google_groups_sync_queue
     SET generation = (
       SELECT generation FROM google_groups_membership_desired_state
        WHERE user_id = NEW.user_id AND google_group_email = NEW.google_group_email
     )
   WHERE id = NEW.id;

  UPDATE google_groups_sync_queue
     SET status = 'superseded', processed_at = NEW.created_at,
         next_attempt_at = NULL, processing_token = NULL, lease_expires_at = NULL
   WHERE user_id = NEW.user_id AND google_group_email = NEW.google_group_email
     AND id != NEW.id AND status IN ('pending', 'processing');
END;

-- ── Membership workflow settings ───────────────────────────────────
-- Single configurable row (id is always 'default') rather than a generic
-- key-value table — every setting is a distinct, typed field the
-- consultation/EC batch jobs and the admin settings screen both read
-- directly, and there is exactly one workflow-wide configuration, not a
-- per-entity one.
CREATE TABLE membership_settings (
  id                            TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
  consultation_window_days      INTEGER NOT NULL DEFAULT 7,
  ec_review_window_days         INTEGER NOT NULL DEFAULT 7,
  on_hold_response_deadline_days INTEGER NOT NULL DEFAULT 7,
  consultation_email_recipients TEXT NOT NULL DEFAULT 'consultation@lists.pkic.org',
  ec_email_recipients           TEXT NOT NULL DEFAULT 'ec@lists.pkic.org',
  cc_applicant_emails           TEXT NOT NULL DEFAULT 'members@pkic.org',
  auto_reminder_on_holds        INTEGER NOT NULL DEFAULT 1 CHECK (auto_reminder_on_holds IN (0, 1)),
  forum_vote_min_endorsers      INTEGER NOT NULL DEFAULT 0,
  updated_at                    TEXT NOT NULL,
  updated_by_user_id            TEXT,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id)
);

INSERT INTO membership_settings (id, updated_at) VALUES ('default', datetime('now'));

-- ── Email templates ────────────────────────────────────────────────
-- 14 net-new templates wired to a trigger in this stage, plus
-- existing-member-claim (seeded for schema completeness but not wired
-- to any trigger this stage actually calls — the Interim Admin Tool
-- deliberately sends no email).

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'application-hold-authority', 1,
    'Action needed on your PKI Consortium membership application',
    'Hi {{applicantName}},

Before we can continue reviewing your application, please confirm that you are authorized to represent {{organizationName}} as a PKI Consortium member.

Reply to this email or update your application: [Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-hold-org-email', 1,
    'Please resubmit with your organization email address',
    'Hi {{applicantName}},

The email address on your application appears to be a personal address rather than an organizational one. Please resubmit your application using your organization''s email domain.

[Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-hold-pki-experience', 1,
    'Additional information needed for your PKI Consortium application',
    'Hi {{applicantName}},

As an individual (H6) applicant, please provide additional detail about your PKI background and experience within the next {{deadlineDays}} days.

Reply to this email or update your application: [Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-hold-org-application', 1,
    'Please resubmit as an organizational member',
    'Hi {{applicantName}},

Based on your application, we believe you should apply as an organizational member rather than an individual. Please resubmit your application under the appropriate organizational category.

[Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-hold-information', 1,
    'We need more information about your PKI Consortium application',
    'Hi {{applicantName}},

{{requestDetails}}

Reply to this email or update your application: [Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-in-consultation', 1,
    'Your PKI Consortium application has entered member consultation',
    'Hi {{applicantName}},

Your application has moved into our member consultation period, during which current members may raise questions or concerns. This typically takes up to {{consultationWindowDays}} days.

[Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-declined', 1,
    'Update on your PKI Consortium membership application',
    'Hi {{applicantName}},

After review, we are unable to approve your PKI Consortium membership application at this time.{{#reason}}

{{reason}}{{/reason}}

If you have questions, please reply to this email.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-closed-no-response', 1,
    'Your PKI Consortium membership application has been closed',
    'Hi {{applicantName}},

We did not receive a response to our request within the {{deadlineDays}}-day window, so your application has been closed. You are welcome to reapply at any time.

If this was a mistake, please reply to this email.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'consultation-batch', 1,
    'PKI Consortium member consultation — {{applicationCount}} application(s)',
    'The following prospective member application(s) are open for consultation:

{{#applications}}
- {{maskedEmail}} — {{organizationName}} ({{membershipCategory}})
{{/applications}}

Members with concerns may reply to this list or submit a concern via the portal.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'ec-review-batch', 1,
    'PKI Consortium EC review — {{applicationCount}} application(s)',
    'The following prospective member application(s) are ready for Executive Council review:

{{#applications}}
- {{organizationName}} ({{membershipCategory}}) — [Review]({{reviewUrl}})
{{/applications}}

If no EC member records a decision within {{ecReviewWindowDays}} days, applications are auto-approved.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-approved-welcome', 1,
    'Welcome to the PKI Consortium!',
    'Hi {{applicantName}},

Congratulations — your PKI Consortium membership application has been approved!

[Log in to the portal]({{loginUrl}})
{{#workingGroups}}
Working groups joined: {{workingGroups}}
{{/workingGroups}}

We look forward to your participation.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'org-contact-assigned', 1,
    'You have been designated an organization contact',
    'Hi {{memberName}},

You have been designated the {{contactRole}} contact for your organization''s PKI Consortium profile. You can now submit organization profile changes for staff review.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'member-account-claim', 1,
    'Set up your PKI Consortium member account',
    'Hi {{memberName}},

Your PKI Consortium member account has been created. Use the link below to sign in for the first time:

[Sign in]({{loginUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'mailing-list-enrolled', 1,
    'You have been added to PKI Consortium mailing lists',
    'Hi {{memberName}},

You have been added to the following PKI Consortium mailing lists:

{{#lists}}
- {{.}}
{{/lists}}',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'wg-calendar-invite', 1,
    'You joined the {{workingGroupName}} working group',
    'Hi {{memberName}},

You have joined the {{workingGroupName}} working group. Meeting calendar invites will be sent separately once available.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'member_magic_link', 1,
    'Your PKI Consortium member sign-in link',
    'Use the secure link below to sign in. It expires in **{{expiresInMinutes}} minutes** and can only be used once.

[Sign in]({{magicLinkUrl}})

If you did not request this link, you can safely ignore this email.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'existing-member-claim', 1,
    'Claim your PKI Consortium member account',
    'Hi {{memberName}},

As part of our transition to the new PKI Consortium member portal, an account has been created for you. Use the link below to claim it:

[Claim your account]({{loginUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  );

-- Section: Secondary email addresses + user merge support
--
-- Follow-up to a real, visible problem from the YAML->D1 migration:
-- Google Groups roster CSVs used different email addresses than
-- people's canonical one, so a meaningful number of WG-roster-only emails
-- got their own bare `users` rows created rather than being recognized as
-- the same person -- real staff/members show up more than once in the
-- Users admin list, with no way to record "this account also goes by this
-- other email" or clean up the duplicates already sitting in D1.
--
-- `users.email`/`normalized_email` remain the sole login-identifying
-- columns (NOT NULL UNIQUE, unchanged) -- this table only adds
-- admin-visible/searchable alternate emails; it does not affect magic-link
-- or passkey authentication, which continue to resolve strictly off
-- `users.normalized_email`.
--
-- The merge tool built against this table reuses `users.merged_into_user_id`,
-- which already exists (migration 0020_pending_email_change.sql) for a
-- different collision scenario (registration email-change finalization) --
-- no new column needed there, just a second write path.

CREATE TABLE user_emails (
  id               TEXT NOT NULL PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  email            TEXT NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL
);

CREATE INDEX idx_user_emails_user ON user_emails(user_id);

-- Section: WG/forum vice chairs
--
-- Resolves two of the three gaps originally found during hands-on testing
-- (issues-to-resolve.md) — the third (an organization-level membership
-- category column) is superseded by consolidated migration 0035's
-- member_category_assignments table, which is the sole source of truth for
-- an aggregate's category from day one; there is no organizations.
-- membership_category column to add or backfill here.
--
-- 1. Working groups had no vice-chair concept — `wg_chair` is a single
--    system role assigned via `user_roles` (context_type='working_group'),
--    with no parallel for a vice chair. `role-wg_vice_chair` is seeded here
--    with the same permission bundle as `role-wg_chair` (a vice chair
--    should be able to fully stand in for the chair), reusing the exact
--    same user_roles mechanism — no new column or context_type needed.
--
-- 2. There was no PKIC-wide (forum-level) chair/vice-chair concept at all.
--    `role-forum_chair` / `role-forum_vice_chair` are seeded as global
--    roles (assigned with context_type/context_id both NULL, same as
--    role-admin/role-member) since there is only ever one forum. Neither
--    grants new permissions — the value of the role is the designation
--    itself (who holds the title), the same way `users.is_ec_member`
--    (consolidated migration 0035) is a pure designation with no permission bundle.

INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at) VALUES
  ('role-wg_vice_chair', 'wg_vice_chair', 'WG-scoped (assigned per WG) - stands in for the chair', 1, datetime('now'), datetime('now')),
  ('role-forum_chair', 'forum_chair', 'PKIC forum chair (global designation, no per-instance context)', 1, datetime('now'), datetime('now')),
  ('role-forum_vice_chair', 'forum_vice_chair', 'PKIC forum vice chair (global designation, no per-instance context)', 1, datetime('now'), datetime('now'));

INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES
  (lower(hex(randomblob(16))), 'role-wg_vice_chair', 'working-groups:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-wg_vice_chair', 'votes:create', datetime('now')),
  (lower(hex(randomblob(16))), 'role-wg_vice_chair', 'votes:manage', datetime('now'));

-- Section: Organization Profile Moderation & Managed
-- Mailing List Configuration
--
-- (the *workflow* half — the data-bearing half was pulled forward
-- by consolidated migration 0035; see that migration's own header.
-- No CHECK constraints, per this repo's standing convention
-- — allowed values are documented in `-- allowed:` comments and validated at
-- the application layer (Zod) instead.
--
-- Voting delegate is not a column here: it is a role-voting_delegate grant
-- in user_roles (consolidated migration 0035), the same organization-context mechanism
-- primary/secondary contact use, resolved with no separate fallback column.

ALTER TABLE organizations ADD COLUMN logo_staging_r2_key TEXT;
-- Pending logo awaiting moderation approval; promoted to logo_r2_key when
-- the review it's attached to is approved.

-- ── Secondary contact nomination ─────────────────────────────────────────
-- Workflow state (a pending nomination awaiting staff confirmation), not an
-- aggregate or representative fact — so it gets its own small table rather
-- than living on organizations or organization_representatives. One
-- pending nomination per organization at a time.
CREATE TABLE organization_secondary_contact_nominations (
  id                TEXT NOT NULL PRIMARY KEY,
  member_id         TEXT NOT NULL UNIQUE,
  -- the organization's aggregate row (members.id)
  nominated_user_id TEXT NOT NULL,
  nominated_by_user_id TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(nominated_user_id) REFERENCES users(id),
  FOREIGN KEY(nominated_by_user_id) REFERENCES users(id)
);

-- ── Organization content moderation queue ────────────────────────
CREATE TABLE organization_content_reviews (
  id                    TEXT NOT NULL PRIMARY KEY,
  organization_id       TEXT NOT NULL,
  submitted_by_user_id  TEXT NOT NULL,
  proposed_changes_json TEXT NOT NULL,
  -- snapshot of every changed field, { [field]: newValue }
  logo_staging_r2_key   TEXT,
  -- set when this submission includes a proposed logo change
  status                TEXT NOT NULL DEFAULT 'pending',
  -- allowed: pending | approved | rejected | withdrawn
  reviewer_user_id      TEXT,
  reviewer_note         TEXT,
  submitted_at          TEXT NOT NULL,
  reviewed_at           TEXT,
  transition_revision   INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES organizations(id),
  FOREIGN KEY(submitted_by_user_id) REFERENCES users(id),
  FOREIGN KEY(reviewer_user_id) REFERENCES users(id)
);

CREATE INDEX idx_org_content_reviews_org_status ON organization_content_reviews(organization_id, status);
CREATE INDEX idx_org_content_reviews_status ON organization_content_reviews(status, submitted_at);
CREATE UNIQUE INDEX uq_org_content_reviews_one_pending
  ON organization_content_reviews(organization_id)
  WHERE status = 'pending';

CREATE TABLE organization_content_review_transition_guards (
  id                TEXT NOT NULL PRIMARY KEY,
  review_id         TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  FOREIGN KEY(review_id) REFERENCES organization_content_reviews(id) ON DELETE CASCADE
);

CREATE TRIGGER trg_org_content_review_transition_guard_validate
BEFORE INSERT ON organization_content_review_transition_guards
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT transition_revision FROM organization_content_reviews WHERE id = NEW.review_id), -1)
         <> NEW.expected_revision
    THEN RAISE(ABORT, 'ORGANIZATION_CONTENT_REVIEW_CHANGED')
  END;
END;

CREATE TRIGGER trg_org_content_review_transition_guard_advance
AFTER INSERT ON organization_content_review_transition_guards
FOR EACH ROW
BEGIN
  UPDATE organization_content_reviews
  SET transition_revision = transition_revision + 1
  WHERE id = NEW.review_id;
  DELETE FROM organization_content_review_transition_guards WHERE id = NEW.id;
END;

CREATE TRIGGER trg_org_content_review_transition_revision
AFTER UPDATE ON organization_content_reviews
FOR EACH ROW
WHEN OLD.status IS NOT NEW.status
  OR OLD.logo_staging_r2_key IS NOT NEW.logo_staging_r2_key
  OR OLD.reviewer_user_id IS NOT NEW.reviewer_user_id
  OR OLD.reviewer_note IS NOT NEW.reviewer_note
  OR OLD.reviewed_at IS NOT NEW.reviewed_at
BEGIN
  UPDATE organization_content_reviews
  SET transition_revision = transition_revision + 1
  WHERE id = NEW.id;
END;

-- ── Managed mailing list configuration ─────────────────────────────
-- Replaces the hardcoded PKIC_ALL_MEMBERS_LIST/CONSULTATION_LIST constants
-- in membership-onboarding.ts, which had no staff-editable home before this.
-- Working-group lists keep working_groups.mailing_list_email as their
-- operational sync target —
-- the working_group_id rows below are seeded for inventory/visibility in
-- the unified Admin -> Mailing Lists screen only.
CREATE TABLE mailing_lists (
  id                        TEXT NOT NULL PRIMARY KEY,
  email                     TEXT NOT NULL UNIQUE,
  label                     TEXT NOT NULL,
  list_type                 TEXT NOT NULL,
  -- allowed: all_members | consultation | ec | working_group | custom
  working_group_id          TEXT REFERENCES working_groups(id),
  auto_sync_categories_json TEXT,
  -- JSON array of category letters, e.g. ["A","B","C","D","E","F","G"].
  -- Only consulted for list_type IN ('all_members','consultation') — see
  -- resolveAutoSyncListEmails in mailing-lists.ts. NULL means "every
  -- membership category" (used by the all_members list).
  active                    INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);

CREATE INDEX idx_mailing_lists_type_active ON mailing_lists(list_type, active);

-- Seeded on migration: the 9 known lists. working_group_id is
-- always NULL here, deliberately not resolved by a subquery against
-- working_groups at migration time — an earlier section seeds 6 canonical
-- working_groups rows (pqc/ca/tcwg/cm/pkimm/cbom) that would match, but
-- linking to them here would make these rows carry a real FK reference into
-- a table this codebase's test suite otherwise treats as ordinary per-test
-- business data (tests/helpers/reset-db.ts's own comment: "working_groups,
-- which tests already re-seed themselves when they need it"). Staff link
-- each working_group-type row to its working group via the admin UI
-- (PATCH .../admin/mailing-lists/:id) after migration instead.
INSERT INTO mailing_lists (id, email, label, list_type, working_group_id, auto_sync_categories_json, active, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'pkic@lists.pkic.org', 'All Members', 'all_members', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'consultation@lists.pkic.org', 'Member Consultation', 'consultation', NULL, '["A","B","C","D","E","F","G"]', 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'ec@lists.pkic.org', 'Executive Council', 'ec', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'pqc@lists.pkic.org', 'Post-Quantum Cryptography WG', 'working_group', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'ca@lists.pkic.org', 'Certificate Authority WG', 'working_group', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'tcwg@lists.pkic.org', 'Trust Chain WG', 'working_group', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'cm@lists.pkic.org', 'Certificate Management WG', 'working_group', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'pkimm@lists.pkic.org', 'PKI Maturity Model WG', 'working_group', NULL, NULL, 1, datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), 'cbom@lists.pkic.org', 'Crypto Bill of Materials WG', 'working_group', NULL, NULL, 1, datetime('now'), datetime('now'));

-- ── New email templates ──────────────────────────────────────────
-- org-contact-assigned already shipped with consolidated migration 0035 (wired to
-- application-approval onboarding). These three are net-new, wired to the
-- content moderation workflow this migration's tables support.
INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'org-content-submitted', 1,
    'Organization content change submitted for review — {{organizationName}}',
    'A content change has been submitted for **{{organizationName}}** by {{submitterName}}.

[Review the submission]({{reviewUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'org-content-approved', 1,
    'Your organization profile update was approved',
    'Hi {{contactName}},

The content changes you submitted for {{organizationName}}''s profile have been approved and are now live.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'org-content-rejected', 1,
    'Your organization profile update was not approved',
    'Hi {{contactName}},

The content changes you submitted for {{organizationName}}''s profile were not approved.

{{reviewerNote}}

You may revise and resubmit at any time.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  );

-- Section: Sponsorship Management
--
-- `sponsorships`/`sponsorship_events` are created earlier in this migration
-- forward for inquiry/checkout endpoints) with every column
-- schema calls for. What's still missing for the full sales-pipeline/
-- sponsor-portal feature:
--
-- 1. `organizations.sponsor_tier`/`sponsor_start_date` — written when a
--    consortium sponsorship goes active, cleared when it lapses.
-- 2. `event_sponsor_attendee_tiers` — per-event config of which sponsor
--    tiers get attendee-data access.
-- 3. `sponsor_portal_magic_links`/`sponsor_portal_sessions` — a sponsor
--    contact has no `users` row ("no separate account
--    required"), so the existing `auth_magic_links`/`sessions` tables
--    (both `user_id NOT NULL`) can't be reused the way member/admin auth
--    does. These are the same shape, scoped to `sponsorship_id` instead.
-- 4. Migrate the live `sponsors`/`sponsor_events` rows into
--    `sponsorships`/`sponsorship_events` (reconciled by `organization_id`
--    against anything already there), then drop the legacy tables,
--    that drop only happens "after the migration
--    is verified".
-- 5. New email templates (`sponsorship-renewal-reminder-60`/`-30`,
--    `sponsorship-lapsed-staff`, `sponsorship-active-confirmation`,
--    `sponsor-portal-access`) — `sponsorship-brochure`/`sponsorship-new-inquiry`
--    are seeded earlier in this migration.
--
-- No CHECK constraints, per this repo's standing convention — allowed
-- values are documented in `-- allowed:` comments and validated at the
-- application layer (Zod) instead.

-- ── organizations: active consortium sponsorship ("On active") ─────

ALTER TABLE organizations ADD COLUMN sponsor_tier TEXT;
-- Titanium/Diamond/Platinum/Gold/Silver, or NULL if not currently sponsoring.
ALTER TABLE organizations ADD COLUMN sponsor_start_date TEXT;

-- ── Per-event sponsor-tier attendee-data-access config ───────────

CREATE TABLE event_sponsor_attendee_tiers (
  id                       TEXT NOT NULL PRIMARY KEY,
  event_id                 TEXT NOT NULL REFERENCES events(id),
  tier_name                TEXT NOT NULL,
  has_attendee_data_access INTEGER NOT NULL DEFAULT 0 CHECK (has_attendee_data_access IN (0, 1)),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE(event_id, tier_name)
);

-- ── Sponsor portal auth (no `users` row — see header) ─────────────────────

CREATE TABLE sponsor_portal_magic_links (
  id              TEXT NOT NULL PRIMARY KEY,
  sponsorship_id  TEXT NOT NULL REFERENCES sponsorships(id),
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TEXT NOT NULL,
  used_at         TEXT,
  request_ip_hash TEXT,
  user_agent_hash TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE sponsor_portal_sessions (
  id             TEXT NOT NULL PRIMARY KEY,
  sponsorship_id TEXT NOT NULL REFERENCES sponsorships(id),
  token_hash     TEXT NOT NULL UNIQUE,
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX idx_sponsor_portal_sessions_sponsorship ON sponsor_portal_sessions(sponsorship_id);

-- ── Migrate live `sponsors`/`sponsor_events` rows first ───────
-- (must run before any future YAML-scan pass — see scripts/migrate-sponsors-yaml-to-d1.mjs
-- ). Reconciled by organization_id so re-running
-- this migration's logic (it isn't re-run — migrations apply once — but the
-- guard mirrors the YAML script's own idempotency) never double-inserts.

INSERT INTO sponsorships
  (id, sponsor_type, organization_id, tier, pipeline_stage, start_date, notes, created_at, updated_at)
SELECT lower(hex(randomblob(16))), 'consortium', s.organization_id, s.sponsorship_level,
       CASE s.status
         WHEN 'active' THEN 'active'
         WHEN 'pending' THEN 'new_inquiry'
         ELSE 'lapsed'
       END,
       NULL,
       CASE WHEN s.data_json IS NOT NULL THEN
         json_object(
           'legacySponsorData',
           CASE WHEN json_valid(s.data_json) THEN json(s.data_json) ELSE s.data_json END
         )
       ELSE NULL END,
       s.created_at, s.updated_at
FROM sponsors s
WHERE NOT EXISTS (
  SELECT 1 FROM sponsorships sp WHERE sp.organization_id = s.organization_id AND sp.sponsor_type = 'consortium'
);

UPDATE organizations
SET sponsor_tier = (
      SELECT s.sponsorship_level FROM sponsors s WHERE s.organization_id = organizations.id AND s.status = 'active'
    ),
    sponsor_start_date = (
      SELECT s.created_at FROM sponsors s WHERE s.organization_id = organizations.id AND s.status = 'active'
    )
WHERE id IN (SELECT organization_id FROM sponsors WHERE status = 'active');

INSERT INTO sponsorships
  (id, sponsor_type, organization_id, non_member_name, event_id, tier, pipeline_stage, start_date, notes,
   created_at, updated_at)
SELECT lower(hex(randomblob(16))), 'event', s.organization_id,
       CASE WHEN s.organization_id IS NULL THEN 'Legacy sponsor #' || se.sponsor_id ELSE NULL END,
       se.event_id, se.sponsorship_level,
       CASE se.status
         WHEN 'active' THEN 'active'
         WHEN 'pending' THEN 'payment_pending'
         ELSE 'lapsed'
       END,
       NULL,
       CASE
         WHEN s.data_json IS NOT NULL OR se.sponsorship_subject IS NOT NULL OR se.data_json IS NOT NULL THEN
           json_object(
             'legacySponsorData',
             CASE WHEN json_valid(s.data_json) THEN json(s.data_json) ELSE s.data_json END,
             'legacySponsorshipSubject', se.sponsorship_subject,
             'legacyEventData',
             CASE WHEN json_valid(se.data_json) THEN json(se.data_json) ELSE se.data_json END
           )
         ELSE NULL
       END,
       se.created_at, se.updated_at
FROM sponsor_events se
JOIN sponsors s ON s.id = se.sponsor_id
WHERE NOT EXISTS (
  SELECT 1 FROM sponsorships sp
  WHERE sp.event_id = se.event_id
    AND sp.sponsor_type = 'event'
    AND (sp.organization_id = s.organization_id OR (sp.organization_id IS NULL AND s.organization_id IS NULL))
);

-- No synthetic sponsorship_events audit rows are backfilled for these
-- migrated records — there's no reliable way from SQL alone to tell a
-- freshly-migrated sponsorships row apart from one that already existed
-- (both now satisfy the same WHERE NOT EXISTS guards above), and the
-- migration is a one-time, non-repeatable operation. sponsorship_events
-- starts recording history from the first real pipeline_stage change made
-- through the app after this migration runs, same as any other row created
-- directly by SQL rather than through createSponsorshipInquiry.

DROP TABLE sponsor_events;
DROP TABLE sponsors;

-- ── New email templates ───────────────────────────────────────────

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'sponsorship-renewal-reminder-60', 1,
    'Sponsorship renewal due in 60 days: {{organizationName}}',
    'The {{tier}} sponsorship for {{organizationName}} renews on {{renewalDate}} (60 days from now).

[View sponsorship]({{adminUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-renewal-reminder-30', 1,
    'Sponsorship renewal due in 30 days: {{organizationName}}',
    'The {{tier}} sponsorship for {{organizationName}} renews on {{renewalDate}} (30 days from now).

[View sponsorship]({{adminUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-lapsed-staff', 1,
    'Sponsorship lapsed: {{organizationName}}',
    'The {{tier}} sponsorship for {{organizationName}} passed its renewal date ({{renewalDate}}) with no renewal recorded and has been automatically marked lapsed.

[View sponsorship]({{adminUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-active-confirmation', 1,
    'Your PKI Consortium sponsorship is now active',
    'Hi {{contactName}},

Your {{tier}} sponsorship for {{organizationName}} is now active{{#startDate}} as of {{startDate}}{{/startDate}}. Thank you for supporting the PKI Consortium.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsor-portal-access', 1,
    'Access your sponsor portal',
    'Hi {{contactName}},

As a {{tier}} sponsor of {{eventName}}, you can view and export basic attendee information for attendees who agreed to share their details with sponsors.

[Access your sponsor portal]({{portalUrl}})

This link expires in {{expiresInMinutes}} minutes; you can request a new one at any time from the sponsor portal sign-in page.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  );

-- Section: Meeting Calendar Management
--
-- Replaces the static ICS files committed to the pkic/members Git repo with
-- a portal-managed system: meeting_series (one per recurring meeting, e.g.
-- "Main Consortium Meeting" or "PQC WG Meeting"), meeting_ics_files (one or
-- more time-slot variants per series, R2-backed), and
-- member_meeting_preferences (a member's chosen variant per series, NULL
-- meaning "send me all variants").
--
-- Enforcement policy (PR #1 review, §1.3): boolean-as-integer flags (`active`
-- below) get a DB CHECK. `scope_type` and other evolvable closed-state
-- vocabularies stay `-- allowed:` comments validated by a shared Zod schema
-- on every write path instead of a CHECK.

CREATE TABLE meeting_series (
  id                TEXT NOT NULL PRIMARY KEY,
  name              TEXT NOT NULL,
  scope_type        TEXT NOT NULL,
  -- allowed: consortium | working_group
  working_group_id  TEXT REFERENCES working_groups(id),
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_meeting_series_wg ON meeting_series(working_group_id);
CREATE INDEX idx_meeting_series_scope_active ON meeting_series(scope_type, active);

CREATE TABLE meeting_ics_files (
  id                   TEXT NOT NULL PRIMARY KEY,
  series_id            TEXT NOT NULL REFERENCES meeting_series(id),
  label                TEXT NOT NULL,
  -- e.g. '09:00 CET', '17:00 CET'
  year                 INTEGER NOT NULL,
  r2_key               TEXT NOT NULL,
  active               INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  uploaded_by_user_id  TEXT REFERENCES users(id),
  created_at           TEXT NOT NULL
);

CREATE INDEX idx_meeting_ics_files_series_active ON meeting_ics_files(series_id, active);
CREATE UNIQUE INDEX uq_meeting_ics_files_r2_key ON meeting_ics_files(r2_key);

CREATE TABLE member_meeting_preferences (
  id           TEXT NOT NULL PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  series_id    TEXT NOT NULL REFERENCES meeting_series(id),
  ics_file_id  TEXT REFERENCES meeting_ics_files(id),
  -- ics_file_id NULL means no preference (receives all variants)
  set_at       TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(user_id, series_id)
);

CREATE INDEX idx_member_meeting_preferences_user ON member_meeting_preferences(user_id);

-- ── Seed the initial meeting series ("Seeded on Migration") ─────────
-- Only meeting_series rows are seeded here — the actual ICS file content
-- (currently 9 files committed to pkic/members/meetings/) is not migrated
-- automatically; staff upload each variant via the new admin endpoints
-- after this migration runs, own "staff to verify exact file
-- count at migration time" note. Seeding fake meeting_ics_files rows with
-- placeholder r2_key values was considered and rejected — it would let a
-- staff admin flip one active before the real R2 upload happens, producing
-- a 404 on download.

INSERT INTO meeting_series (id, name, scope_type, working_group_id, active, created_at, updated_at)
VALUES (lower(hex(randomblob(16))), 'Main Consortium Meeting', 'consortium', NULL, 1, datetime('now'), datetime('now'));

INSERT INTO meeting_series (id, name, scope_type, working_group_id, active, created_at, updated_at)
SELECT lower(hex(randomblob(16))), wg.name || ' Meeting', 'working_group', wg.id, 1, datetime('now'), datetime('now')
FROM working_groups wg
WHERE wg.slug IN ('pqc', 'cbom', 'cm', 'tcwg', 'ca', 'pkimm');

-- ── New email templates ───────────────────────────────────────────

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'wg-calendar-invite', 1,
    'Calendar invite: {{workingGroupName}}',
    'Hi {{memberName}},

You have been added to the {{workingGroupName}} mailing list. Attached is the calendar invite for its recurring meeting — pick whichever time-slot variant works best for your time zone.

You can change your preferred time slot at any time in the portal under My Account → Calendar Invites.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'calendar-invite-resend', 1,
    'Updated calendar invite: {{seriesName}}',
    'Hi {{memberName}},

Attached is this year''s calendar invite for {{seriesName}}. {{#hasPreference}}This matches your saved time-slot preference.{{/hasPreference}}{{^hasPreference}}You have no saved time-slot preference, so all available variants are attached — pick whichever works best for you.{{/hasPreference}}

You can set or change your preference at any time in the portal under My Account → Calendar Invites.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  );

-- Section: Voting System
--
-- Adds the five tables Database Schema Additions calls for (votes,
-- vote_proposals, vote_proposal_endorsements, vote_candidates,
-- vote_ballots), matching the column lists with a small number of
-- necessary additions, flagged here the same way as sponsorships
-- initial sponsorship schema flagged its own two extra columns (see its
-- header):
--
--   * votes.threshold_type — there are three threshold
--     types (simple_majority / supermajority / successive_elimination) but
--     the schema block never gives `votes` a column to record which one
--     applies to a given vote. Added here; validated in the application
--     layer like every other enum-shaped column in this schema.
--   * votes.current_round / vote_ballots.round — successive-elimination
--     elections ("Round 1: all candidates... after each round the
--     candidate with fewest votes is eliminated... continues until one
--     candidate holds >50%") are described as a live, multi-round process,
--     but nothing in the schema block gives a ballot a round number or a
--     vote a "which round is open now" pointer. Both are added so each
--     round's ballots are independently countable and re-votable. See
--     votes.ts's own header for how round advancement is automated.
--   * vote_candidates.eliminated_round — records which round (if any)
--     eliminated a candidate, purely for result-display purposes.
--
-- No CHECK constraints, per this repo's standing convention — allowed
-- values are documented in `-- allowed:` comments and validated at the
-- application layer (Zod) instead.

CREATE TABLE votes (
  id                    TEXT NOT NULL PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  title                 TEXT NOT NULL,
  description           TEXT,
  vote_type             TEXT NOT NULL,
  -- allowed: election | motion | consultation
  scope_type            TEXT NOT NULL,
  -- allowed: forum | working_group
  scope_id              TEXT REFERENCES working_groups(id),
  -- NULL for forum scope; working_groups.id for working_group scope
  created_by_user_id    TEXT REFERENCES users(id),
  proposed_by_user_id   TEXT REFERENCES users(id),
  -- set when converted from an endorsed member proposal; NULL for direct
  -- staff/chair creation
  source_proposal_id    TEXT UNIQUE,
  -- set by convertProposalToVote (proposals.ts) alongside proposed_by_user_id.
  -- UNIQUE structurally enforces "a proposal converts to at most one vote,
  -- ever" — the compare-and-set on vote_proposals.status guards the normal
  -- path, this is the backstop for a lost race (PR #1 review §5.4).
  -- Deliberately no REFERENCES vote_proposals(id): that would form a real
  -- FK cycle with vote_proposals.vote_id -> votes.id (a converted pair
  -- points at each other), which no bulk per-table DELETE order can
  -- satisfy — every write path only ever sets this to the id of the
  -- proposal row being converted in the very same db.batch(), so the
  -- application layer, not a declared FK, is what keeps it valid.
  eligible_categories   TEXT,
  -- JSON array of membership category letters entitled to a ballot beyond
  -- the standing A-G/WG-membership rules; NULL means "all A-G per the
  -- standing rules, no further restriction"
  threshold_type        TEXT NOT NULL,
  -- allowed: simple_majority | supermajority | successive_elimination
  opens_at              TEXT NOT NULL,
  closes_at             TEXT NOT NULL,
  current_round         INTEGER NOT NULL DEFAULT 1,
  transition_revision   INTEGER NOT NULL DEFAULT 0,
  transition_processing_token TEXT,
  transition_lease_expires_at TEXT,
  status                TEXT NOT NULL,
  -- allowed: scheduled | open | closed | cancelled
  result_json           TEXT,
  visibility             TEXT NOT NULL DEFAULT 'private',
  -- allowed: private | public
  public_detail_level   TEXT NOT NULL DEFAULT 'aggregate',
  -- allowed: outcome_only | aggregate | full_breakdown
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX idx_votes_scope ON votes(scope_type, scope_id);
CREATE INDEX idx_votes_status_opens_at ON votes(status, opens_at, id);
CREATE INDEX idx_votes_status_closes_at ON votes(status, closes_at, id);
CREATE INDEX idx_votes_visibility ON votes(visibility, closes_at);

CREATE TABLE vote_candidates (
  id                   TEXT NOT NULL PRIMARY KEY,
  vote_id              TEXT NOT NULL REFERENCES votes(id),
  user_id              TEXT REFERENCES users(id),
  -- NULL for external/non-portal candidates
  candidate_name       TEXT NOT NULL,
  candidate_bio        TEXT,
  nominated_by_user_id TEXT REFERENCES users(id),
  sort_order           INTEGER NOT NULL DEFAULT 0,
  eliminated_round     INTEGER,
  -- set by successive-elimination tallying; NULL while still standing
  created_at           TEXT NOT NULL
);

CREATE INDEX idx_vote_candidates_vote ON vote_candidates(vote_id);
CREATE INDEX idx_vote_candidates_standing
  ON vote_candidates(vote_id, sort_order, id)
  WHERE eliminated_round IS NULL;

CREATE TABLE vote_ballots (
  id              TEXT NOT NULL PRIMARY KEY,
  vote_id         TEXT NOT NULL REFERENCES votes(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT REFERENCES organizations(id),
  -- forum-level: set (the org whose delegate cast this ballot); NULL for
  -- working_group-level ballots
  choice          TEXT NOT NULL,
  -- motion/consultation: in_favor | opposed | abstain
  -- election: a vote_candidates.id
  round           INTEGER NOT NULL DEFAULT 1,
  submitted_at    TEXT NOT NULL,
  ip_hash         TEXT
);

-- Cover scheduled tally aggregation without loading every ballot row or
-- returning to the table for each choice.
CREATE INDEX idx_vote_ballots_vote_round ON vote_ballots(vote_id, round, choice);
-- Cover the staff ballot audit's bounded default order without sorting every
-- ballot for the vote before applying LIMIT/OFFSET.
CREATE INDEX idx_vote_ballots_vote_audit_page
  ON vote_ballots(vote_id, round, submitted_at, id);
-- Forum-level: one ballot per organization per round.
CREATE UNIQUE INDEX idx_vote_ballots_org_round ON vote_ballots(vote_id, organization_id, round)
  WHERE organization_id IS NOT NULL;
-- Working-group-level: one ballot per person per round.
CREATE UNIQUE INDEX idx_vote_ballots_user_round ON vote_ballots(vote_id, user_id, round)
  WHERE organization_id IS NULL;

-- Cover the set-based forum-recipient snapshot without scanning inactive or
-- individual membership aggregates on every vote opening/round transition.
CREATE INDEX idx_members_active_organization_notifications
  ON members(organization_id, id)
  WHERE status = 'active' AND organization_id IS NOT NULL;

-- Immutable event-time recipient snapshots. These are created atomically with
-- the vote opening/round transition, so a later close, round advance, role
-- change, or queue-worker failure cannot erase the notification obligation.
CREATE TABLE vote_delegate_notification_intents (
  vote_id          TEXT NOT NULL REFERENCES votes(id),
  round            INTEGER NOT NULL,
  organization_id  TEXT NOT NULL,
  delegate_user_id TEXT NOT NULL,
  recipient_email  TEXT NOT NULL,
  delegate_name    TEXT NOT NULL,
  organization_name TEXT NOT NULL,
  vote_title       TEXT NOT NULL,
  closes_at        TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  queued_outbox_id TEXT,
  queued_at        TEXT,
  PRIMARY KEY (vote_id, round, organization_id)
);

CREATE INDEX idx_vote_delegate_notification_intents_pending
  ON vote_delegate_notification_intents(created_at, vote_id, round, organization_id)
  WHERE queued_outbox_id IS NULL;

CREATE UNIQUE INDEX uq_vote_delegate_notification_intents_outbox
  ON vote_delegate_notification_intents(queued_outbox_id)
  WHERE queued_outbox_id IS NOT NULL;

CREATE TABLE vote_proposals (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  vote_type           TEXT NOT NULL,
  -- allowed: election | motion | consultation
  scope_type          TEXT NOT NULL,
  -- allowed: forum | working_group
  scope_id            TEXT REFERENCES working_groups(id),
  proposed_by_user_id TEXT NOT NULL REFERENCES users(id),
  eligible_categories TEXT,
  proposed_opens_at   TEXT,
  proposed_closes_at  TEXT,
  status              TEXT NOT NULL,
  -- allowed: open_for_endorsement | endorsed | rejected | withdrawn | converted_to_vote
  vote_id             TEXT REFERENCES votes(id),
  rejection_reason    TEXT,
  transition_revision INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_vote_proposals_scope_status ON vote_proposals(scope_type, scope_id, status);

-- Supports both the bounded portal list (status + scope, ordered by
-- created_at) and the bounded admin list (status alone, ordered by
-- created_at) via a shared leading (status) column.
CREATE INDEX idx_vote_proposals_status_scope_created_at
  ON vote_proposals(status, scope_type, scope_id, created_at);

-- D1 batches are atomic but the validation reads used to plan a batch occur
-- before it starts. Advance a proposal revision at the beginning of every
-- planned mutation so stale endorsement, withdrawal, approval, and rejection
-- batches abort before writing any state, audit, or email side effect.
CREATE TABLE vote_proposal_transition_guards (
  id                TEXT NOT NULL PRIMARY KEY,
  proposal_id       TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  FOREIGN KEY(proposal_id) REFERENCES vote_proposals(id) ON DELETE CASCADE
);

CREATE TRIGGER trg_vote_proposal_transition_guard_validate
BEFORE INSERT ON vote_proposal_transition_guards
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT transition_revision FROM vote_proposals WHERE id = NEW.proposal_id), -1)
         <> NEW.expected_revision
    THEN RAISE(ABORT, 'VOTE_PROPOSAL_CHANGED')
  END;
END;

CREATE TRIGGER trg_vote_proposal_transition_guard_advance
AFTER INSERT ON vote_proposal_transition_guards
FOR EACH ROW
BEGIN
  UPDATE vote_proposals
  SET transition_revision = transition_revision + 1
  WHERE id = NEW.proposal_id;
  DELETE FROM vote_proposal_transition_guards WHERE id = NEW.id;
END;

CREATE TRIGGER trg_vote_proposal_transition_revision
AFTER UPDATE OF status, vote_id, rejection_reason ON vote_proposals
FOR EACH ROW
WHEN OLD.status IS NOT NEW.status
  OR OLD.vote_id IS NOT NEW.vote_id
  OR OLD.rejection_reason IS NOT NEW.rejection_reason
BEGIN
  UPDATE vote_proposals
  SET transition_revision = transition_revision + 1
  WHERE id = NEW.id;
END;

CREATE TABLE vote_proposal_endorsements (
  id               TEXT PRIMARY KEY,
  proposal_id      TEXT NOT NULL REFERENCES vote_proposals(id),
  endorser_user_id TEXT NOT NULL REFERENCES users(id),
  endorsed_at      TEXT NOT NULL,
  UNIQUE(proposal_id, endorser_user_id)
);

CREATE INDEX idx_vote_proposal_endorsements_proposal ON vote_proposal_endorsements(proposal_id);

-- ── New email templates ────────────────────────────────────────────

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'forum-vote-delegate-notify', 1,
    'Forum vote open: {{voteTitle}}',
    'Hi {{delegateName}},

A forum-level vote is now open and, as {{organizationName}}''s voting delegate, you are the one who casts its ballot: "{{voteTitle}}".

Voting closes {{closesAt}}. Cast your organization''s ballot in the portal at {{voteUrl}}.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'vote-proposal-rejected', 1,
    'Your vote proposal was not approved: {{proposalTitle}}',
    'Hi {{proposerName}},

Your proposed vote "{{proposalTitle}}" was not approved.

Reason: {{rejectionReason}}

You may submit a revised proposal at any time.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  );

-- Section: Notification preferences (Member Portal Navigation
-- Structure "Account Settings" row)
--
-- Account Settings nav section lists "notification preferences"
-- alongside passkeys, but no table/column existed anywhere for it.
-- A single JSON column on `users` (rather than a new table) matches
-- this codebase's existing convention for small per-user preference blobs (see
-- `users.links_json`) and avoids the reset-db special-casing a new FK'd
-- table would need (`membership_settings`).
--
-- No CHECK constraint, per this repo's standing convention (migration
-- 0033's header) — the shape is validated at the application
-- layer (assets/shared/schemas/me.ts) on write.

ALTER TABLE users ADD COLUMN notification_preferences_json TEXT;

-- Section: `member_since` column for members
--
-- data/members/*.yaml's `memberSince` key (how long an organization or
-- individual has been a PKIC member) had nowhere real to land: the
-- migration script never read it, and the Interim Admin Tool's
-- "Add organization" form already collects a `memberSince` date from staff
-- but silently drops it — there is no column to write it to, so every
-- org/individual's public/self-service "member since" value has actually
-- just been `members.created_at` (the D1 row's insert time, not the real
-- historical join date).
--
-- One column, on `members` — the aggregate row already exists for both
-- org-tied and org-less members (migration 0000), so there is no separate
-- `organizations.member_since` to keep in sync with it. Read paths fall
-- back to `members.created_at` when unset (pre-existing rows, or a caller
-- that doesn't supply one).
ALTER TABLE members ADD COLUMN member_since TEXT;

-- Section: organization slug
-- Clean-URL slug for public organization/member profile pages
-- (`/members/<slug>` instead of `/members/profile/?id=<uuid>`).
--
-- The legacy Hugo member YAML files (`data/members/*.yaml`) each carry a
-- top-level `id:` key (e.g. `id: keyfactor`) that scripts/migrate-members-
-- yaml-to-d1.mjs previously only used transiently for logo/photo directory
-- lookups, never persisting it. This column gives it a permanent home so
-- the migration script (and, later, admin-authored orgs) can back a stable,
-- human-readable public URL. Individuals (H5/H6/H7, no `organizations` row)
-- are out of scope here — they keep UUID-keyed profile URLs.
ALTER TABLE organizations ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX idx_organizations_slug ON organizations(slug) WHERE slug IS NOT NULL;

-- Section: wg chair membership digest
-- Weekly working-group membership-change digest for WG chairs/vice-chairs
-- (2026-07-31 manual-testing feedback). "Send an email to the chairs when
-- someone joins or leaves the working group... not a spam email every time
-- there is a change" — batched weekly, one email per (working group, chair)
-- pair, only for groups with at least one join/leave in the past 7 days.
-- See functions/_lib/services/wg-chair-digest.ts.
--
-- No schema change needed for the opt-out preference itself — it's a new
-- key (`wgChairMembershipDigest`, default true) on the existing
-- `users.notification_preferences_json` blob added by consolidated migration 0035, per
-- that migration's own "no CHECK constraint, validated at the application
-- layer" convention. This migration only seeds the email template.

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES (
  lower(hex(randomblob(16))), 'wg-chair-membership-digest', 1,
  '{{workingGroupName}} — weekly membership update',
  'Hi {{recipientName}},

Here is a summary of {{workingGroupName}} membership changes over the past week:

{{#joined}}
+ {{name}} ({{organizationName}}) joined
{{/joined}}
{{#left}}
- {{name}} ({{organizationName}}) left
{{/left}}

You are receiving this because you are the {{recipientRole}} of this working group. You can turn this off any time in your portal Account Settings under Notification preferences.',
  'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
);

-- Section: leadership positions
-- Board of Directors / Executive Council positions, admin-managed
--
-- Replaces the hand-maintained `content/about/board.md` and
-- `content/about/executive-council.md` static markdown (manual `person-card`
-- shortcode lists) with a D1-backed roster, following the same pattern
-- consolidated migration 0035 established for WG/forum chairs: admin-assigned, publicly
-- readable, rendered client-side by a widget instead of requiring a git
-- commit to change.
--
-- Board/EC don't fit the existing `roles`/`user_roles` mechanism used for
-- chairs: that model assumes at most one active holder per (role, context)
-- (see Chairs.tsx / admin-working-groups.ts's ROW_NUMBER() pick), has no
-- "from" date distinct from `created_at`, and has no way to carry a
-- free-text title ("Board Chair", "EC Member", "PKI Consortium Chair" —
-- the exact title used for a person varies per body, not a fixed
-- chair/vice-chair pair). Board/EC need many simultaneous holders, an
-- explicit admin-set start date (frequently backdated to match historical
-- terms), and an arbitrary display title. A dedicated table is simpler than
-- widening `user_roles` for a shape it wasn't designed for.
CREATE TABLE leadership_positions (
  id         TEXT NOT NULL PRIMARY KEY,
  -- The canonical vocabulary is validated by leadershipBodySchema. Keep
  -- this evolvable in application code: D1 cannot alter a CHECK without a
  -- table rebuild when a future consortium body is added.
  body       TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  -- Explicitly records which membership the person represents for this
  -- position. NULL is an intentional "no affiliation" choice; never infer
  -- one from an arbitrary first organization at read time.
  member_id  TEXT,
  title      TEXT NOT NULL,
  starts_at  TEXT NOT NULL,
  ends_at    TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(member_id) REFERENCES members(id)
);

CREATE INDEX idx_leadership_positions_body ON leadership_positions(body, ends_at);
CREATE INDEX idx_leadership_positions_user ON leadership_positions(user_id);
CREATE INDEX idx_leadership_positions_member ON leadership_positions(member_id);

-- Section: sponsorship tier config
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
-- config feeds) are defined directly in this migration's initial
-- sponsorships table, not added here.

-- A sent invite is a single active capability per event, address, and purpose.
-- Resolve any legacy duplicates deterministically before enforcing the invariant.
UPDATE invites
SET status = 'revoked'
WHERE status = 'sent'
  AND EXISTS (
    SELECT 1
    FROM invites keeper
    WHERE keeper.event_id = invites.event_id
      AND keeper.invitee_email = invites.invitee_email
      AND keeper.invite_type = invites.invite_type
      AND keeper.status = 'sent'
      AND (keeper.created_at < invites.created_at OR (keeper.created_at = invites.created_at AND keeper.id < invites.id))
  );

CREATE UNIQUE INDEX uq_invites_active_recipient
  ON invites(event_id, invitee_email, invite_type)
  WHERE status = 'sent';

-- SQLite considers NULL values distinct inside a UNIQUE table constraint, so
-- the original (email, channel, scope_type, scope_ref) constraint did not make
-- global unsubscribes (scope_ref IS NULL) idempotent. Preserve the oldest row
-- for each semantic scope, then enforce the invariant without rebuilding the
-- table or changing its evolvable channel vocabulary.
DELETE FROM unsubscribes
WHERE EXISTS (
  SELECT 1
  FROM unsubscribes keeper
  WHERE lower(keeper.email) = lower(unsubscribes.email)
    AND keeper.channel = unsubscribes.channel
    AND keeper.scope_type = unsubscribes.scope_type
    AND COALESCE(keeper.scope_ref, '') = COALESCE(unsubscribes.scope_ref, '')
    AND (keeper.created_at < unsubscribes.created_at OR (keeper.created_at = unsubscribes.created_at AND keeper.id < unsubscribes.id))
);

CREATE UNIQUE INDEX uq_unsubscribes_semantic_scope
  ON unsubscribes(lower(email), channel, scope_type, COALESCE(scope_ref, ''));

-- Promoter creation is read-mostly but may be requested concurrently by the
-- webhook, admin reconciliation, and donor browser. Enforce the aggregate
-- invariant in D1 rather than relying on a read-then-insert race.
-- Historical races may already have produced more than one code. Keep every
-- old code/link/click/referral usable, but retain ownership on only the oldest
-- row; the other codes become ordinary advocate aliases instead of deleting
-- or rewriting attribution data.
UPDATE donation_promoters
SET donation_id = NULL
WHERE donation_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM donation_promoters keeper
    WHERE keeper.donation_id = donation_promoters.donation_id
      AND (
        keeper.created_at < donation_promoters.created_at
        OR (keeper.created_at = donation_promoters.created_at AND keeper.code < donation_promoters.code)
      )
  );

CREATE UNIQUE INDEX uq_donation_promoters_donation
  ON donation_promoters(donation_id)
  WHERE donation_id IS NOT NULL;

-- Event statistics join attendance history through registration_id and order
-- recent changes by changed_at. Without this index, every event dashboard
-- scans the complete cross-event history table in D1.
CREATE INDEX IF NOT EXISTS idx_registration_attendance_history_registration_changed
  ON registration_attendance_history(registration_id, changed_at DESC);

-- An admin badge choice is policy over the derived participant roles, not a
-- synthetic participant. Keeping it separate preserves proposal/participant
-- provenance and makes the override remain effective if those roles change.
CREATE TABLE registration_badge_role_overrides (
  registration_id TEXT NOT NULL PRIMARY KEY,
  role             TEXT NOT NULL,
  set_by_user_id   TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  FOREIGN KEY(registration_id) REFERENCES registrations(id),
  FOREIGN KEY(set_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_registration_badge_role_overrides_set_by
  ON registration_badge_role_overrides(set_by_user_id);

-- R2 deletes are external effects and cannot be committed atomically with a
-- D1 pointer change. Record the intent in the same D1 batch, then let the
-- request and bounded scheduled worker retry the idempotent object deletion.
CREATE TABLE storage_deletion_outbox (
  id              TEXT NOT NULL PRIMARY KEY,
  bucket          TEXT NOT NULL,
  object_key      TEXT NOT NULL,
  status          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT,
  processing_token TEXT,
  lease_expires_at TEXT,
  UNIQUE(bucket, object_key)
);

CREATE INDEX idx_storage_deletion_outbox_due
  ON storage_deletion_outbox(next_attempt_at, created_at, id)
  WHERE status IN ('queued', 'retrying');
CREATE INDEX idx_storage_deletion_outbox_expired_lease
  ON storage_deletion_outbox(lease_expires_at, created_at, id)
  WHERE status = 'deleting';

-- An upload may only become durable while its pre-registered compensation
-- row is still queued and unclaimed. The transient guard makes that check
-- and cancellation one atomic statement inside the caller's D1 batch.
CREATE TABLE storage_upload_commit_guards (
  id         TEXT NOT NULL PRIMARY KEY,
  bucket     TEXT NOT NULL,
  object_key TEXT NOT NULL
);

CREATE TRIGGER validate_storage_upload_commit_guard
BEFORE INSERT ON storage_upload_commit_guards
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM storage_deletion_outbox
      WHERE bucket = NEW.bucket
        AND object_key = NEW.object_key
        AND status IN ('queued', 'retrying')
        AND processing_token IS NULL
    )
    THEN RAISE(ABORT, 'STORAGE_UPLOAD_COMPENSATION_UNAVAILABLE')
  END;
END;

CREATE TRIGGER apply_storage_upload_commit_guard
AFTER INSERT ON storage_upload_commit_guards
FOR EACH ROW
BEGIN
  DELETE FROM storage_deletion_outbox
  WHERE bucket = NEW.bucket
    AND object_key = NEW.object_key
    AND status IN ('queued', 'retrying')
    AND processing_token IS NULL;
  DELETE FROM storage_upload_commit_guards WHERE id = NEW.id;
END;

-- Badge rendering writes to R2 and therefore cannot be committed atomically
-- with its admin audit record. Persist the render intent in D1 first, then let
-- the request and scheduled worker retry the idempotent R2 overwrite.
CREATE TABLE badge_render_jobs (
  id              TEXT NOT NULL PRIMARY KEY,
  referral_code   TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL,
  requested_generation INTEGER NOT NULL DEFAULT 1,
  claimed_generation INTEGER,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  rendered_at     TEXT,
  processing_token TEXT,
  lease_expires_at TEXT,
  FOREIGN KEY(referral_code) REFERENCES referral_codes(code)
);

CREATE INDEX idx_badge_render_jobs_due
  ON badge_render_jobs(next_attempt_at, created_at, id)
  WHERE status IN ('queued', 'retrying');
CREATE INDEX idx_badge_render_jobs_expired_lease
  ON badge_render_jobs(lease_expires_at, created_at, id)
  WHERE status = 'rendering';

-- Both attendee exports filter consent by registration and term. Without this
-- index, the correlated lookup scans the complete consent table per row.
CREATE INDEX IF NOT EXISTS idx_consent_acceptances_registration_term
  ON consent_acceptances(registration_id, term_key)
  WHERE registration_id IS NOT NULL;

-- Admin attendee export filters by event/status and emits chronological rows.
CREATE INDEX IF NOT EXISTS idx_registrations_event_status_created
  ON registrations(event_id, status, created_at);

-- The form response read model excludes registrations/proposals that already
-- have normalized answers. Match the complete correlated lookup so D1 does
-- not rescan every submission for the form once per legacy source row.
CREATE INDEX IF NOT EXISTS idx_form_submissions_form_context
  ON form_submissions(form_id, context_type, context_ref);

-- Proposal review decisions may request changes and then be followed by a
-- revised submission. Keep the current round on the existing rows so the
-- established proposal/reviewer uniqueness constraints remain useful, while
-- retaining every decision in an append-only history table. This avoids
-- rebuilding any deployed proposal table merely to remove its original
-- one-current-decision UNIQUE constraint.
ALTER TABLE session_proposals ADD COLUMN review_round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE proposal_reviews ADD COLUMN review_round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE proposal_decisions ADD COLUMN review_round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE proposal_decisions ADD COLUMN decision_sequence INTEGER NOT NULL DEFAULT 1;

CREATE TABLE proposal_decision_history (
  id                   TEXT    NOT NULL PRIMARY KEY,
  proposal_id          TEXT    NOT NULL,
  review_round         INTEGER NOT NULL,
  decided_by_user_id   TEXT    NOT NULL,
  final_status         TEXT    NOT NULL,
  decision_note        TEXT,
  min_reviews_required INTEGER NOT NULL,
  review_count         INTEGER NOT NULL,
  decided_at           TEXT    NOT NULL,
  decision_sequence    INTEGER NOT NULL,
  UNIQUE(proposal_id, review_round, decision_sequence),
  FOREIGN KEY(proposal_id) REFERENCES session_proposals(id),
  FOREIGN KEY(decided_by_user_id) REFERENCES users(id)
);

CREATE TABLE proposal_review_history (
  decision_id       TEXT    NOT NULL,
  proposal_id       TEXT    NOT NULL,
  review_round      INTEGER NOT NULL,
  review_id         TEXT    NOT NULL,
  reviewer_user_id  TEXT    NOT NULL,
  recommendation   TEXT    NOT NULL,
  score             INTEGER,
  reviewer_comment  TEXT,
  applicant_note    TEXT,
  reviewed_at       TEXT    NOT NULL,
  captured_at       TEXT    NOT NULL,
  PRIMARY KEY(decision_id, review_id),
  FOREIGN KEY(decision_id) REFERENCES proposal_decision_history(id),
  FOREIGN KEY(proposal_id) REFERENCES session_proposals(id),
  FOREIGN KEY(reviewer_user_id) REFERENCES users(id)
);

INSERT INTO proposal_decision_history (
  id, proposal_id, review_round, decided_by_user_id, final_status,
  decision_note, min_reviews_required, review_count, decided_at, decision_sequence
)
SELECT id, proposal_id, review_round, decided_by_user_id, final_status,
       decision_note, min_reviews_required, review_count, decided_at, decision_sequence
FROM proposal_decisions;

INSERT INTO proposal_review_history (
  decision_id, proposal_id, review_round, review_id, reviewer_user_id,
  recommendation, score, reviewer_comment, applicant_note, reviewed_at, captured_at
)
SELECT pdh.id, pr.proposal_id, pr.review_round, pr.id, pr.reviewer_user_id,
       pr.recommendation, pr.score, pr.reviewer_comment, pr.applicant_note,
       pr.updated_at, pdh.decided_at
FROM proposal_decision_history pdh
JOIN proposal_reviews pr
  ON pr.proposal_id = pdh.proposal_id AND pr.review_round = pdh.review_round;

CREATE INDEX idx_proposal_reviews_proposal_round
  ON proposal_reviews(proposal_id, review_round);

-- Keep the common live/deleted event proposal pages index-backed without
-- forcing D1 to sort or scan proposals from unrelated events.
CREATE INDEX idx_session_proposals_event_live_submitted
  ON session_proposals(event_id, submitted_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_session_proposals_event_deleted_submitted
  ON session_proposals(event_id, submitted_at DESC, id)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_proposal_decision_history_proposal_round
  ON proposal_decision_history(proposal_id, review_round DESC, decision_sequence DESC);

PRAGMA foreign_keys = ON;
