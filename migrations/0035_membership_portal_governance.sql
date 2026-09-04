-- Consolidated migration 0035: Membership portal, governance, and sponsorship architecture
--
-- This is the single authoritative migration for the membership-portal work.
-- The component migrations were never applied to preview or production, so
-- their final schemas, required legacy-data conversions, indexes, and seed data
-- are kept together here. Legacy members and organizations are extended only
-- with additive columns/relationship tables; neither table is rebuilt.

-- Section: Membership category reference table
--
-- The structural A-G/H1-H8 category-code vocabulary and individual-category
-- classification are centralized in the shared schema. This reference table
-- makes those codes FK-backed while D1 remains the single source of truth for
-- editable labels, descriptions, ordering, and voting policy. Codes use an FK,
-- not a CHECK constraint, so a future reviewed category migration does not
-- require rebuilding members or organizations (PR #1 review). Individual
-- classification is deliberately not stored here: all membership workflows
-- derive it from the shared structural vocabulary, avoiding a second source.
--
-- Created first, before any dependent table, so every later table that
-- references a category code (member_applications, member_category_
-- assignments) can declare the FK in its own initial CREATE TABLE — no
-- rebuild required anywhere in this schema.

-- Email sign-in capabilities are signed at delivery and redeemed exactly
-- once through audit_log.idempotency_key. No usable credential or issued-link
-- row is persisted, so the legacy pre-redemption table is no longer needed.
DROP TABLE auth_magic_links;

CREATE TABLE membership_categories (
  code         TEXT NOT NULL PRIMARY KEY,
  label        TEXT NOT NULL,
  description  TEXT,
  display_order INTEGER NOT NULL,
  is_voting     INTEGER NOT NULL DEFAULT 0 CHECK (is_voting IN (0, 1)),
  -- configurable consortium and group voting rights; D1 is the policy source
  revision      INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO membership_categories
  (code, label, description, display_order, is_voting)
VALUES
  ('A', 'Certification Authorities and Trust Service Providers', 'Included on a trust list maintained by the PKI Consortium.', 10, 1),
  ('B', 'Trust list supervisory entities', 'Entities that supervise and maintain a list contained in a PKI Consortium trust list.', 20, 1),
  ('C', 'Industry regulators and supervisory bodies', NULL, 30, 1),
  ('D', 'Conformity assessment bodies and auditors', NULL, 40, 1),
  ('E', 'Standards developing organizations', NULL, 50, 1),
  ('F', 'PKI or cryptographic software and device providers', NULL, 60, 1),
  ('G', 'Relying-party software providers', NULL, 70, 1),
  ('H1', 'Government entities with a general PKI or cryptography interest', 'For entities that do not fall under category C.', 80, 0),
  ('H2', 'PKI or cryptography consultancy organizations', NULL, 90, 0),
  ('H3', 'PKI or cryptography research organizations', NULL, 100, 0),
  ('H4', 'Universities with PKI or cryptography programs', NULL, 110, 0),
  ('H5', 'PhD students researching PKI or cryptography', 'Requires an institutional or university email address.', 120, 0),
  ('H6', 'Unaffiliated independent PKI or cryptography consultants', 'For qualified consultants who are not affiliated with any organization.', 130, 0),
  ('H7', 'Unaffiliated independent PKI or cryptography researchers', 'For qualified researchers who are not affiliated with any organization.', 140, 0),
  ('H8', 'Private PKI operators', 'Organizations operating a private PKI governed by formal policies and practices.', 150, 0);

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

CREATE INDEX idx_audit_log_created_at
  ON audit_log(created_at DESC, id);

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

-- Co-speaker invitation eligibility is bounded by the owning event. NULL is
-- retained only for pre-branch rows and is interpreted as the event start by
-- the shared domain policy; every new or renewed invitation stores the
-- resolved deadline explicitly.
ALTER TABLE proposal_speakers ADD COLUMN invite_expires_at TEXT;

DROP INDEX idx_proposal_speakers_speaker_invite_reminder_due;
CREATE INDEX idx_proposal_speakers_speaker_invite_reminder_due
  ON proposal_speakers(COALESCE(speaker_invite_last_communication_at, created_at), id,
                       invite_expires_at, speaker_invite_reminder_count,
                       speaker_invite_reminders_paused_until)
  WHERE status = 'invited' AND role <> 'proposer';

-- A proposal manager may curate a co-speaker's profile for this proposal, but
-- the proposer-management capability must never rewrite that person's
-- account-wide profile or headshot. Keep these overrides on the speaker roster
-- row so they follow
-- the proposal aggregate and cannot orphan when a speaker is removed. JSON
-- key presence distinguishes an explicit NULL override from no override.
ALTER TABLE proposal_speakers ADD COLUMN profile_overrides_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE proposal_speakers ADD COLUMN headshot_override_set INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proposal_speakers ADD COLUMN headshot_r2_key TEXT;
ALTER TABLE proposal_speakers ADD COLUMN headshot_updated_at TEXT;

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
  OR OLD.expires_at IS NOT NEW.expires_at
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

-- Group and transitional speaker invite lists are event/type scoped and use
-- created_at as their stable default order. Keep the bounded page in D1.
CREATE INDEX idx_invites_event_type_created
  ON invites(event_id, invite_type, created_at DESC, id ASC);

-- This migration is unreleased. Canonical invitation predicates compare UTC
-- instants as text, so first normalize every parseable legacy event/invite
-- value to the exact millisecond UTC representation used by application
-- writes. Do not invent a value for unparseable legacy text: it remains
-- fail-closed and is reported by the migration verification tests.
UPDATE events
SET starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', starts_at)
WHERE starts_at IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', starts_at) IS NOT NULL
  AND starts_at <> strftime('%Y-%m-%dT%H:%M:%fZ', starts_at);

UPDATE events
SET ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', ends_at)
WHERE ends_at IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', ends_at) IS NOT NULL
  AND ends_at <> strftime('%Y-%m-%dT%H:%M:%fZ', ends_at);

UPDATE invites
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at)
WHERE expires_at IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS NOT NULL
  AND expires_at <> strftime('%Y-%m-%dT%H:%M:%fZ', expires_at);

-- Duplicate resolution uses creation time to retain the most recently
-- delivered capability. Normalize every parseable legacy value first so
-- mixed but equivalent timestamp formats do not change the winner.
UPDATE invites
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
WHERE strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL
  AND created_at <> strftime('%Y-%m-%dT%H:%M:%fZ', created_at);

UPDATE proposal_speakers
SET invite_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', invite_expires_at)
WHERE invite_expires_at IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', invite_expires_at) IS NOT NULL
  AND invite_expires_at <> strftime('%Y-%m-%dT%H:%M:%fZ', invite_expires_at);

-- An unparseable invite deadline or event window cannot be repaired without
-- inventing authorization. Retire those legacy rows explicitly so they do not
-- remain misleadingly sent or retain the active-invite uniqueness slot.
UPDATE invites
SET status = 'expired'
WHERE status = 'sent'
  AND (
    (expires_at IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS NULL)
    OR NOT EXISTS (
      SELECT 1
      FROM events event
      WHERE event.id = invites.event_id
        AND event.starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', event.starts_at)
        AND event.ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', event.ends_at)
        AND event.ends_at > event.starts_at
    )
  );

-- Normalize legacy invitations onto the same finite event window used by
-- every new dispatch. Existing earlier deadlines remain earlier; missing or
-- overly-late deadlines become the event start/end. Unparseable values are
-- deliberately left unchanged and therefore cannot authorize an invite.
UPDATE invites
SET expires_at = (
  SELECT CASE
    WHEN invites.expires_at IS NULL THEN event.starts_at
    WHEN invites.expires_at <= event.ends_at THEN invites.expires_at
    ELSE event.ends_at
  END
  FROM events event
  WHERE event.id = invites.event_id
)
WHERE EXISTS (
  SELECT 1
  FROM events event
  WHERE event.id = invites.event_id
    AND event.starts_at IS NOT NULL
    AND event.ends_at IS NOT NULL
    AND event.starts_at = strftime('%Y-%m-%dT%H:%M:%fZ', event.starts_at)
    AND event.ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', event.ends_at)
    AND event.ends_at > event.starts_at
    AND (
      invites.expires_at IS NULL
      OR invites.expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', invites.expires_at)
    )
);

-- Invitation recipients are case-insensitive application identities. Repair
-- legacy whitespace/casing before duplicate detection so the uniqueness
-- invariant cannot preserve parallel capabilities for the same mailbox.
UPDATE invites
SET invitee_email = lower(trim(invitee_email))
WHERE invitee_email <> lower(trim(invitee_email));

-- A blank or unmistakably malformed recipient and a deadline that has already
-- elapsed cannot represent an active invitation. Keep this deliberately
-- narrower than full email validation: SQL must not guess at unusual but valid
-- mailboxes, while multiple separators, missing sides, or embedded whitespace
-- can never match the application's normalized email contract.
UPDATE invites
SET status = 'expired'
WHERE status = 'sent'
  AND (
    invitee_email = ''
    OR instr(invitee_email, '@') < 2
    OR instr(invitee_email, '@') = length(invitee_email)
    OR length(invitee_email) - length(replace(invitee_email, '@', '')) <> 1
    OR instr(invitee_email, ' ') > 0
    OR instr(invitee_email, char(9)) > 0
    OR instr(invitee_email, char(10)) > 0
    OR instr(invitee_email, char(13)) > 0
    OR expires_at IS NULL
    OR expires_at <> strftime('%Y-%m-%dT%H:%M:%fZ', expires_at)
    OR expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );

CREATE INDEX idx_proposal_speakers_user_active
  ON proposal_speakers(user_id, created_at DESC, proposal_id)
  WHERE role <> 'proposer' AND status IN ('invited', 'confirmed');

-- Source/effective-role reads start with a person and then join their proposal
-- sources. Include every role/status because inactive sources remain relevant
-- to provenance and event-participation history.
CREATE INDEX idx_proposal_speakers_user_proposal_status_role
  ON proposal_speakers(user_id, proposal_id, status, role);

-- User classification counts distinct events across direct participant rows.
-- The existing event/role/status index does not support a user-first lookup.
CREATE INDEX idx_event_participants_user_event_status_role
  ON event_participants(user_id, event_id, status, role);

-- The participant-source view is correlated by user in admin classification
-- and participation counts. Existing registration indexes are event-first.
CREATE INDEX idx_registrations_user_event_status
  ON registrations(user_id, event_id, status);

-- Registration capacity depends on a person's complete proposal/direct role
-- source set. Protect the source snapshot used to prepare a capacity change
-- from a concurrent edit to another proposal or direct source. Revision rows
-- are created lazily; an absent row represents revision zero.
CREATE TABLE event_participant_source_revisions (
  event_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(event_id, user_id),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE event_participant_source_revision_guards (
  id                TEXT NOT NULL PRIMARY KEY,
  event_id          TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Whole-proposal decisions enumerate a roster before reconciling every
-- affected user's registration capacity. Guard that roster separately so an
-- added or removed speaker cannot evade the per-user source guards by
-- appearing only after the enumeration.
CREATE TABLE proposal_speaker_roster_revisions (
  proposal_id TEXT NOT NULL PRIMARY KEY,
  revision    INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(proposal_id) REFERENCES session_proposals(id) ON DELETE CASCADE
);

CREATE TABLE proposal_speaker_roster_revision_guards (
  id                TEXT NOT NULL PRIMARY KEY,
  proposal_id       TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  FOREIGN KEY(proposal_id) REFERENCES session_proposals(id) ON DELETE CASCADE
);

CREATE TRIGGER trg_event_participant_source_revision_guard_validate
BEFORE INSERT ON event_participant_source_revision_guards
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN COALESCE((
      SELECT revision
      FROM event_participant_source_revisions
      WHERE event_id = NEW.event_id AND user_id = NEW.user_id
    ), 0) <> NEW.expected_revision
    THEN RAISE(ABORT, 'EVENT_PARTICIPANT_SOURCE_CHANGED')
  END;
END;

CREATE TRIGGER trg_event_participant_source_revision_guard_delete
AFTER INSERT ON event_participant_source_revision_guards
FOR EACH ROW
BEGIN
  DELETE FROM event_participant_source_revision_guards WHERE id = NEW.id;
END;

CREATE TRIGGER trg_proposal_speaker_roster_revision_guard_validate
BEFORE INSERT ON proposal_speaker_roster_revision_guards
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN COALESCE((
      SELECT revision FROM proposal_speaker_roster_revisions WHERE proposal_id = NEW.proposal_id
    ), 0) <> NEW.expected_revision
    THEN RAISE(ABORT, 'PROPOSAL_SPEAKER_ROSTER_CHANGED')
  END;
END;

CREATE TRIGGER trg_proposal_speaker_roster_revision_guard_delete
AFTER INSERT ON proposal_speaker_roster_revision_guards
FOR EACH ROW
BEGIN
  DELETE FROM proposal_speaker_roster_revision_guards WHERE id = NEW.id;
END;

CREATE TRIGGER trg_proposal_speaker_source_revision_insert
AFTER INSERT ON proposal_speakers
FOR EACH ROW
BEGIN
  INSERT INTO event_participant_source_revisions (event_id, user_id, revision)
  SELECT event_id, NEW.user_id, 1
  FROM session_proposals
  WHERE id = NEW.proposal_id
  ON CONFLICT(event_id, user_id) DO UPDATE SET revision = event_participant_source_revisions.revision + 1;
  INSERT INTO proposal_speaker_roster_revisions (proposal_id, revision)
  VALUES (NEW.proposal_id, 1)
  ON CONFLICT(proposal_id) DO UPDATE SET revision = proposal_speaker_roster_revisions.revision + 1;
END;

CREATE TRIGGER trg_proposal_speaker_source_revision_delete
AFTER DELETE ON proposal_speakers
FOR EACH ROW
BEGIN
  INSERT INTO event_participant_source_revisions (event_id, user_id, revision)
  SELECT event_id, OLD.user_id, 1
  FROM session_proposals
  WHERE id = OLD.proposal_id
  ON CONFLICT(event_id, user_id) DO UPDATE SET revision = event_participant_source_revisions.revision + 1;
  INSERT INTO proposal_speaker_roster_revisions (proposal_id, revision)
  VALUES (OLD.proposal_id, 1)
  ON CONFLICT(proposal_id) DO UPDATE SET revision = proposal_speaker_roster_revisions.revision + 1;
END;

CREATE TRIGGER trg_proposal_speaker_source_revision_update
AFTER UPDATE OF role, status ON proposal_speakers
FOR EACH ROW
WHEN OLD.role IS NOT NEW.role
  OR OLD.status IS NOT NEW.status
BEGIN
  INSERT INTO event_participant_source_revisions (event_id, user_id, revision)
  SELECT event_id, NEW.user_id, 1
  FROM session_proposals
  WHERE id = NEW.proposal_id
  ON CONFLICT(event_id, user_id) DO UPDATE SET revision = event_participant_source_revisions.revision + 1;
  INSERT INTO proposal_speaker_roster_revisions (proposal_id, revision)
  VALUES (NEW.proposal_id, 1)
  ON CONFLICT(proposal_id) DO UPDATE SET revision = proposal_speaker_roster_revisions.revision + 1;
END;

CREATE TRIGGER trg_session_proposal_source_revision_update
AFTER UPDATE OF status, deleted_at ON session_proposals
FOR EACH ROW
WHEN OLD.status IS NOT NEW.status
  OR OLD.deleted_at IS NOT NEW.deleted_at
BEGIN
  INSERT INTO event_participant_source_revisions (event_id, user_id, revision)
  SELECT NEW.event_id, ps.user_id, 1
  FROM proposal_speakers ps
  WHERE ps.proposal_id = NEW.id
  ON CONFLICT(event_id, user_id) DO UPDATE SET revision = event_participant_source_revisions.revision + 1;
END;

-- Proposal/source ownership is a durable identity, not an editable workflow
-- attribute. Moving it would require atomically revising two source sets, so
-- fail closed instead of silently allowing an unsupported relationship move.
CREATE TRIGGER trg_proposal_speaker_identity_immutable
BEFORE UPDATE OF proposal_id, user_id ON proposal_speakers
FOR EACH ROW
WHEN OLD.proposal_id IS NOT NEW.proposal_id OR OLD.user_id IS NOT NEW.user_id
BEGIN
  SELECT RAISE(ABORT, 'PROPOSAL_SPEAKER_IDENTITY_IMMUTABLE');
END;

CREATE TRIGGER trg_session_proposal_event_identity_immutable
BEFORE UPDATE OF event_id ON session_proposals
FOR EACH ROW
WHEN OLD.event_id IS NOT NEW.event_id
BEGIN
  SELECT RAISE(ABORT, 'SESSION_PROPOSAL_EVENT_IMMUTABLE');
END;

-- Non-proposal participant sources (for example organizer or staff roles)
-- also determine registration capacity exemption. Their writes share the
-- event/user source revision, while proposal-projection maintenance is
-- deliberately excluded to avoid self-invalidating a rebuild.
CREATE TRIGGER trg_event_participant_manual_source_revision_insert
AFTER INSERT ON event_participants
FOR EACH ROW
WHEN COALESCE(NEW.source_type, '') <> 'proposal'
BEGIN
  INSERT INTO event_participant_source_revisions (event_id, user_id, revision)
  VALUES (NEW.event_id, NEW.user_id, 1)
  ON CONFLICT(event_id, user_id) DO UPDATE SET revision = event_participant_source_revisions.revision + 1;
END;

CREATE TRIGGER trg_event_participant_manual_source_revision_delete
AFTER DELETE ON event_participants
FOR EACH ROW
WHEN COALESCE(OLD.source_type, '') <> 'proposal'
BEGIN
  INSERT INTO event_participant_source_revisions (event_id, user_id, revision)
  VALUES (OLD.event_id, OLD.user_id, 1)
  ON CONFLICT(event_id, user_id) DO UPDATE SET revision = event_participant_source_revisions.revision + 1;
END;

CREATE TRIGGER trg_event_participant_manual_source_revision_update
AFTER UPDATE OF event_id, user_id, role, subrole, status, source_type ON event_participants
FOR EACH ROW
WHEN COALESCE(OLD.source_type, '') <> 'proposal' OR COALESCE(NEW.source_type, '') <> 'proposal'
BEGIN
  INSERT INTO event_participant_source_revisions (event_id, user_id, revision)
  SELECT OLD.event_id, OLD.user_id, 1
  WHERE COALESCE(OLD.source_type, '') <> 'proposal'
  ON CONFLICT(event_id, user_id) DO UPDATE SET revision = event_participant_source_revisions.revision + 1;
  INSERT INTO event_participant_source_revisions (event_id, user_id, revision)
  SELECT NEW.event_id, NEW.user_id, 1
  WHERE COALESCE(NEW.source_type, '') <> 'proposal'
    AND (
      COALESCE(OLD.source_type, '') = 'proposal'
      OR NEW.event_id IS NOT OLD.event_id
      OR NEW.user_id IS NOT OLD.user_id
    )
  ON CONFLICT(event_id, user_id) DO UPDATE SET revision = event_participant_source_revisions.revision + 1;
END;

-- Preserve every authoritative role source without expanding the legacy
-- event_participants uniqueness constraint or copying proposal data into it.
-- Existing proposal projection rows are deliberately excluded; proposal_speakers
-- joined to session_proposals is the normalized source of truth.
CREATE VIEW event_participant_role_sources AS
SELECT
  'event_participant:' || ep.id AS source_key,
  'event_participant' AS source_kind,
  ep.id AS source_id,
  ep.event_id,
  ep.user_id,
  ep.role,
  ep.subrole,
  ep.status,
  ep.source_type,
  ep.source_ref
FROM event_participants ep
WHERE COALESCE(ep.source_type, '') <> 'proposal'
  AND (
    ep.role <> 'attendee'
    OR NOT EXISTS (
      SELECT 1
      FROM registrations registration_source
      WHERE registration_source.event_id = ep.event_id
        AND registration_source.user_id = ep.user_id
    )
  )
UNION ALL
SELECT
  'registration:' || r.id AS source_key,
  'registration' AS source_kind,
  r.id AS source_id,
  r.event_id,
  r.user_id,
  'attendee' AS role,
  r.attendance_type AS subrole,
  CASE r.status
    WHEN 'registered' THEN 'active'
    WHEN 'pending_email_confirmation' THEN 'invited'
    WHEN 'waitlisted' THEN 'waitlisted'
    ELSE 'inactive'
  END AS status,
  r.source_type,
  r.source_ref
FROM registrations r
UNION ALL
SELECT
  'proposal_speaker:' || ps.id AS source_key,
  'proposal_speaker' AS source_kind,
  ps.id AS source_id,
  sp.event_id,
  ps.user_id,
  CASE ps.role
    WHEN 'moderator' THEN 'moderator'
    WHEN 'panelist' THEN 'panelist'
    WHEN 'proposer' THEN 'speaker'
    WHEN 'speaker' THEN 'speaker'
    WHEN 'co_speaker' THEN 'speaker'
  END AS role,
  CASE ps.role
    WHEN 'moderator' THEN NULL
    WHEN 'panelist' THEN NULL
    WHEN 'proposer' THEN 'proposer'
    WHEN 'speaker' THEN 'speaker'
    WHEN 'co_speaker' THEN 'co_speaker'
  END AS subrole,
  CASE
    WHEN sp.status = 'accepted' AND sp.deleted_at IS NULL AND ps.status <> 'declined' THEN 'active'
    ELSE 'inactive'
  END AS status,
  'proposal' AS source_type,
  ps.proposal_id AS source_ref
FROM proposal_speakers ps
JOIN session_proposals sp ON sp.id = ps.proposal_id
WHERE ps.role IN ('proposer', 'speaker', 'co_speaker', 'moderator', 'panelist');

-- Consumers that need a person's current role should not select an arbitrary
-- source. Collapse sources only after preserving them above, and keep a role
-- active while at least one authoritative source remains active.
CREATE VIEW effective_event_participant_roles AS
SELECT
  event_id,
  user_id,
  role,
  subrole,
  CASE MAX(
    CASE status
      WHEN 'active' THEN 4
      WHEN 'invited' THEN 3
      WHEN 'waitlisted' THEN 2
      ELSE 1
    END
  )
    WHEN 4 THEN 'active'
    WHEN 3 THEN 'invited'
    WHEN 2 THEN 'waitlisted'
    ELSE 'inactive'
  END AS status,
  COUNT(*) AS source_count,
  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_source_count
FROM event_participant_role_sources
GROUP BY event_id, user_id, role, subrole;

-- Badge-role precedence is one shared D1 read model used by admin and public
-- badge paths instead of repeated CASE expressions in each consumer.
CREATE VIEW event_participant_badge_roles AS
SELECT
  event_id,
  user_id,
  role,
  CASE role
    WHEN 'speaker' THEN 1
    WHEN 'moderator' THEN 2
    WHEN 'panelist' THEN 3
    WHEN 'organizer' THEN 4
    WHEN 'staff' THEN 5
    ELSE 99
  END AS priority
FROM effective_event_participant_roles
WHERE status = 'active' AND role <> 'attendee';

-- Calendar replies describe one event day, not the entire registration. Keep
-- that identity normalized so enforcement never infers a registration-wide
-- cancellation from a day-level response. Nullable legacy/ambiguous rows are
-- retained for audit but fail closed in the enforcement job.
ALTER TABLE calendar_rsvp_events ADD COLUMN event_day_id TEXT REFERENCES event_days(id);
ALTER TABLE calendar_rsvp_events ADD COLUMN action_due_at TEXT;

-- Older dedupe keys predate provider namespacing. Preserve their original
-- tuple shape while preventing two calendar transports from suppressing each
-- other's events after deployment. Historical databases may contain legacy
-- opaque keys rather than JSON arrays; retain those values instead of making
-- the entire additive migration depend on historical application data being
-- valid JSON.
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
END
WHERE json_valid(dedupe_key);

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
-- A public registration-management capability may correct the address only
-- when that same registration transaction created a new, still-unconfirmed
-- identity. Existing-account registration links must never become global
-- account-rebinding credentials. Authorized staff/organization actors use a
-- separately authenticated command path and do not depend on this flag.
ALTER TABLE registrations ADD COLUMN created_identity_user_id TEXT REFERENCES users(id);

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
AFTER UPDATE OF status, user_id, confirmation_link_secret, manage_link_secret,
                created_identity_user_id ON registrations
FOR EACH ROW
WHEN OLD.status IS NOT NEW.status
  OR OLD.user_id IS NOT NEW.user_id
  OR OLD.confirmation_link_secret IS NOT NEW.confirmation_link_secret
  OR OLD.manage_link_secret IS NOT NEW.manage_link_secret
  OR OLD.created_identity_user_id IS NOT NEW.created_identity_user_id
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

-- Individual foreign keys prove that each ID exists, but cannot prove that a
-- registration and event day belong to the same event. Keep this invariant in
-- triggers rather than rebuilding the deployed attendance table to introduce a
-- composite parent key.
CREATE TRIGGER validate_registration_day_attendance_insert
BEFORE INSERT ON registration_day_attendance
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM registrations r
  JOIN event_days ed ON ed.event_id = r.event_id
  WHERE r.id = NEW.registration_id AND ed.id = NEW.event_day_id
)
BEGIN
  SELECT RAISE(ABORT, 'REGISTRATION_DAY_EVENT_MISMATCH');
END;

CREATE TRIGGER validate_registration_day_attendance_update
BEFORE UPDATE OF registration_id, event_day_id ON registration_day_attendance
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM registrations r
  JOIN event_days ed ON ed.event_id = r.event_id
  WHERE r.id = NEW.registration_id AND ed.id = NEW.event_day_id
)
BEGIN
  SELECT RAISE(ABORT, 'REGISTRATION_DAY_EVENT_MISMATCH');
END;

CREATE TRIGGER validate_event_day_waitlist_insert
BEFORE INSERT ON event_day_waitlist_entries
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM event_days ed
  JOIN registrations r ON r.event_id = ed.event_id
  WHERE ed.id = NEW.event_day_id
    AND ed.event_id = NEW.event_id
    AND r.id = NEW.registration_id
    AND r.user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'WAITLIST_EVENT_CONTEXT_INVALID');
END;

CREATE TRIGGER validate_event_day_waitlist_update
BEFORE UPDATE OF event_id, event_day_id, registration_id, user_id ON event_day_waitlist_entries
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM event_days ed
  JOIN registrations r ON r.event_id = ed.event_id
  WHERE ed.id = NEW.event_day_id
    AND ed.event_id = NEW.event_id
    AND r.id = NEW.registration_id
    AND r.user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'WAITLIST_EVENT_CONTEXT_INVALID');
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
-- Endpoint), and (public members / group endpoints) all need
-- tables that don't exist yet. Per the no-CHECK-constraint
-- convention, status/stage/type columns below carry `-- allowed:`
-- comments only; validation lives in the application layer (Zod).
--
-- Three groups of tables, each pulled forward from an endpoint that needs them now:
--
-- 1. member_applications / member_application_events / application_documents
--    — required immediately by POST /api/v1/members/applications.
--
-- 2. sponsorships / sponsorship_events —
--    required immediately by POST /api/v1/sponsors/inquiries and
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
-- 3. groups / group_memberships — required immediately by the canonical
--    /api/v1/groups and /api/v1/me/groups resources.
--    Seeded with the published and coordination groups needed by the
--    canonical group resources during initial local setup.

-- ── Membership applications ──────────────────────────────

CREATE TABLE member_applications (
  id                   TEXT NOT NULL PRIMARY KEY,
  -- Set from the server-authored verified-email continuation when the
  -- applicant already has an account, or during approval for a new account.
  applicant_user_id    TEXT,
  -- Bound atomically when approval provisions the resulting Member capacity.
  -- Applicant email remains the historical delivery address, never identity.
  member_id            TEXT,
  applicant_email      TEXT NOT NULL,
  applicant_name       TEXT NOT NULL,
  organization_name    TEXT,
  organization_domain  TEXT,
  membership_category  TEXT NOT NULL,
  form_submission_id   TEXT,
  -- Set by the public verified-email flow. Nullable only for imported legacy
  -- workflow rows; the public command requires it in application code.
  join_capability_id   TEXT,
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
  FOREIGN KEY(applicant_user_id) REFERENCES users(id),
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(membership_category) REFERENCES membership_categories(code)
);

CREATE INDEX idx_member_applications_email ON member_applications(applicant_email);
CREATE INDEX idx_member_applications_applicant_user
  ON member_applications(applicant_user_id, created_at DESC, id ASC)
  WHERE applicant_user_id IS NOT NULL;
CREATE INDEX idx_member_applications_member_created
  ON member_applications(member_id, created_at DESC, id ASC)
  WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX uq_member_applications_join_capability
  ON member_applications(join_capability_id)
  WHERE join_capability_id IS NOT NULL;
CREATE INDEX idx_member_applications_domain ON member_applications(organization_domain);
CREATE INDEX idx_member_applications_stage ON member_applications(stage);
-- Supports the scheduled on-hold-reminder/EC-auto-approve due-work queries'
-- ORDER BY stage_entered_at LIMIT ? (PR #1 review §9.1) with a direct index
-- range scan instead of a full per-stage table scan.
CREATE INDEX idx_member_applications_stage_entered_at ON member_applications(stage, stage_entered_at, id);
CREATE INDEX idx_member_applications_membership_category
  ON member_applications(membership_category);
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
-- it does NOT also reject updateMembershipApplication's own
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
  content_sha256    TEXT NOT NULL,
  uploaded_at       TEXT NOT NULL,
  idempotency_key_hash TEXT,
  FOREIGN KEY(application_id) REFERENCES member_applications(id)
);

CREATE INDEX idx_application_documents_app
  ON application_documents(application_id, uploaded_at DESC, id ASC);
CREATE UNIQUE INDEX uq_application_documents_idempotency
  ON application_documents(application_id, idempotency_key_hash)
  WHERE idempotency_key_hash IS NOT NULL;

-- A guarded document insert may intentionally affect zero rows when a count,
-- aggregate-byte, or idempotency condition loses a race. Turn that outcome
-- into one domain-specific batch failure before audit/storage fallout can
-- commit; the transient guard row removes itself after validation.
CREATE TABLE application_document_insert_guards (
  id          TEXT NOT NULL PRIMARY KEY,
  document_id TEXT NOT NULL
);

CREATE TRIGGER validate_application_document_insert_guard
BEFORE INSERT ON application_document_insert_guards
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM application_documents WHERE id = NEW.document_id)
    THEN RAISE(ABORT, 'APPLICATION_DOCUMENT_INSERT_REJECTED')
  END;
END;

CREATE TRIGGER apply_application_document_insert_guard
AFTER INSERT ON application_document_insert_guards
FOR EACH ROW
BEGIN
  DELETE FROM application_document_insert_guards WHERE id = NEW.id;
END;

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
CREATE INDEX idx_sponsorships_active_event_contact
  ON sponsorships(lower(trim(contact_email)), event_id, id)
  WHERE sponsor_type = 'event' AND pipeline_stage = 'active' AND contact_email IS NOT NULL;
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

-- ── Groups ─────────────────────────────────────────────────────
-- Groups are the generic collaboration boundary. Working groups, boards,
-- committees, chapters, and all-member communication groups share this one
-- model and the same authorization, membership, event, form, and vote code.

CREATE TABLE group_types (
  key              TEXT NOT NULL PRIMARY KEY,
  singular_label   TEXT NOT NULL,
  plural_label     TEXT NOT NULL,
  description      TEXT,
  default_governance_inheritance_mode TEXT NOT NULL DEFAULT 'inherited',
  default_eligibility_mode TEXT NOT NULL DEFAULT 'open',
  default_automatic_enrollment_mode TEXT NOT NULL DEFAULT 'none',
  default_allow_automatic_opt_out INTEGER NOT NULL DEFAULT 1 CHECK (default_allow_automatic_opt_out IN (0, 1)),
  default_visibility TEXT NOT NULL DEFAULT 'participants',
  -- Display titles for the two capacity-bound leadership roles. The roles
  -- (role-group_lead / role-group_deputy_lead) define authority; the type
  -- says what the consortium calls the people holding them, so a working
  -- group has a Chair and Vice Chair while a task force has a Lead and
  -- Deputy Lead without a type-specific code path. An assignment stores the
  -- exact title it was made with, so renaming a type never rewrites history.
  lead_title       TEXT NOT NULL DEFAULT 'Chair',
  deputy_lead_title TEXT NOT NULL DEFAULT 'Vice Chair',
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

INSERT INTO group_types
  (key, singular_label, plural_label, description,
   default_governance_inheritance_mode, default_eligibility_mode,
   default_automatic_enrollment_mode, default_allow_automatic_opt_out, default_visibility,
   lead_title, deputy_lead_title,
   active, sort_order, created_at, updated_at)
VALUES
  ('working_group', 'Working Group', 'Working Groups', 'A topic-focused collaboration group.', 'inherited', 'open', 'none', 1, 'public', 'Chair', 'Vice Chair', 1, 10, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('task_force', 'Task Force', 'Task Forces', 'A time-boxed group with one deliverable.', 'inherited', 'managed', 'none', 0, 'participants', 'Lead', 'Deputy Lead', 1, 15, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('board', 'Board', 'Boards', 'A governing board.', 'inherited', 'managed', 'none', 0, 'participants', 'Chair', 'Vice Chair', 1, 20, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('committee', 'Committee', 'Committees', 'A standing or temporary committee.', 'inherited', 'managed', 'none', 1, 'participants', 'Chair', 'Vice Chair', 1, 30, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('chapter', 'Chapter', 'Chapters', 'A regional or community chapter.', 'inherited', 'open', 'none', 1, 'authenticated', 'Lead', 'Deputy Lead', 1, 40, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('community', 'Community', 'Communities', 'A communication and coordination group.', 'inherited', 'open', 'none', 1, 'authenticated', 'Chair', 'Vice Chair', 1, 50, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE groups (
  id                          TEXT NOT NULL PRIMARY KEY,
  type_key                    TEXT NOT NULL,
  parent_group_id             TEXT,
  name                        TEXT NOT NULL,
  slug                        TEXT NOT NULL UNIQUE,
  description                 TEXT,
  links_json                  TEXT,
  visibility                  TEXT NOT NULL DEFAULT 'participants',
  governance_inheritance_mode TEXT NOT NULL DEFAULT 'inherited',
  eligibility_mode            TEXT NOT NULL DEFAULT 'open',
  automatic_enrollment_mode   TEXT NOT NULL DEFAULT 'none',
  allow_automatic_opt_out     INTEGER NOT NULL DEFAULT 1 CHECK (allow_automatic_opt_out IN (0, 1)),
  public_leadership           INTEGER NOT NULL DEFAULT 0 CHECK (public_leadership IN (0, 1)),
  -- Publishes the dated member roster (current and former members) in the
  -- public directory, which is how the Board of Directors and Executive
  -- Council pages render. Leadership publication is a separate switch because
  -- a working group publishes its chairs but never its member list.
  public_roster               INTEGER NOT NULL DEFAULT 0 CHECK (public_roster IN (0, 1)),
  min_endorsers_for_ballot    INTEGER NOT NULL DEFAULT 0,
  active                      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  revision                    INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  FOREIGN KEY(type_key) REFERENCES group_types(key),
  FOREIGN KEY(parent_group_id) REFERENCES groups(id),
  CHECK (parent_group_id IS NULL OR parent_group_id <> id)
);

CREATE INDEX idx_groups_parent_active
  ON groups(parent_group_id, active, name, id);
CREATE INDEX idx_groups_type_active
  ON groups(type_key, active, name, id);
CREATE INDEX idx_groups_visibility_active
  ON groups(visibility, active, name, id);

-- Board of Directors and Executive Council rosters are ordinary groups: a
-- seat is a dated group membership and a chair is a capacity-bound leadership
-- assignment. There is no separate positions table, so the public About pages
-- and the portal read one roster and one history.

-- D1 cannot defer recursive hierarchy validation to application code because
-- other writers may exist. Reject direct and indirect cycles at the database
-- boundary while leaving configurable vocabularies out of brittle CHECKs.
CREATE TRIGGER trg_groups_prevent_cycle_insert
BEFORE INSERT ON groups
WHEN NEW.parent_group_id IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT NEW.parent_group_id
      UNION ALL
      SELECT g.parent_group_id
      FROM groups g JOIN ancestors a ON g.id = a.id
      WHERE g.parent_group_id IS NOT NULL
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN RAISE(ABORT, 'group hierarchy cycle') END;
END;

CREATE TRIGGER trg_groups_prevent_cycle_update
BEFORE UPDATE OF parent_group_id ON groups
WHEN NEW.parent_group_id IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT NEW.parent_group_id
      UNION ALL
      SELECT g.parent_group_id
      FROM groups g JOIN ancestors a ON g.id = a.id
      WHERE g.parent_group_id IS NOT NULL
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN RAISE(ABORT, 'group hierarchy cycle') END;
END;

-- Automatic enrollment is a convenience policy, never a hierarchy shortcut.
-- Such groups must remain top-level and cannot become structural parents.
CREATE TRIGGER trg_groups_automatic_enrollment_top_level_insert
BEFORE INSERT ON groups
WHEN NEW.automatic_enrollment_mode != 'none' AND NEW.parent_group_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'automatic enrollment groups must be top-level');
END;

CREATE TRIGGER trg_groups_automatic_enrollment_top_level_update
BEFORE UPDATE OF automatic_enrollment_mode, parent_group_id ON groups
WHEN NEW.automatic_enrollment_mode != 'none' AND NEW.parent_group_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'automatic enrollment groups must be top-level');
END;

CREATE TRIGGER trg_groups_automatic_enrollment_not_parent_insert
BEFORE INSERT ON groups
WHEN NEW.parent_group_id IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM groups parent
    WHERE parent.id = NEW.parent_group_id
      AND parent.automatic_enrollment_mode != 'none'
 )
BEGIN
  SELECT RAISE(ABORT, 'automatic enrollment groups cannot be structural parents');
END;

CREATE TRIGGER trg_groups_automatic_enrollment_not_parent_update
BEFORE UPDATE OF parent_group_id ON groups
WHEN NEW.parent_group_id IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM groups parent
    WHERE parent.id = NEW.parent_group_id
      AND parent.automatic_enrollment_mode != 'none'
 )
BEGIN
  SELECT RAISE(ABORT, 'automatic enrollment groups cannot be structural parents');
END;

CREATE TRIGGER trg_groups_prevent_parent_becoming_automatic
BEFORE UPDATE OF automatic_enrollment_mode ON groups
WHEN NEW.automatic_enrollment_mode != 'none'
 AND EXISTS (SELECT 1 FROM groups child WHERE child.parent_group_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'a structural parent cannot enable automatic enrollment');
END;

-- One row represents one user participating in one group on behalf of one
-- membership aggregate. Multiple represented organizations therefore use
-- multiple rows, without a participant/mandate join-table hierarchy.
CREATE TABLE group_memberships (
  id                 TEXT NOT NULL PRIMARY KEY,
  group_id           TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  identity_id        TEXT NOT NULL,
  member_id          TEXT NOT NULL,
  source             TEXT NOT NULL DEFAULT 'self_service',
  created_by_user_id TEXT,
  -- Optional roster title for this seat, such as a treasurer or an ex officio
  -- member. Leadership titles live on the role assignment, not here.
  title              TEXT,
  -- Service interval. A manager may backdate joined_at or record a former
  -- member with both instants in the past, which is how a governing body
  -- keeps its history in the same table as its current roster.
  joined_at          TEXT NOT NULL,
  left_at            TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  CHECK (left_at IS NULL OR left_at >= joined_at),
  FOREIGN KEY(group_id) REFERENCES groups(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(identity_id) REFERENCES identities(id),
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX uq_group_memberships_active_capacity
  ON group_memberships(group_id, identity_id)
  WHERE left_at IS NULL;
CREATE INDEX idx_group_memberships_group_active
  ON group_memberships(group_id, left_at, identity_id, user_id, member_id);
CREATE INDEX idx_group_memberships_user_active
  ON group_memberships(user_id, left_at, group_id, identity_id, member_id);
CREATE INDEX idx_group_memberships_member_active
  ON group_memberships(member_id, left_at, group_id, identity_id, user_id);
CREATE INDEX idx_group_memberships_joined_window
  ON group_memberships(joined_at, group_id);
CREATE INDEX idx_group_memberships_left_window
  ON group_memberships(left_at, group_id)
  WHERE left_at IS NOT NULL;

-- A child membership is explicit, but it is only valid while the user has at
-- least one active capacity in the direct parent. The represented Member does
-- not need to be the same in both groups.
CREATE TRIGGER trg_group_memberships_require_parent_insert
BEFORE INSERT ON group_memberships
WHEN EXISTS (
  SELECT 1 FROM groups g
  WHERE g.id = NEW.group_id AND g.parent_group_id IS NOT NULL
)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM groups child
    JOIN group_memberships parent_membership
      ON parent_membership.group_id = child.parent_group_id
     AND parent_membership.user_id = NEW.user_id
     AND parent_membership.left_at IS NULL
    WHERE child.id = NEW.group_id
  ) THEN RAISE(ABORT, 'active parent group membership required') END;
END;

CREATE TRIGGER trg_group_memberships_require_parent_reactivate
BEFORE UPDATE OF left_at ON group_memberships
WHEN OLD.left_at IS NOT NULL AND NEW.left_at IS NULL
 AND EXISTS (
   SELECT 1 FROM groups g
   WHERE g.id = NEW.group_id AND g.parent_group_id IS NOT NULL
 )
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM groups child
    JOIN group_memberships parent_membership
      ON parent_membership.group_id = child.parent_group_id
     AND parent_membership.user_id = NEW.user_id
     AND parent_membership.left_at IS NULL
    WHERE child.id = NEW.group_id
  ) THEN RAISE(ABORT, 'active parent group membership required') END;
END;

-- Ending the user's final capacity in a parent ends active descendant
-- capacities. Restoring the parent does not silently restore descendants.
CREATE TRIGGER trg_group_memberships_end_descendants
AFTER UPDATE OF left_at ON group_memberships
WHEN OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM group_memberships alternative
   WHERE alternative.group_id = OLD.group_id
     AND alternative.user_id = OLD.user_id
     AND alternative.left_at IS NULL
 )
BEGIN
  UPDATE group_memberships
  SET left_at = NEW.left_at,
      updated_at = NEW.updated_at
  WHERE user_id = OLD.user_id
    AND left_at IS NULL
    AND group_id IN (
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM groups WHERE parent_group_id = OLD.group_id
        UNION ALL
        SELECT g.id
        FROM groups g JOIN descendants d ON g.parent_group_id = d.id
      )
      SELECT id FROM descendants
    );
END;

-- Never delete membership history. Commands end a capacity by setting
-- left_at, which preserves auditability and prevents orphaned references.
CREATE TRIGGER trg_group_memberships_prevent_delete
BEFORE DELETE ON group_memberships
BEGIN
  SELECT RAISE(ABORT, 'group memberships must be ended, not deleted');
END;

-- Eligibility and automatic enrollment are separate policies. An automatic
-- all-member communication group remains top-level and does not become a
-- structural parent. Category rules can be changed without rebuilding groups.
CREATE TABLE group_membership_category_rules (
  group_id                 TEXT NOT NULL,
  membership_category_code TEXT NOT NULL,
  permits_join             INTEGER NOT NULL DEFAULT 1 CHECK (permits_join IN (0, 1)),
  automatic_enrollment     INTEGER NOT NULL DEFAULT 0 CHECK (automatic_enrollment IN (0, 1)),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  PRIMARY KEY (group_id, membership_category_code),
  FOREIGN KEY(group_id) REFERENCES groups(id),
  FOREIGN KEY(membership_category_code) REFERENCES membership_categories(code)
);

CREATE INDEX idx_group_category_rules_category
  ON group_membership_category_rules(membership_category_code, group_id);

CREATE TABLE group_automatic_enrollment_opt_outs (
  group_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  opted_out_at TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY(group_id) REFERENCES groups(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX idx_group_auto_opt_outs_user
  ON group_automatic_enrollment_opt_outs(user_id, group_id);

INSERT OR IGNORE INTO groups
  (id, type_key, parent_group_id, name, slug, description, visibility,
   governance_inheritance_mode, eligibility_mode, automatic_enrollment_mode,
   allow_automatic_opt_out, public_leadership, public_roster, min_endorsers_for_ballot, active, created_at, updated_at)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'community', NULL, 'All Members', 'all-members',
   'The default communication and coordination group for active consortium members.',
   'authenticated', 'inherited', 'category', 'category', 1, 1, 0, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('20000000-0000-4000-8000-000000000002', 'board', NULL, 'Executive Council', 'executive-council',
   'The representative body that governs the consortium on behalf of the membership.',
   'participants', 'inherited', 'managed', 'none', 0, 1, 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('20000000-0000-4000-8000-000000000009', 'board', NULL, 'Board of Directors', 'board',
   'The board that provides strategic leadership and governance for the consortium.',
   'participants', 'inherited', 'managed', 'none', 0, 1, 1, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('20000000-0000-4000-8000-000000000003', 'working_group', NULL, 'Post-Quantum Cryptography Working Group', 'pqc',
   'Preparing the PKI ecosystem for the quantum computing era through collaborative research, education, standards alignment, and practical tooling.',
   'public', 'inherited', 'open', 'none', 1, 1, 0, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('20000000-0000-4000-8000-000000000004', 'working_group', NULL, 'Cryptographic Module Working Group', 'cm',
   'A central forum for addressing cryptographic module (CM) and hardware security module (HSM) related topics within the PKI ecosystem.',
   'public', 'inherited', 'open', 'none', 1, 1, 0, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('20000000-0000-4000-8000-000000000005', 'working_group', NULL, 'PKI Maturity Model Working Group', 'pkimm',
   'Building a globally recognized PKI maturity model for evaluating, planning, and comparing PKI implementations.',
   'public', 'inherited', 'open', 'none', 1, 1, 0, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('20000000-0000-4000-8000-000000000006', 'working_group', NULL, 'Training and Certification Working Group', 'tcwg',
   'Advancing PKI knowledge and skills through structured training paths, certification programs, and accessible educational resources.',
   'public', 'inherited', 'open', 'none', 1, 1, 0, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('20000000-0000-4000-8000-000000000007', 'working_group', NULL, 'CA Working Group', 'ca',
   'A working group for discussions and information sharing among publicly trusted Certificate Authorities.',
   'public', 'inherited', 'category', 'none', 1, 1, 0, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('20000000-0000-4000-8000-000000000008', 'working_group', NULL, 'CBOM Profiles Working Group', 'cbom',
   'Developing a neutral, open methodology for defining Cryptographic Bill of Materials (CBOM) profiles that map onto industry BOM standards such as SPDX and CycloneDX.',
   'public', 'inherited', 'open', 'none', 1, 1, 0, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT OR IGNORE INTO group_membership_category_rules
  (group_id, membership_category_code, permits_join, automatic_enrollment, created_at, updated_at)
VALUES
  ('20000000-0000-4000-8000-000000000007', 'A', 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT OR IGNORE INTO group_membership_category_rules
  (group_id, membership_category_code, permits_join, automatic_enrollment, created_at, updated_at)
SELECT
  '20000000-0000-4000-8000-000000000001',
  code,
  1,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM membership_categories;

-- ── Reusable live-editable forms ──────────────────────────────────
-- Form definitions are reusable. Placements provide the audience and context;
-- stable field IDs preserve historical answers while labels, order, and
-- options remain editable like Google Forms or Microsoft Forms.
ALTER TABLE form_fields ADD COLUMN updated_at TEXT;
ALTER TABLE form_fields ADD COLUMN archived_at TEXT;
-- Open vocabulary: a field may resolve its choices from a server-owned
-- catalog instead of storing a stale options snapshot. Unknown values are
-- ignored by the application until a resolver is registered for them.
ALTER TABLE form_fields ADD COLUMN option_source TEXT;

UPDATE form_fields SET updated_at = created_at WHERE updated_at IS NULL;

CREATE TABLE form_placements (
  id             TEXT NOT NULL PRIMARY KEY,
  form_id        TEXT NOT NULL,
  owner_group_id TEXT,
  context_type   TEXT NOT NULL,
  context_ref    TEXT,
  audience       TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  opens_at       TEXT,
  closes_at      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  FOREIGN KEY(form_id) REFERENCES forms(id),
  FOREIGN KEY(owner_group_id) REFERENCES groups(id)
);

CREATE UNIQUE INDEX uq_form_placements_context
  ON form_placements(
    form_id,
    context_type,
    COALESCE(context_ref, ''),
    COALESCE(owner_group_id, ''),
    audience
  );
CREATE INDEX idx_form_placements_owner_active
  ON form_placements(owner_group_id, active, opens_at, closes_at, id);
CREATE INDEX idx_form_placements_context_active
  ON form_placements(context_type, context_ref, active, id);

-- Domain aggregates keep their existing JSON answer projections, but record
-- the exact response set selected for new writes. Historical rows remain NULL;
-- placement attribution is never guessed or backfilled.
ALTER TABLE registrations
  ADD COLUMN form_placement_id TEXT REFERENCES form_placements(id);
ALTER TABLE session_proposals
  ADD COLUMN form_placement_id TEXT REFERENCES form_placements(id);
ALTER TABLE session_proposals ADD COLUMN canceled_at TEXT;
ALTER TABLE session_proposals ADD COLUMN canceled_by_user_id TEXT REFERENCES users(id);
ALTER TABLE session_proposals ADD COLUMN cancellation_comment TEXT;

CREATE INDEX idx_registrations_form_placement
  ON registrations(form_placement_id, created_at, id);
CREATE INDEX idx_session_proposals_form_placement
  ON session_proposals(form_placement_id, submitted_at, id);

-- One canonical projection identifies registration/proposal evidence belonging
-- to a form. Exact placement attribution wins; legacy NULL attribution is
-- inferred only from the pre-existing form scope and is never written back.
CREATE VIEW form_domain_response_evidence AS
SELECT attributed.form_id,
       'registration' AS source_type,
       r.id AS source_id,
       r.form_placement_id AS placement_id,
       r.custom_answers_json AS answers_json
FROM registrations r
JOIN form_placements attributed ON attributed.id = r.form_placement_id
UNION ALL
SELECT f.id AS form_id,
       'registration' AS source_type,
       r.id AS source_id,
       NULL AS placement_id,
       r.custom_answers_json AS answers_json
FROM registrations r
JOIN forms f
  ON f.purpose = 'event_registration'
 AND (
   f.scope_type = 'global'
   OR (f.scope_type = 'event' AND f.scope_ref = r.event_id)
   OR EXISTS (
     SELECT 1 FROM form_placements fp
     WHERE fp.form_id = f.id
       AND fp.context_type = 'event'
       AND fp.context_ref = r.event_id
   )
 )
WHERE r.form_placement_id IS NULL
  AND r.custom_answers_json IS NOT NULL
UNION ALL
SELECT attributed.form_id,
       'proposal' AS source_type,
       sp.id AS source_id,
       sp.form_placement_id AS placement_id,
       sp.details_json AS answers_json
FROM session_proposals sp
JOIN form_placements attributed ON attributed.id = sp.form_placement_id
UNION ALL
SELECT f.id AS form_id,
       'proposal' AS source_type,
       sp.id AS source_id,
       NULL AS placement_id,
       sp.details_json AS answers_json
FROM session_proposals sp
JOIN forms f
  ON f.purpose = 'proposal_submission'
 AND (
   f.scope_type = 'global'
   OR (f.scope_type = 'event' AND f.scope_ref = sp.event_id)
   OR EXISTS (
     SELECT 1 FROM form_placements fp
     WHERE fp.form_id = f.id
       AND fp.context_type = 'event'
       AND fp.context_ref = sp.event_id
   )
 )
WHERE sp.form_placement_id IS NULL
  AND sp.details_json IS NOT NULL;

CREATE TRIGGER trg_form_placements_validate_context_insert
BEFORE INSERT ON form_placements
WHEN (NEW.context_type = 'installation' AND NEW.context_ref IS NOT NULL)
  OR (NEW.context_type = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = NEW.context_ref))
  OR (NEW.context_type = 'event' AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.context_ref))
  OR (NEW.context_type = 'organization' AND NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.context_ref))
  OR NEW.context_type NOT IN ('installation', 'group', 'event', 'organization')
BEGIN
  SELECT RAISE(ABORT, 'form placement context is invalid');
END;

CREATE TRIGGER trg_form_placements_validate_context_update
BEFORE UPDATE OF context_type, context_ref ON form_placements
WHEN (NEW.context_type = 'installation' AND NEW.context_ref IS NOT NULL)
  OR (NEW.context_type = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = NEW.context_ref))
  OR (NEW.context_type = 'event' AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.context_ref))
  OR (NEW.context_type = 'organization' AND NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.context_ref))
  OR NEW.context_type NOT IN ('installation', 'group', 'event', 'organization')
BEGIN
  SELECT RAISE(ABORT, 'form placement context is invalid');
END;

CREATE TABLE form_placement_group_grants (
  placement_id TEXT NOT NULL,
  group_id     TEXT NOT NULL,
  capability   TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (placement_id, group_id, capability),
  FOREIGN KEY(placement_id) REFERENCES form_placements(id),
  FOREIGN KEY(group_id) REFERENCES groups(id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_form_placement_group_grants_group
  ON form_placement_group_grants(group_id, capability, placement_id);

ALTER TABLE form_submissions ADD COLUMN placement_id TEXT REFERENCES form_placements(id);
ALTER TABLE form_submission_answers ADD COLUMN field_id TEXT REFERENCES form_fields(id);

UPDATE form_submission_answers
SET field_id = (
  SELECT ff.id
  FROM form_fields ff
  JOIN form_submissions fs ON fs.id = form_submission_answers.submission_id
  WHERE ff.form_id = fs.form_id
    AND ff.key = form_submission_answers.field_key
)
WHERE field_id IS NULL;

CREATE INDEX idx_form_submissions_placement_status
  ON form_submissions(form_id, placement_id, status, submitted_at, id);
CREATE UNIQUE INDEX uq_form_submissions_domain_context
  ON form_submissions(form_id, context_type, context_ref)
  WHERE context_ref IS NOT NULL
    AND context_type IN ('registration', 'proposal', 'membership');
CREATE INDEX idx_form_answers_field
  ON form_submission_answers(field_id, submission_id);
CREATE UNIQUE INDEX uq_form_answers_submission_field
  ON form_submission_answers(submission_id, field_id)
  WHERE field_id IS NOT NULL;

-- New submission commands insert one short-lived guard in the same D1 batch
-- as the submission or answer mutation. This closes the validation-versus-edit
-- race without reclassifying legacy submissions or breaking older writers.
CREATE TABLE form_submission_guards (
  id                       TEXT NOT NULL PRIMARY KEY,
  form_id                  TEXT NOT NULL,
  placement_id             TEXT NOT NULL,
  submission_id            TEXT,
  expected_form_updated_at TEXT NOT NULL,
  expected_placement_updated_at TEXT NOT NULL,
  FOREIGN KEY(form_id) REFERENCES forms(id),
  FOREIGN KEY(placement_id) REFERENCES form_placements(id),
  FOREIGN KEY(submission_id) REFERENCES form_submissions(id)
);

CREATE TRIGGER trg_form_submission_guards_validate
BEFORE INSERT ON form_submission_guards
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM form_placements fp
    JOIN forms f ON f.id = fp.form_id
    WHERE fp.id = NEW.placement_id
      AND fp.form_id = NEW.form_id
      AND fp.active = 1
      AND f.status = 'active'
      AND f.updated_at = NEW.expected_form_updated_at
      AND fp.updated_at = NEW.expected_placement_updated_at
      AND (
        NEW.submission_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM form_submissions fs
          WHERE fs.id = NEW.submission_id
            AND fs.form_id = NEW.form_id
            AND (fs.placement_id IS NULL OR fs.placement_id = NEW.placement_id)
        )
      )
      AND (fp.opens_at IS NULL OR unixepoch(fp.opens_at) <= unixepoch())
      AND (fp.closes_at IS NULL OR unixepoch(fp.closes_at) > unixepoch())
  ) THEN RAISE(ABORT, 'FORM_SUBMISSION_CONTEXT_CHANGED') END;
END;

CREATE TRIGGER trg_form_submission_guards_release
AFTER INSERT ON form_submission_guards
BEGIN
  DELETE FROM form_submission_guards WHERE id = NEW.id;
END;

CREATE TRIGGER trg_form_answers_require_field_insert
BEFORE INSERT ON form_submission_answers
WHEN NEW.field_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'form answer requires a stable field id');
END;

CREATE TRIGGER trg_form_answers_validate_field_insert
BEFORE INSERT ON form_submission_answers
WHEN NOT EXISTS (
  SELECT 1
  FROM form_fields ff
  JOIN form_submissions fs ON fs.id = NEW.submission_id
  WHERE ff.id = NEW.field_id
    AND ff.form_id = fs.form_id
)
BEGIN
  SELECT RAISE(ABORT, 'form answer field does not belong to submission form');
END;

CREATE TRIGGER trg_form_answers_validate_field_update
BEFORE UPDATE OF submission_id, field_id ON form_submission_answers
WHEN NEW.field_id IS NULL OR NOT EXISTS (
  SELECT 1
  FROM form_fields ff
  JOIN form_submissions fs ON fs.id = NEW.submission_id
  WHERE ff.id = NEW.field_id
    AND ff.form_id = fs.form_id
)
BEGIN
  SELECT RAISE(ABORT, 'form answer field does not belong to submission form');
END;

CREATE TRIGGER trg_form_fields_preserve_answered_delete
BEFORE DELETE ON form_fields
WHEN EXISTS (SELECT 1 FROM form_submission_answers WHERE field_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'answered form fields must be archived, not deleted');
END;

CREATE TRIGGER trg_form_fields_preserve_answered_move
BEFORE UPDATE OF form_id ON form_fields
WHEN EXISTS (SELECT 1 FROM form_submission_answers WHERE field_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'answered form fields cannot move between forms');
END;

-- Form editing reads the current stable field set before planning one D1
-- batch. This optimistic guard makes a stale plan abort before metadata,
-- fields, or audit history can diverge.
CREATE TABLE form_mutation_guards (
  id                  TEXT NOT NULL PRIMARY KEY,
  form_id             TEXT NOT NULL,
  expected_updated_at TEXT NOT NULL,
  new_updated_at      TEXT NOT NULL,
  FOREIGN KEY(form_id) REFERENCES forms(id)
);

CREATE TRIGGER trg_form_mutation_guard_validate
BEFORE INSERT ON form_mutation_guards
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM forms
    WHERE id = NEW.form_id AND updated_at = NEW.expected_updated_at
  ) THEN RAISE(ABORT, 'FORM_CHANGED') END;
END;

CREATE TRIGGER trg_form_mutation_guard_advance
AFTER INSERT ON form_mutation_guards
BEGIN
  UPDATE forms SET updated_at = NEW.new_updated_at WHERE id = NEW.form_id;
  DELETE FROM form_mutation_guards WHERE id = NEW.id;
END;

-- Physical deletion is allowed only when every durable response projection is
-- empty. The guard runs inside the deletion batch so a concurrent registration,
-- proposal, or normalized submission cannot race the eligibility check.
CREATE TABLE form_deletion_guards (
  id      TEXT NOT NULL PRIMARY KEY,
  form_id TEXT NOT NULL,
  FOREIGN KEY(form_id) REFERENCES forms(id)
);

CREATE TRIGGER trg_form_deletion_guard_validate
BEFORE INSERT ON form_deletion_guards
WHEN EXISTS (SELECT 1 FROM form_submissions fs WHERE fs.form_id = NEW.form_id)
  OR EXISTS (
    SELECT 1 FROM form_domain_response_evidence evidence
    WHERE evidence.form_id = NEW.form_id
  )
BEGIN
  SELECT RAISE(ABORT, 'FORM_HAS_RESPONSE_EVIDENCE');
END;

CREATE TRIGGER trg_form_deletion_guard_release
AFTER INSERT ON form_deletion_guards
BEGIN
  DELETE FROM form_deletion_guards WHERE id = NEW.id;
END;

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
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

INSERT OR IGNORE INTO form_fields (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
VALUES
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'job_title', 'Role / Job Title', 'text', 0, NULL, NULL, 10, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   -- Any professional profile that verifies the applicant is accepted —
   -- LinkedIn works, and so does a leadership page at their employer. The
   -- key stays 'linkedin' as the stored-answer identifier; on approval the
   -- value joins the canonical links list, where no platform is special.
   'linkedin', 'Professional profile (e.g., LinkedIn)', 'url', 0, NULL,
   '{"placeholder": "https://www.linkedin.com/in/your-name or your employer''s page about you"}',
   20, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'organization_website', 'Organization Website', 'url', 0, NULL, NULL, 30, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'about_yourself', 'About Yourself', 'textarea', 0, NULL, NULL, 40, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'about_organization', 'About Your Organization', 'textarea', 0, NULL, NULL, 50, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'reason', 'Why do you want to join PKI Consortium?', 'textarea', 1, NULL, NULL, 60, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'working_groups', 'Working Groups of Interest', 'multi_select', 0,
   NULL,
   '{"uiWidget":"checkboxes"}', 70, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'contribution_type', 'How do you expect to participate?', 'select', 0,
   '[{"value":"active","label":"Actively contribute to the consortium and its mission"},{"value":"observer","label":"Observe without actively contributing"}]',
   '{"helpText":"Members are not required to attend every meeting or participate in every activity."}', 80, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'wants_to_present', 'I would like to introduce myself, my organization, and our participation goals to the consortium', 'boolean', 0,
   NULL, NULL, 90, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'interested_in_sponsoring', 'I would like to discuss sponsoring or donating to the consortium', 'boolean', 0,
   NULL, '{"helpText":"Membership has no fee; sponsorships and donations support the consortium."}', 100, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'agrees_bylaws', 'I and my organization (if applicable) agree to follow the PKI Consortium Bylaws', 'boolean', 1,
   NULL, '{"requireTrue":true,"referenceLink":{"href":"/bylaws/","label":"Read the PKI Consortium Bylaws"}}', 110, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'agrees_code_of_conduct', 'I and my organization (if applicable) agree to follow the PKI Consortium Code of Conduct', 'boolean', 1,
   NULL, '{"requireTrue":true,"referenceLink":{"href":"/code-of-conduct/","label":"Read the PKI Consortium Code of Conduct"}}', 120, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'agrees_ipr_policy', 'I and my organization (if applicable) agree to follow the PKI Consortium IPR Policy', 'boolean', 1,
   NULL, '{"requireTrue":true,"referenceLink":{"href":"/ipr/","label":"Read the PKI Consortium IPR Policy"}}', 130, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), (SELECT id FROM forms WHERE key = 'membership-application'),
   'warranted_authority', 'I represent and warrant that I have authority to submit this application and agree to be bound by these terms', 'boolean', 1,
   NULL, '{"requireTrue":true}', 140, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

UPDATE form_fields
SET option_source = 'active_working_groups'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'working_groups';

UPDATE form_fields
SET updated_at = created_at
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND updated_at IS NULL;

INSERT OR IGNORE INTO form_placements
  (id, form_id, owner_group_id, context_type, context_ref, audience, active,
   opens_at, closes_at, created_at, updated_at)
VALUES (
  '50000000-0000-4000-8000-000000000001',
  (SELECT id FROM forms WHERE key = 'membership-application'),
  NULL,
  'installation',
  NULL,
  'prospective_member',
  1,
  NULL,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

-- ── Email templates ──────────────────────────────────────

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'proposal_canceled', 1,
    'Session canceled: {{proposalTitleText}}',
    'Hi {{firstNameText}},

The accepted session **{{proposalTitleText}}** for **{{eventNameText}}** has been canceled by the program team.

Reason: {{cancellationCommentText}}

No further speaker action is required.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'membership_join_verify', 1,
    'Verify your email address to join the PKI Consortium',
    'Use the secure, short-lived link below to verify your email address and continue joining the PKI Consortium.

[Verify email and continue]({{verificationUrl}})

If you did not request this link, you can safely ignore this email.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-received', 1,
    'We received your PKI Consortium membership application',
    'Hi {{applicantName}},

Thank you for applying for PKI Consortium membership. We have received your application and a member of our team will review it shortly.

You can check the status of your application at any time:
[Check application status]({{statusUrl}})

If you have any questions, just reply to this email.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-brochure', 1,
    'PKI Consortium sponsorship information',
    'Hi {{contactNameText}},

Thank you for your interest in sponsoring the PKI Consortium{{#if eventNameText}} — {{eventNameText}}{{/if}}. Attached is our sponsorship brochure with tier details and benefits.

Brochure: [{{brochureUrl}}]({{brochureUrl}})

A member of our team will follow up with you shortly to discuss next steps.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-new-inquiry', 1,
    'New sponsorship inquiry',
    'A new sponsorship inquiry was submitted.

- Contact: {{contactNameText}} ({{contactEmailText}})
- Organization: {{organizationNameText}}
- Sponsor type: {{sponsorTypeText}}
- Tier: {{tierText}}
- Notes: {{notesText}}

[View sponsorship]({{managementUrl}})',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  );

-- Section: Membership category assignment + acting identities
--
-- `members` (migration 0000) already models the aggregate this PR needs —
-- one row per organization or per individual, mutual exclusivity of
-- user_id/organization_id already enforced — so it is never rebuilt or
-- altered by this PR. What was missing is a home for (1) the membership
-- category of an aggregate and (2) the N people who represent an
-- organization-tied aggregate. Both are additive, 1:1-or-1:N tables keyed
-- off members.id, not columns bolted onto members/organizations.
--
-- Representative contact designations deliberately do not get their own
-- table here — they reuse the
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

-- Category reference reads and any category evolution touch this FK column.
CREATE INDEX idx_member_category_assignments_category
  ON member_category_assignments(category_code);

-- ── Acting identities ────────────────────────────────────────────────────
-- Sparse, approved Member identities are the single source of truth for the
-- capacity in which a user acts. Most users have one organization identity;
-- an organization-less identity exists only for an approved individual
-- Member. organization_id is the discriminator, so there is no kind column or
-- copied member_id. Member ownership is derived by the sargable view below.
CREATE TABLE identities (
  id                           TEXT NOT NULL PRIMARY KEY,
  user_id                      TEXT NOT NULL,
  organization_id              TEXT,
  -- NULL selects the user's primary address. A non-NULL value selects one
  -- verified address from user_emails; the address text is never copied.
  email_id                      TEXT,
  -- Individual identities never carry an affiliation or editable job title.
  job_title                     TEXT,
  biography                     TEXT,
  links_json                    TEXT,
  source                        TEXT NOT NULL,
  -- allowed: membership_approval | verified_domain | organization_contact |
  --          staff | migration
  show_on_organization_profile  INTEGER NOT NULL DEFAULT 1
                                  CHECK (show_on_organization_profile IN (0, 1)),
  -- The identity a record speaks from when it has to choose one: the About a
  -- person's record leads with, and the affiliation shown beside their name.
  -- A person holds several and only they know which represents them, so it is
  -- marked rather than guessed from a start date or an organization's
  -- presence. Nothing requires a default: with none marked, a record falls
  -- back to the first active affiliation, which is what it did before.
  is_default                    INTEGER NOT NULL DEFAULT 0
                                  CHECK (is_default IN (0, 1)),
  invited_at                    TEXT NOT NULL,
  started_at                    TEXT,
  ended_at                      TEXT,
  blocked_at                    TEXT,
  blocked_by_user_id            TEXT,
  predecessor_identity_id       TEXT,
  created_at                    TEXT NOT NULL,
  updated_at                    TEXT NOT NULL,
  CHECK (started_at IS NULL OR started_at >= invited_at),
  CHECK (ended_at IS NULL OR ended_at >= COALESCE(started_at, invited_at)),
  CHECK (blocked_at IS NULL OR ended_at IS NOT NULL),
  CHECK (
    organization_id IS NOT NULL
    OR (job_title IS NULL AND show_on_organization_profile = 0)
  ),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id),
  FOREIGN KEY(email_id) REFERENCES user_emails(id) ON DELETE SET NULL,
  FOREIGN KEY(blocked_by_user_id) REFERENCES users(id),
  FOREIGN KEY(predecessor_identity_id) REFERENCES identities(id)
);

CREATE UNIQUE INDEX uq_identities_active_organization
  ON identities(user_id, organization_id)
  WHERE organization_id IS NOT NULL
    AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL;
CREATE UNIQUE INDEX uq_identities_active_individual
  ON identities(user_id)
  WHERE organization_id IS NULL
    AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL;
CREATE INDEX idx_identities_user_lifecycle
  ON identities(user_id, ended_at, blocked_at, started_at, invited_at);
CREATE INDEX idx_identities_organization_lifecycle
  ON identities(organization_id, ended_at, blocked_at, started_at, invited_at)
  WHERE organization_id IS NOT NULL;
-- At most one default per person, enforced structurally rather than by the
-- write path remembering to clear the previous one. A partial index says
-- exactly that and costs nothing for the rows not marked.
CREATE UNIQUE INDEX uq_identities_default
  ON identities(user_id) WHERE is_default = 1;
CREATE INDEX idx_identities_email ON identities(email_id) WHERE email_id IS NOT NULL;
CREATE INDEX idx_identities_predecessor
  ON identities(predecessor_identity_id) WHERE predecessor_identity_id IS NOT NULL;

-- One canonical, index-friendly projection resolves an identity to its unique
-- Member aggregate without copying member_id into identities.
CREATE VIEW identity_member_capacities AS
  SELECT identity.id AS identity_id, identity.user_id, member.id AS member_id,
         identity.organization_id, member.member_type, member.status AS member_status,
         category.category_code AS membership_category
    FROM identities identity
    JOIN members member ON member.organization_id = identity.organization_id
    JOIN member_category_assignments category ON category.member_id = member.id
   WHERE identity.organization_id IS NOT NULL
  UNION ALL
  SELECT identity.id, identity.user_id, member.id, NULL,
         member.member_type, member.status, category.category_code
    FROM identities identity
    JOIN members member ON member.user_id = identity.user_id
    JOIN member_category_assignments category ON category.member_id = member.id
   WHERE identity.organization_id IS NULL;

CREATE TRIGGER trg_identities_email_insert
BEFORE INSERT ON identities
WHEN NEW.email_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM user_emails address
    WHERE address.id = NEW.email_id
      AND address.user_id = NEW.user_id
      AND address.verified_at IS NOT NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'IDENTITY_EMAIL_INVALID');
END;

CREATE TRIGGER trg_identities_email_update
BEFORE UPDATE OF user_id, email_id ON identities
WHEN NEW.email_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM user_emails address
    WHERE address.id = NEW.email_id
      AND address.user_id = NEW.user_id
      AND address.verified_at IS NOT NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'IDENTITY_EMAIL_INVALID');
END;

CREATE TRIGGER trg_identities_member_scope_insert
BEFORE INSERT ON identities
WHEN NOT EXISTS (
  SELECT 1
    FROM members member
    LEFT JOIN member_category_assignments category ON category.member_id = member.id
   WHERE (
     NEW.organization_id IS NOT NULL
     AND member.organization_id = NEW.organization_id
     AND member.member_type = 'organization'
   ) OR (
     NEW.organization_id IS NULL
     AND member.user_id = NEW.user_id
     AND member.member_type = 'individual'
     AND category.category_code IN ('H5', 'H6', 'H7')
   )
)
BEGIN
  SELECT RAISE(ABORT, 'IDENTITY_MEMBER_SCOPE_INVALID');
END;

CREATE TRIGGER trg_identities_member_scope_update
BEFORE UPDATE OF user_id, organization_id ON identities
WHEN NEW.user_id IS NOT OLD.user_id OR NEW.organization_id IS NOT OLD.organization_id
BEGIN
  SELECT RAISE(ABORT, 'IDENTITY_SCOPE_IMMUTABLE');
END;

-- A person acts either as an approved individual Member or through one or
-- more organizations, never both. Service checks provide useful errors; these
-- triggers close concurrent-writer races at the D1 boundary.
CREATE TRIGGER trg_identities_reject_individual_conflict_insert
BEFORE INSERT ON identities
WHEN NEW.started_at IS NOT NULL AND NEW.ended_at IS NULL AND NEW.blocked_at IS NULL
 AND EXISTS (
   SELECT 1 FROM identities active
    WHERE active.user_id = NEW.user_id
      AND active.organization_id IS NOT NEW.organization_id
      AND (active.organization_id IS NULL OR NEW.organization_id IS NULL)
      AND active.started_at IS NOT NULL
      AND active.ended_at IS NULL AND active.blocked_at IS NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'individual and organization identities are mutually exclusive');
END;

CREATE TRIGGER trg_identities_reject_individual_conflict_update
BEFORE UPDATE OF started_at, ended_at, blocked_at ON identities
WHEN NEW.started_at IS NOT NULL AND NEW.ended_at IS NULL AND NEW.blocked_at IS NULL
 AND EXISTS (
   SELECT 1 FROM identities active
    WHERE active.id <> NEW.id
      AND active.user_id = NEW.user_id
      AND active.organization_id IS NOT NEW.organization_id
      AND (active.organization_id IS NULL OR NEW.organization_id IS NULL)
      AND active.started_at IS NOT NULL
      AND active.ended_at IS NULL AND active.blocked_at IS NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'individual and organization identities are mutually exclusive');
END;

CREATE TRIGGER trg_members_reject_organization_identity_insert
BEFORE INSERT ON members
WHEN NEW.member_type = 'individual' AND NEW.status = 'active'
 AND EXISTS (
   SELECT 1 FROM identities identity
    WHERE identity.user_id = NEW.user_id
      AND identity.organization_id IS NOT NULL
      AND identity.started_at IS NOT NULL
      AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'individual and organization identities are mutually exclusive');
END;

CREATE TRIGGER trg_members_reject_organization_identity_update
BEFORE UPDATE OF user_id, member_type, status ON members
WHEN NEW.member_type = 'individual' AND NEW.status = 'active'
 AND EXISTS (
   SELECT 1 FROM identities identity
    WHERE identity.user_id = NEW.user_id
      AND identity.organization_id IS NOT NULL
      AND identity.started_at IS NOT NULL
      AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'individual and organization identities are mutually exclusive');
END;

-- Closing or blocking an identity immediately removes its active group and
-- role capacities. Historical memberships and actions remain intact.
CREATE TRIGGER trg_identities_end_capacities
AFTER UPDATE OF ended_at, blocked_at ON identities
WHEN (OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL)
  OR (OLD.blocked_at IS NULL AND NEW.blocked_at IS NOT NULL)
BEGIN
  UPDATE group_memberships
  SET left_at = COALESCE(NEW.ended_at, NEW.blocked_at),
      updated_at = NEW.updated_at
  WHERE identity_id = NEW.id
    AND left_at IS NULL;

  UPDATE user_roles
  SET revoked_at = COALESCE(NEW.ended_at, NEW.blocked_at)
  WHERE identity_id = NEW.id
    AND revoked_at IS NULL;
END;

-- A group capacity must resolve to one active identity. Once a user acts
-- through an organization, individual group participation is disallowed to
-- avoid ambiguous IPR attribution.
CREATE TRIGGER trg_group_memberships_validate_capacity_insert
BEFORE INSERT ON group_memberships
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM identity_member_capacities capacity
    JOIN identities identity ON identity.id = capacity.identity_id
    WHERE capacity.identity_id = NEW.identity_id
      AND capacity.member_id = NEW.member_id
      AND capacity.user_id = NEW.user_id
      AND identity.started_at IS NOT NULL
      -- A seat written already closed is roster history: it grants nothing
      -- and needs only the capacity the person once held. An open seat needs
      -- a live one.
      AND (
        NEW.left_at IS NOT NULL
        OR (
          capacity.member_status = 'active'
          AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
        )
      )
  ) THEN RAISE(ABORT, 'active identity required') END;
END;

CREATE TRIGGER trg_group_memberships_validate_capacity_reactivate
BEFORE UPDATE OF left_at ON group_memberships
WHEN OLD.left_at IS NOT NULL AND NEW.left_at IS NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM identity_member_capacities capacity
    JOIN identities identity ON identity.id = capacity.identity_id
    WHERE capacity.identity_id = NEW.identity_id
      AND capacity.member_id = NEW.member_id
      AND capacity.user_id = NEW.user_id
      AND capacity.member_status = 'active'
      AND identity.started_at IS NOT NULL
      AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
  ) THEN RAISE(ABORT, 'active identity required') END;
END;

CREATE TRIGGER trg_group_memberships_identity_immutable
BEFORE UPDATE OF group_id, user_id, identity_id, member_id ON group_memberships
WHEN NEW.group_id <> OLD.group_id
  OR NEW.user_id <> OLD.user_id
  OR NEW.identity_id <> OLD.identity_id
  OR NEW.member_id <> OLD.member_id
BEGIN
  SELECT RAISE(ABORT, 'group membership identity is immutable');
END;

-- Group leadership is authority exercised through one explicit participating
-- Member capacity. Leaving that exact group capacity immediately ends every
-- local leadership assignment held through it; the historical role row stays
-- attributable to both the person and the represented Member.
CREATE TRIGGER trg_group_memberships_end_leadership
AFTER UPDATE OF left_at ON group_memberships
WHEN OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
BEGIN
  UPDATE user_roles
     SET revoked_at = NEW.left_at
   WHERE user_id = NEW.user_id
     AND member_id = NEW.member_id
     AND context_type = 'group'
     AND context_id = NEW.group_id
     AND role_id IN ('role-group_lead', 'role-group_deputy_lead')
     AND revoked_at IS NULL;
END;

-- Section: Fine-Grained Access Control
--
-- Adds the roles/user_roles/permission_grants model from,
-- seeds the built-in roles from, and executes the
-- backfills (event_permissions → user_roles, users.role='admin' →
-- user_roles), then drops event_permissions resolution.
--
-- One deviation from the original literal schema:
--
-- 1. `role_permissions` is a new table, not present anywhere in
--    describes each built-in role's default permission bundle in prose only
--    and says bundles must be admin-customizable ("their permission bundles
--    can be customized by an admin as the portal evolves") — that requires
--    somewhere to actually store and edit the bundle. This is the same
--    class of gap.
--
-- Pre-provisioning creates a minimal `users` identity and binds authorization
-- to its immutable ID. Email-only grants are deliberately not carried into
-- the new model because authorization must not transfer if an address is
-- later released and reused by another account.
--
-- `permission_grants` is created exactly as specified. The draft
-- `refresh_tokens` table is intentionally omitted: canonical user sessions
-- and stateless capability links have their own revocation mechanisms, and no
-- production flow issues or consumes refresh tokens.

CREATE TABLE roles (
  id             TEXT    NOT NULL PRIMARY KEY,
  name           TEXT    NOT NULL UNIQUE,
  description    TEXT,
  is_system_role INTEGER NOT NULL DEFAULT 0 CHECK (is_system_role IN (0, 1)),
  single_holder_per_context INTEGER NOT NULL DEFAULT 0 CHECK (single_holder_per_context IN (0, 1)),
  -- when 1, at most one active grant of this role may exist per
  -- (context_type, context_id) — see uq_user_roles_single_holder_per_context
  -- below. Used by the two organization-contact roles seeded at the end of
  -- this migration (one primary and one secondary contact per organization).
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
  user_id            TEXT NOT NULL,
  role_id            TEXT NOT NULL,
  context_type       TEXT,
  -- allowed: 'event' | 'group' | 'organization' | NULL (global)
  context_id         TEXT,
  -- Exact acting identity for organization-contact and group-leadership roles.
  -- Global and event staff roles remain person-scoped and leave this NULL.
  identity_id        TEXT,
  -- Required for group leadership and forbidden for unrelated role types.
  -- It records the one Member capacity on whose behalf the role is held.
  member_id          TEXT,
  -- Group leadership only: the title the assignment was made with ("Chair",
  -- "Co-Chair", "Lead") and the tenure start shown on public rosters. The
  -- title is a snapshot so a later group-type rename never rewrites history;
  -- starts_at is display-only and never widens or narrows authority, which
  -- remains created_at → revoked_at/expires_at.
  title              TEXT,
  starts_at          TEXT,
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
  FOREIGN KEY(identity_id) REFERENCES identities(id),
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(granted_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_context ON user_roles(context_type, context_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
CREATE INDEX idx_user_roles_member ON user_roles(member_id)
  WHERE member_id IS NOT NULL;
CREATE INDEX idx_user_roles_identity ON user_roles(identity_id)
  WHERE identity_id IS NOT NULL;
CREATE UNIQUE INDEX uq_user_roles_single_holder_per_context
  ON user_roles(context_type, context_id, role_id)
  WHERE revoked_at IS NULL AND single_holder_per_context = 1;

-- `context_id` is intentionally polymorphic because a role may be scoped to
-- an event, group, or membership aggregate. Keep that flexibility,
-- but enforce the finite context vocabulary and ensure every scoped grant
-- points at a live aggregate. Without these guards a typo or direct SQL import
-- can create an authorization row that can never be resolved or revoked by
-- its owning resource.
CREATE TRIGGER validate_user_role_context_insert
BEFORE INSERT ON user_roles
FOR EACH ROW
WHEN (NEW.context_type IS NULL AND NEW.context_id IS NOT NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_id IS NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_type NOT IN ('event', 'group', 'organization'))
  OR (NEW.context_type = 'event' AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.context_id))
  OR (NEW.context_type = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = NEW.context_id))
  OR (NEW.context_type = 'organization' AND NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.context_id))
  OR (
    NEW.revoked_at IS NULL
    AND NEW.role_id IN ('role-group_lead', 'role-group_deputy_lead')
    AND (
      NEW.context_type <> 'group'
      OR NEW.identity_id IS NULL
      OR NEW.member_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM group_memberships membership
         WHERE membership.group_id = NEW.context_id
           AND membership.user_id = NEW.user_id
           AND membership.identity_id = NEW.identity_id
           AND membership.member_id = NEW.member_id
           AND membership.left_at IS NULL
      )
    )
  )
  OR (
    (NEW.identity_id IS NOT NULL OR NEW.member_id IS NOT NULL)
    AND NOT (NEW.context_type = 'group' AND NEW.role_id IN ('role-group_lead', 'role-group_deputy_lead'))
    AND NOT (NEW.context_type = 'organization' AND NEW.role_id IN ('role-primary_contact', 'role-secondary_contact'))
  )
BEGIN
  SELECT RAISE(ABORT, 'USER_ROLE_CONTEXT_INVALID');
END;

CREATE TRIGGER validate_user_role_context_update
BEFORE UPDATE OF user_id, role_id, context_type, context_id, identity_id, member_id, revoked_at ON user_roles
FOR EACH ROW
WHEN (NEW.context_type IS NULL AND NEW.context_id IS NOT NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_id IS NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_type NOT IN ('event', 'group', 'organization'))
  OR (NEW.context_type = 'event' AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.context_id))
  OR (NEW.context_type = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = NEW.context_id))
  OR (NEW.context_type = 'organization' AND NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.context_id))
  OR (
    NEW.revoked_at IS NULL
    AND NEW.role_id IN ('role-group_lead', 'role-group_deputy_lead')
    AND (
      NEW.context_type <> 'group'
      OR NEW.identity_id IS NULL
      OR NEW.member_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM group_memberships membership
         WHERE membership.group_id = NEW.context_id
           AND membership.user_id = NEW.user_id
           AND membership.identity_id = NEW.identity_id
           AND membership.member_id = NEW.member_id
           AND membership.left_at IS NULL
      )
    )
  )
  OR (
    (NEW.identity_id IS NOT NULL OR NEW.member_id IS NOT NULL)
    AND NOT (NEW.context_type = 'group' AND NEW.role_id IN ('role-group_lead', 'role-group_deputy_lead'))
    AND NOT (NEW.context_type = 'organization' AND NEW.role_id IN ('role-primary_contact', 'role-secondary_contact'))
  )
BEGIN
  SELECT RAISE(ABORT, 'USER_ROLE_CONTEXT_INVALID');
END;

-- Organization-contact designations are identity-owned facts: an organization
-- role grant is valid only while its user has an active identity resolving to
-- the same Member aggregate. Keep this
-- invariant at the D1 write boundary as well as in the service preflight. The
-- trigger is deliberately aborting rather than silently filtering an INSERT,
-- so a stale preflight cannot revoke the current holder and report success
-- without installing the replacement.
CREATE TRIGGER trg_user_roles_identity_requires_active
BEFORE INSERT ON user_roles
WHEN NEW.context_type = 'organization'
  AND NEW.role_id IN ('role-primary_contact', 'role-secondary_contact')
  AND NEW.revoked_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM identities identity
    JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
    WHERE capacity.member_id = NEW.context_id
      AND capacity.identity_id = NEW.identity_id
      AND identity.user_id = NEW.user_id
      AND identity.started_at IS NOT NULL
      AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'organization role requires an active identity');
END;

CREATE TRIGGER trg_user_roles_identity_update_requires_active
BEFORE UPDATE OF user_id, role_id, context_type, context_id, identity_id, revoked_at ON user_roles
WHEN NEW.context_type = 'organization'
  AND NEW.role_id IN ('role-primary_contact', 'role-secondary_contact')
  AND NEW.revoked_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM identities identity
    JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
    WHERE capacity.member_id = NEW.context_id
      AND capacity.identity_id = NEW.identity_id
      AND identity.user_id = NEW.user_id
      AND identity.started_at IS NOT NULL
      AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'organization role requires an active identity');
END;

-- Preserve the active-grant uniqueness that the legacy event_permissions
-- table enforced and extend it to every non-singleton role assignment.
CREATE UNIQUE INDEX uq_user_roles_active_user_role_context
  ON user_roles(role_id, COALESCE(context_type, ''), COALESCE(context_id, ''), user_id,
                COALESCE(identity_id, ''), COALESCE(member_id, ''))
  WHERE revoked_at IS NULL AND single_holder_per_context = 0;

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
-- A user can hold one active direct permission per global or scoped context.
-- Retained revoked rows remain available for audit history and can be followed
-- by a later re-grant without weakening this effective-authority invariant.
CREATE UNIQUE INDEX uq_permission_grants_active_user_permission_context
  ON permission_grants(user_id, permission, COALESCE(context_type, ''), COALESCE(context_id, ''))
  WHERE revoked_at IS NULL;

CREATE TRIGGER validate_permission_grant_context_insert
BEFORE INSERT ON permission_grants
FOR EACH ROW
WHEN (NEW.context_type IS NULL AND NEW.context_id IS NOT NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_id IS NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_type NOT IN ('event', 'group', 'organization'))
  OR (NEW.context_type = 'event' AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.context_id))
  OR (NEW.context_type = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = NEW.context_id))
  OR (NEW.context_type = 'organization' AND NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.context_id))
BEGIN
  SELECT RAISE(ABORT, 'PERMISSION_GRANT_CONTEXT_INVALID');
END;

CREATE TRIGGER validate_permission_grant_context_update
BEFORE UPDATE OF context_type, context_id ON permission_grants
FOR EACH ROW
WHEN (NEW.context_type IS NULL AND NEW.context_id IS NOT NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_id IS NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_type NOT IN ('event', 'group', 'organization'))
  OR (NEW.context_type = 'event' AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.context_id))
  OR (NEW.context_type = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = NEW.context_id))
  OR (NEW.context_type = 'organization' AND NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.context_id))
BEGIN
  SELECT RAISE(ABORT, 'PERMISSION_GRANT_CONTEXT_INVALID');
END;

-- State-changing services use one shared transient guard to re-evaluate their
-- canonical authorization or eligibility SELECT inside the same D1 batch as
-- the protected writes. The evidence query stays in the owning TypeScript
-- domain module, so database atomicity does not create a second copy of group,
-- representative, or resource policy in migration triggers.
CREATE TABLE authorization_guards (
  id         TEXT NOT NULL PRIMARY KEY,
  authorized INTEGER NOT NULL CHECK (authorized IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TRIGGER trg_authorization_guard_validate
BEFORE INSERT ON authorization_guards
WHEN NEW.authorized <> 1
BEGIN
  SELECT RAISE(ABORT, 'AUTHORIZATION_CONTEXT_CHANGED');
END;

CREATE TRIGGER trg_authorization_guard_release
AFTER INSERT ON authorization_guards
BEGIN
  DELETE FROM authorization_guards WHERE id = NEW.id;
END;

-- Retain authorization history rather than deleting its parent and leaving
-- stale polymorphic context IDs behind. Existing FK-backed children already
-- provide the same protection for their own aggregates.
CREATE TRIGGER protect_event_context_delete
BEFORE DELETE ON events
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM user_roles WHERE context_type = 'event' AND context_id = OLD.id)
   OR EXISTS (SELECT 1 FROM permission_grants WHERE context_type = 'event' AND context_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'EVENT_HAS_AUTHORIZATION_CONTEXT');
END;

CREATE TRIGGER protect_group_context_delete
BEFORE DELETE ON groups
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM user_roles WHERE context_type = 'group' AND context_id = OLD.id)
   OR EXISTS (SELECT 1 FROM permission_grants WHERE context_type = 'group' AND context_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'GROUP_HAS_AUTHORIZATION_CONTEXT');
END;

CREATE TRIGGER protect_membership_context_delete
BEFORE DELETE ON members
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM user_roles WHERE context_type = 'organization' AND context_id = OLD.id)
   OR EXISTS (SELECT 1 FROM permission_grants WHERE context_type = 'organization' AND context_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'MEMBERSHIP_HAS_AUTHORIZATION_CONTEXT');
END;

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
  ('role-admin', 'admin', 'Full access', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role-membership_processor', 'membership_processor', 'Membership workflow only', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role-group_lead', 'group_lead', 'Leads a group and, by policy, its descendants', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role-group_deputy_lead', 'group_deputy_lead', 'Acts with the same group-management capabilities as a group lead', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role-event_organizer', 'event_organizer', 'Full management of a specific event', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role-program_committee', 'program_committee', 'Proposal review and agenda setting for a specific event', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role-member', 'member', 'Legacy authenticated member classification', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role-interested_parties', 'interested_parties', 'Legacy interested-party classification', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role-event_moderator', 'event_moderator', 'Event-scoped proposal review, no finalize (backfilled from event_permissions.moderator)', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role-event_volunteer', 'event_volunteer', 'Historical placeholder, no permissions (backfilled from event_permissions.volunteer)', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ── Default permission bundles ──────────────────────────────────────────────
--
-- `admin` gets every permission string in the system, including the
-- `admin:read` / `admin:write` fallback pair used for admin routes that
-- don't yet belong to one of named modules (stats, portal-managed
-- forms config, bulk email campaigns).
--
-- `event_organizer`'s bundle extends beyond literal
-- events:write/events:manage to also include proposals:read,
-- proposals:score, proposals:manage, proposals:edit_accepted_abstract,
-- proposals:cancel_accepted,
-- agenda:read, agenda:write — justified by
-- persona description ("manage capacity, send communications, manage
-- registrations, and view all attendee and proposal data for that event"),
-- and needed so an organizer's event access isn't missing proposal/agenda
-- management that the old event_permissions 'organizer' value already
-- granted via canFinalize.

INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES
  (lower(hex(randomblob(16))), 'role-admin', 'membership:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'membership:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'identities:activate', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'membership:approve', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'events:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'events:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'events:manage', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'groups:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'groups:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'email-templates:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'email-templates:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'forms:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'forms:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'email:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'email:manage', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'donations:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'donations:sync', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'users:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'users:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'users:anonymize', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'audit:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'analytics:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'retention:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'retention:run', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'scheduler:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'scheduler:manage', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'access:grant', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'access:revoke', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'organizations:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'organizations:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'organizations:content-review', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'sponsorships:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'sponsorships:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'votes:create', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'votes:manage', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'proposals:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'proposals:score', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'proposals:manage', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'proposals:edit_accepted_abstract', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'proposals:cancel_accepted', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'agenda:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'agenda:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'admin:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-admin', 'admin:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  (lower(hex(randomblob(16))), 'role-membership_processor', 'membership:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-membership_processor', 'membership:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-membership_processor', 'membership:approve', strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  (lower(hex(randomblob(16))), 'role-group_lead', 'groups:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-group_lead', 'groups:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-group_lead', 'votes:create', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-group_lead', 'votes:manage', strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  (lower(hex(randomblob(16))), 'role-group_deputy_lead', 'groups:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-group_deputy_lead', 'groups:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-group_deputy_lead', 'votes:create', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-group_deputy_lead', 'votes:manage', strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  (lower(hex(randomblob(16))), 'role-event_organizer', 'events:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'events:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'events:manage', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'proposals:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'proposals:score', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'proposals:manage', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'proposals:edit_accepted_abstract', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'proposals:cancel_accepted', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'agenda:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'agenda:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  (lower(hex(randomblob(16))), 'role-program_committee', 'proposals:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'proposals:score', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'proposals:manage', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'proposals:edit_accepted_abstract', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'proposals:cancel_accepted', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'agenda:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'agenda:write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  (lower(hex(randomblob(16))), 'role-event_moderator', 'proposals:read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-event_moderator', 'proposals:score', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  (lower(hex(randomblob(16))), 'role-event_moderator', 'agenda:read', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ── Backfill: users.role='admin' → user_roles ────────────────────────

INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, expires_at, revoked_at, created_at)
SELECT lower(hex(randomblob(16))), u.id, 'role-admin', NULL, NULL, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM users u
WHERE u.role = 'admin';

-- ── Backfill: event_permissions → user_roles ─────────────────────────

-- Preserve pre-provisioned grants without leaving authorization attached to
-- a reusable string identifier.
INSERT OR IGNORE INTO users (id, email, normalized_email, role, active, created_at, updated_at)
SELECT lower(hex(randomblob(16))), ep.user_email, lower(trim(ep.user_email)), 'user', 1, ep.created_at, ep.created_at
FROM event_permissions ep
WHERE ep.user_id IS NULL;

INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, expires_at, revoked_at, created_at)
SELECT
  lower(hex(randomblob(16))),
  COALESCE(ep.user_id, (SELECT u.id FROM users u WHERE u.normalized_email = lower(trim(ep.user_email)))),
  CASE ep.permission
    WHEN 'organizer' THEN 'role-event_organizer'
    WHEN 'program_committee' THEN 'role-program_committee'
    WHEN 'moderator' THEN 'role-event_moderator'
    WHEN 'volunteer' THEN 'role-event_volunteer'
  END
  ,
  'event',
  ep.event_id,
  CASE
    WHEN EXISTS (SELECT 1 FROM users grantor WHERE grantor.id = ep.granted_by_id)
      THEN ep.granted_by_id
    ELSE NULL
  END
  ,
  NULL,
  NULL,
  ep.created_at
FROM event_permissions ep;

DROP TABLE event_permissions;

-- ── Organization identity roles ──────────────────────────────────────────
-- Reuses this same roles/user_roles system for organization identity
-- designations instead of a bespoke organization_representative_roles
-- table. Each is a singleton per organization: at most one active
-- role-primary_contact and one role-secondary_contact grant per (context_type='organization',
-- context_id=members.id) at a time — enforced by
-- uq_user_roles_single_holder_per_context above. No default permission
-- bundle: the value of these roles is the designation itself, the same as
-- group leadership designations.

INSERT INTO roles (id, name, description, is_system_role, single_holder_per_context, created_at, updated_at) VALUES
  ('role-primary_contact', 'primary_contact', 'Primary point of contact for an organization membership', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('role-secondary_contact', 'secondary_contact', 'Secondary point of contact for an organization membership', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));



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
-- unlike `sessions.token_hash`, a WebAuthn
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
-- Primary/secondary contact and per-identity profile visibility are
-- NOT columns here: primary/secondary contact are organization-context
-- role-primary_contact/role-secondary_contact grants in user_roles
-- (consolidated migration 0035), and per-identity visibility is
-- identities.show_on_organization_profile (consolidated migration 0035) — both
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
CREATE INDEX idx_organization_domain_claims_domain_org
  ON organization_domain_claims(domain, organization_id)
  WHERE organization_id IS NOT NULL;

CREATE TRIGGER validate_organization_domain_claim_owner_insert
BEFORE INSERT ON organization_domain_claims
FOR EACH ROW
WHEN (NEW.application_id IS NULL AND NEW.organization_id IS NULL)
   OR (NEW.application_id IS NOT NULL AND NEW.organization_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'DOMAIN_CLAIM_OWNER_INVALID');
END;

CREATE TRIGGER validate_organization_domain_claim_owner_update
BEFORE UPDATE OF application_id, organization_id ON organization_domain_claims
FOR EACH ROW
WHEN (NEW.application_id IS NULL AND NEW.organization_id IS NULL)
   OR (NEW.application_id IS NOT NULL AND NEW.organization_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'DOMAIN_CLAIM_OWNER_INVALID');
END;

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
-- trigger point (approval onboarding, group join/leave, deactivation) writes a
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

-- A provider-successful add must retain its enrollment notification until a
-- later bounded drain can group the successful lists for one member into the
-- same user-visible email the original sync pass emitted. The queue row is
-- the idempotent source identity; the outbox row is written only when this
-- intent is drained.
CREATE TABLE google_groups_enrollment_notification_intents (
  queue_id          TEXT NOT NULL PRIMARY KEY,
  user_id           TEXT NOT NULL,
  sync_pass_id      TEXT NOT NULL,
  google_group_email TEXT NOT NULL,
  recipient_email   TEXT NOT NULL,
  member_name       TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  queued_outbox_id  TEXT,
  queued_at         TEXT,
  FOREIGN KEY(queue_id) REFERENCES google_groups_sync_queue(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX idx_google_groups_enrollment_intents_pending
  ON google_groups_enrollment_notification_intents(sync_pass_id, user_id, created_at, queue_id)
  WHERE queued_outbox_id IS NULL;

-- ── Membership workflow settings ───────────────────────────────────
-- Single configurable row (id is always 'default') rather than a generic
-- key-value table — every setting is a distinct, typed field the
-- consultation/EC batch jobs and the system portal both read
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
  revision                      INTEGER NOT NULL DEFAULT 0,
  updated_at                    TEXT NOT NULL,
  updated_by_user_id            TEXT,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id)
);

INSERT INTO membership_settings (id, updated_at) VALUES ('default', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

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
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-hold-org-email', 1,
    'Please resubmit with your organization email address',
    'Hi {{applicantName}},

The email address on your application appears to be a personal address rather than an organizational one. Please resubmit your application using your organization''s email domain.

[Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-hold-pki-experience', 1,
    'Additional information needed for your PKI Consortium application',
    'Hi {{applicantName}},

As an individual (H6) applicant, please provide additional detail about your PKI background and experience within the next {{deadlineDays}} days.

Reply to this email or update your application: [Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-hold-org-application', 1,
    'Please resubmit as an organizational member',
    'Hi {{applicantName}},

Based on your application, we believe you should apply as an organizational member rather than an individual. Please resubmit your application under the appropriate organizational category.

[Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-hold-information', 1,
    'We need more information about your PKI Consortium application',
    'Hi {{applicantName}},

{{requestDetails}}

Reply to this email or update your application: [Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-in-consultation', 1,
    'Your PKI Consortium application has entered member consultation',
    'Hi {{applicantName}},

Your application has moved into our member consultation period, during which current members may raise questions or concerns. This typically takes up to {{consultationWindowDays}} days.

[Check application status]({{statusUrl}})',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-declined', 1,
    'Update on your PKI Consortium membership application',
    'Hi {{applicantName}},

After review, we are unable to approve your PKI Consortium membership application at this time.{{#reason}}

{{reason}}{{/reason}}

If you have questions, please reply to this email.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'application-closed-no-response', 1,
    'Your PKI Consortium membership application has been closed',
    'Hi {{applicantName}},

We did not receive a response to our request within the {{deadlineDays}}-day window, so your application has been closed. You are welcome to reapply at any time.

If this was a mistake, please reply to this email.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'consultation-batch', 1,
    'PKI Consortium member consultation — {{applicationCount}} application(s)',
    'The following prospective member application(s) are open for consultation:

{{#applications}}
- {{maskedEmail}} — {{organizationName}} ({{membershipCategory}})
{{/applications}}

Members with concerns may reply to this list or submit a concern via the portal.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'ec-review-batch', 1,
    'PKI Consortium EC review — {{applicationCount}} application(s)',
    'The following prospective member application(s) are ready for Executive Council review:

{{#applications}}
- {{organizationName}} ({{membershipCategory}}) — [Review]({{reviewUrl}})
{{/applications}}

If no EC member records a decision within {{ecReviewWindowDays}} days, applications are auto-approved.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
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
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'org-contact-assigned', 1,
    'You have been designated an organization contact',
    'Hi {{memberName}},

You have been designated the {{contactRole}} contact for your organization''s PKI Consortium profile. You can now submit organization profile changes for staff review.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'member-account-claim', 1,
    'Set up your PKI Consortium member account',
    'Hi {{memberName}},

Your PKI Consortium member account has been created. Use the link below to sign in for the first time:

[Sign in]({{loginUrl}})',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'mailing-list-enrolled', 1,
    'You have been added to PKI Consortium mailing lists',
    'Hi {{memberName}},

You have been added to the following PKI Consortium mailing lists:

{{#lists}}
- {{.}}
{{/lists}}',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'group-membership-welcome', 1,
    'You joined {{groupName}}',
    'Hi {{memberName}},

You have joined {{groupName}}. If this group has meetings, you can view upcoming occurrences and calendar subscriptions in the portal.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'user_magic_link', 1,
    'Your PKI Consortium sign-in link',
    'A sign-in link was requested for the **PKI Consortium portal**.

<div class="cta-navy"><a href="{{magicLinkUrl}}">Sign in to the portal &rarr;</a></div>

<div class="notice notice-warning">&#9888;&#65039; <strong>Security notice</strong><br>&bull; This link is valid for <strong>{{expiresInMinutes}} minutes</strong> only.<br>&bull; It can only be used <strong>once</strong> and is tied to <code>{{email}}</code>.<br>&bull; If you did not request this link, ignore this email immediately.</div>',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'existing-member-claim', 1,
    'Claim your PKI Consortium member account',
    'Hi {{memberName}},

As part of our transition to the new PKI Consortium member portal, an account has been created for you. Use the link below to claim it:

[Claim your account]({{loginUrl}})',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  );

-- Human authentication now uses one portal session and one user sign-in
-- template. Preserve the legacy version for historical outbox rendering, but
-- prevent it from appearing as an active alternative authentication flow.
UPDATE email_template_versions
SET status = 'archived'
WHERE template_key = 'admin_magic_link'
  AND status = 'active';

-- Section: Secondary email addresses
--
-- Follow-up to a real, visible problem from the YAML->D1 migration:
-- Google Groups roster CSVs used different email addresses than
-- people's canonical one, so a meaningful number of WG-roster-only emails
-- got their own bare `users` rows created rather than being recognized as
-- the same person -- real staff/members show up more than once in the
-- Users admin list, with no way to record "this account also goes by this
-- other email". Alternate addresses are deliberately non-authenticating
-- metadata; this migration does not attempt irreversible identity merges.
--
-- `users.email`/`normalized_email` remain the sole login-identifying
-- columns (NOT NULL UNIQUE, unchanged) -- this table only adds
-- admin-visible/searchable alternate emails; it does not affect magic-link
-- or passkey authentication, which continue to resolve strictly off
-- `users.normalized_email`.
--
-- Migration 0020 stored a pending account email on users, while the proof
-- capability lives on one registration. Record that owning registration so a
-- different registration capability for the same user cannot promote it.
-- A direct FK here would create a users -> registrations -> users cycle and
-- make routine fixture/data cleanup order-dependent. The owner trigger below
-- enforces the same live-row relationship without introducing that cycle.
ALTER TABLE users ADD COLUMN pending_email_change_registration_id TEXT;

-- The new address is the only mailbox that must prove control. Authorization
-- comes from the initiating actor or the narrow unconfirmed-registration
-- correction capability, never from continued access to the old mailbox.
INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type,
   r2_object_key, checksum_sha256, status, created_by_user_id, created_at)
VALUES (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(6))),
  'registration_email_change', 1,
  'Confirm your new email address for {{eventName}}',
  'A request was made to change the login email for your account from **{{currentEmail}}** to **{{newEmail}}**.

[Confirm this new email address]({{confirmationUrl}})

The account login email will change only after you open this link. If you did not request this change, do not open the link.',
  'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type,
   r2_object_key, checksum_sha256, status, created_by_user_id, created_at)
VALUES (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(6))),
  'registration_email_change_notice', 1,
  'Your account email change was requested',
  'The login email for your account was requested to change from **{{currentEmail}}** to **{{newEmail}}**.

The old address is not required to approve this change. The new address must be confirmed before the login email changes.

If you did not expect this request, [contact the PKI Consortium]({{contactUrl}}) promptly.',
  'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

CREATE UNIQUE INDEX uq_users_pending_email_change_registration
  ON users(pending_email_change_registration_id)
  WHERE pending_email_change_registration_id IS NOT NULL;

-- The application precheck gives a useful response, while this partial index
-- closes the D1 race where two accounts reserve the same new login address in
-- concurrent batches.
CREATE UNIQUE INDEX uq_users_pending_email
  ON users(pending_email)
  WHERE pending_email IS NOT NULL;

-- Preserve an in-flight pre-0035 request when its owner is unambiguous. Rows
-- with multiple pending registrations remain unbound and therefore cannot be
-- promoted automatically; staff can recover those exceptional legacy cases.
UPDATE users
   SET pending_email_change_registration_id = (
     SELECT MIN(r.id)
       FROM registrations r
      WHERE r.user_id = users.id
        AND r.status = 'pending_email_confirmation'
   )
 WHERE pending_email IS NOT NULL
   AND 1 = (
     SELECT COUNT(*)
       FROM registrations r
      WHERE r.user_id = users.id
        AND r.status = 'pending_email_confirmation'
   );

-- Primary and alternate addresses carry explicit proof. A pending address is
-- never eligible for domain-based organization representation. Existing
-- accounts remain unverified for this purpose until a proof-producing flow
-- records evidence; migration history alone must not imply mailbox control.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN email_verification_method TEXT;

CREATE INDEX idx_users_verified_email_domain
  ON users(substr(normalized_email, instr(normalized_email, '@') + 1), id)
  WHERE email_verified_at IS NOT NULL;

CREATE TABLE user_emails (
  id               TEXT NOT NULL PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  email            TEXT NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  verified_at      TEXT,
  verification_method TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX idx_user_emails_user ON user_emails(user_id);
CREATE INDEX idx_user_emails_verified_domain
  ON user_emails(substr(normalized_email, instr(normalized_email, '@') + 1), user_id)
  WHERE verified_at IS NOT NULL;

-- Existing individual Member aggregates receive the one sparse identity they
-- require. This runs only after user_emails exists because identity email
-- ownership is guarded at the D1 boundary. Ordinary users and event attendees
-- receive no identity row.
INSERT INTO identities (
  id, user_id, organization_id, email_id, job_title, biography, links_json,
  source, show_on_organization_profile, invited_at, started_at, ended_at,
  blocked_at, blocked_by_user_id, predecessor_identity_id, created_at, updated_at
)
SELECT 'identity-' || member.id, member.user_id, NULL, NULL, NULL,
       user.biography, user.links_json, 'migration', 0, member.created_at,
       CASE WHEN member.status = 'pending' THEN NULL ELSE member.created_at END,
       CASE WHEN member.status IN ('inactive', 'lapsed') THEN member.updated_at ELSE NULL END,
       NULL, NULL, NULL, member.created_at, member.updated_at
  FROM members member
  JOIN users user ON user.id = member.user_id
  JOIN member_category_assignments category ON category.member_id = member.id
 WHERE member.member_type = 'individual'
   AND category.category_code IN ('H5', 'H6', 'H7');

-- An email is one global reservation whether it is primary, secondary, or
-- pending verification. Application checks provide useful 409 responses;
-- these triggers close cross-table races at the database boundary.
CREATE TRIGGER trg_user_emails_reservation_insert
BEFORE INSERT ON user_emails
WHEN EXISTS (
  SELECT 1 FROM users
   WHERE normalized_email = NEW.normalized_email
      OR pending_email = NEW.normalized_email
)
BEGIN
  SELECT RAISE(ABORT, 'EMAIL_TAKEN');
END;

CREATE TRIGGER trg_user_emails_reservation_update
BEFORE UPDATE OF user_id, normalized_email ON user_emails
WHEN EXISTS (
  SELECT 1 FROM users
   WHERE normalized_email = NEW.normalized_email
      OR pending_email = NEW.normalized_email
)
BEGIN
  SELECT RAISE(ABORT, 'EMAIL_TAKEN');
END;

CREATE TRIGGER trg_users_primary_email_reservation_insert
BEFORE INSERT ON users
WHEN EXISTS (
  SELECT 1 FROM user_emails WHERE normalized_email = NEW.normalized_email
)
OR EXISTS (
  SELECT 1 FROM users
   WHERE pending_email = NEW.normalized_email
)
BEGIN
  SELECT RAISE(ABORT, 'EMAIL_TAKEN');
END;

CREATE TRIGGER trg_users_primary_email_reservation_update
BEFORE UPDATE OF normalized_email ON users
WHEN EXISTS (
  SELECT 1 FROM user_emails WHERE normalized_email = NEW.normalized_email
)
OR EXISTS (
  SELECT 1 FROM users
   WHERE id != NEW.id AND pending_email = NEW.normalized_email
)
BEGIN
  SELECT RAISE(ABORT, 'EMAIL_TAKEN');
END;

CREATE TRIGGER trg_users_pending_email_reservation_update
BEFORE UPDATE OF pending_email ON users
WHEN NEW.pending_email IS NOT NULL
 AND (
   EXISTS (
     SELECT 1 FROM users
      WHERE id != NEW.id AND normalized_email = NEW.pending_email
   )
   OR EXISTS (
     SELECT 1 FROM user_emails
      WHERE user_id != NEW.id AND normalized_email = NEW.pending_email
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'EMAIL_TAKEN');
END;

CREATE TRIGGER trg_users_pending_email_binding_consistency
BEFORE UPDATE OF pending_email, pending_email_change_registration_id ON users
WHEN (NEW.pending_email IS NULL) != (NEW.pending_email_change_registration_id IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'EMAIL_CHANGE_BINDING_REQUIRED');
END;

CREATE TRIGGER trg_users_pending_email_binding_owner
BEFORE UPDATE OF pending_email, pending_email_change_registration_id ON users
WHEN NEW.pending_email_change_registration_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
     FROM registrations r
    WHERE r.id = NEW.pending_email_change_registration_id
      AND r.user_id = NEW.id
      AND r.status = 'pending_email_confirmation'
 )
BEGIN
  SELECT RAISE(ABORT, 'EMAIL_CHANGE_REGISTRATION_INVALID');
END;

CREATE TRIGGER trg_users_pending_email_binding_no_overwrite
BEFORE UPDATE OF pending_email_change_registration_id ON users
WHEN OLD.pending_email_change_registration_id IS NOT NULL
 AND NEW.pending_email_change_registration_id IS NOT NULL
 AND OLD.pending_email_change_registration_id != NEW.pending_email_change_registration_id
BEGIN
  SELECT RAISE(ABORT, 'EMAIL_CHANGE_ALREADY_PENDING');
END;

-- Identity consolidation is intentionally not a generic database operation.
-- Existing legacy markers remain readable, but new partial merges must fail
-- closed until a dedicated reconciliation product can prove every live and
-- historical ownership rule.
CREATE TRIGGER trg_user_identity_merge_disabled
BEFORE UPDATE OF merged_into_user_id ON users
WHEN OLD.merged_into_user_id IS NOT NEW.merged_into_user_id
BEGIN
  SELECT RAISE(ABORT, 'USER_IDENTITY_MERGE_DISABLED');
END;

-- Section: Organization Profile Moderation & Managed
-- Mailing List Configuration
--
-- (the *workflow* half — the data-bearing half was pulled forward
-- by consolidated migration 0035; see that migration's own header.
-- No CHECK constraints, per this repo's standing convention
-- — allowed values are documented in `-- allowed:` comments and validated at
-- the application layer (Zod) instead.
--
-- Every active representative may act for the organization. Primary and
-- secondary contact roles manage the relationship; there is no separate
-- voting-delegate designation or fallback column.

ALTER TABLE organizations ADD COLUMN logo_staging_r2_key TEXT;
-- Pending logo awaiting moderation approval; promoted to logo_r2_key when
-- the review it's attached to is approved.

-- ── Secondary contact nomination ─────────────────────────────────────────
-- Workflow state (a pending nomination awaiting staff confirmation), not an
-- aggregate or representative fact — so it gets its own small table rather
-- than living on organizations or identities. One
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

-- Immutable event-time recipient snapshots for reviewer notifications. The
-- review may be withdrawn or the staff roster may change before the queued
-- email is drained; neither change should lose or retarget the submission
-- notice. The exact email is the logical recipient key, matching the
-- existing permission fan-out's distinct-email behavior.
CREATE TABLE organization_content_review_notification_intents (
  review_id           TEXT NOT NULL,
  recipient_email     TEXT NOT NULL,
  recipient_user_id   TEXT,
  organization_name   TEXT NOT NULL,
  submitter_name      TEXT NOT NULL,
  review_url          TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  queued_outbox_id    TEXT,
  queued_at           TEXT,
  PRIMARY KEY (review_id, recipient_email),
  FOREIGN KEY(review_id) REFERENCES organization_content_reviews(id) ON DELETE CASCADE,
  FOREIGN KEY(recipient_user_id) REFERENCES users(id)
);

CREATE INDEX idx_org_content_review_notification_intents_pending
  ON organization_content_review_notification_intents(created_at, review_id, recipient_email)
  WHERE queued_outbox_id IS NULL;

CREATE UNIQUE INDEX uq_org_content_review_notification_intents_outbox
  ON organization_content_review_notification_intents(queued_outbox_id)
  WHERE queued_outbox_id IS NOT NULL;

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
-- Every list is owned by a group; groups may have multiple lists with
-- independent purposes and subscription defaults.
CREATE TABLE mailing_lists (
  id                        TEXT NOT NULL PRIMARY KEY,
  email                     TEXT NOT NULL UNIQUE,
  label                     TEXT NOT NULL,
  purpose                   TEXT NOT NULL,
  -- allowed: all_members | consultation | group | custom
  group_id                  TEXT NOT NULL REFERENCES groups(id),
  is_primary_discussion     INTEGER NOT NULL DEFAULT 0 CHECK (is_primary_discussion IN (0, 1)),
  subscription_default      TEXT NOT NULL DEFAULT 'none',
  -- allowed: group_members | eligible_categories | none
  posting_policy            TEXT NOT NULL DEFAULT 'subscribers',
  moderation_policy         TEXT NOT NULL DEFAULT 'moderated',
  auto_sync_categories_json TEXT,
  -- JSON array of category letters, e.g. ["A","B","C","D","E","F","G"].
  -- Only consulted for purpose IN ('all_members','consultation') — see
  -- resolveAutoSyncListEmails in mailing-lists.ts. NULL means "every
  -- membership category" (used by the all_members list).
  active                    INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  archived_at               TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);

CREATE INDEX idx_mailing_lists_purpose_active ON mailing_lists(purpose, active);
CREATE INDEX idx_mailing_lists_group_active ON mailing_lists(group_id, active, label, id);
CREATE UNIQUE INDEX uq_mailing_lists_primary_discussion
  ON mailing_lists(group_id)
  WHERE is_primary_discussion = 1 AND active = 1;

CREATE TABLE mailing_list_group_grants (
  mailing_list_id TEXT NOT NULL,
  group_id        TEXT NOT NULL,
  capability      TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (mailing_list_id, group_id, capability),
  FOREIGN KEY(mailing_list_id) REFERENCES mailing_lists(id),
  FOREIGN KEY(group_id) REFERENCES groups(id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_mailing_list_group_grants_group
  ON mailing_list_group_grants(group_id, capability, mailing_list_id);

-- Absence means inherit the list default. An explicit row is a durable user
-- choice and survives group/category eligibility loss and later re-entry.
CREATE TABLE mailing_list_subscription_preferences (
  mailing_list_id   TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  preference        TEXT NOT NULL,
  updated_by_user_id TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (mailing_list_id, user_id),
  FOREIGN KEY(mailing_list_id) REFERENCES mailing_lists(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_mailing_list_preferences_user
  ON mailing_list_subscription_preferences(user_id, mailing_list_id);

-- List configuration and subscription history are archived, not erased.
CREATE TRIGGER trg_mailing_lists_prevent_delete
BEFORE DELETE ON mailing_lists
BEGIN
  SELECT RAISE(ABORT, 'mailing lists must be archived, not deleted');
END;

-- Stable IDs and explicit ownership make these seeds deterministic and usable
-- immediately. Tests delete business rows in FK-safe order and re-seed only
-- the records required by each case.
INSERT INTO mailing_lists
  (id, email, label, purpose, group_id, is_primary_discussion,
   subscription_default, posting_policy, moderation_policy,
   auto_sync_categories_json, active, created_at, updated_at)
VALUES
  ('30000000-0000-4000-8000-000000000001', 'pkic@lists.pkic.org', 'All Members', 'all_members', '20000000-0000-4000-8000-000000000001', 1, 'group_members', 'subscribers', 'moderated', NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('30000000-0000-4000-8000-000000000002', 'consultation@lists.pkic.org', 'Member Consultation', 'consultation', '20000000-0000-4000-8000-000000000001', 0, 'eligible_categories', 'subscribers', 'moderated', '["A","B","C","D","E","F","G"]', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('30000000-0000-4000-8000-000000000003', 'ec@lists.pkic.org', 'Executive Council', 'group', '20000000-0000-4000-8000-000000000002', 1, 'group_members', 'subscribers', 'moderated', NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('30000000-0000-4000-8000-000000000004', 'pqc@lists.pkic.org', 'Post-Quantum Cryptography WG', 'group', '20000000-0000-4000-8000-000000000003', 1, 'group_members', 'subscribers', 'moderated', NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('30000000-0000-4000-8000-000000000005', 'ca@lists.pkic.org', 'Certificate Authority WG', 'group', '20000000-0000-4000-8000-000000000007', 1, 'group_members', 'subscribers', 'moderated', NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('30000000-0000-4000-8000-000000000006', 'tcwg@lists.pkic.org', 'Trust Chain WG', 'group', '20000000-0000-4000-8000-000000000006', 1, 'group_members', 'subscribers', 'moderated', NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('30000000-0000-4000-8000-000000000007', 'cm@lists.pkic.org', 'Cryptographic Module WG', 'group', '20000000-0000-4000-8000-000000000004', 1, 'group_members', 'subscribers', 'moderated', NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('30000000-0000-4000-8000-000000000008', 'pkimm@lists.pkic.org', 'PKI Maturity Model WG', 'group', '20000000-0000-4000-8000-000000000005', 1, 'group_members', 'subscribers', 'moderated', NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('30000000-0000-4000-8000-000000000009', 'cbom@lists.pkic.org', 'Cryptographic Bill of Materials WG', 'group', '20000000-0000-4000-8000-000000000008', 1, 'group_members', 'subscribers', 'moderated', NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

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
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'org-content-approved', 1,
    'Your organization profile update was approved',
    'Hi {{contactName}},

The content changes you submitted for {{organizationName}}''s profile have been approved and are now live.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'org-content-rejected', 1,
    'Your organization profile update was not approved',
    'Hi {{contactName}},

The content changes you submitted for {{organizationName}}''s profile were not approved.

{{reviewerNote}}

You may revise and resubmit at any time.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  );

-- Section: Sponsorship Management
--
-- `sponsorships`/`sponsorship_events` are created earlier in this migration
-- forward for inquiry/checkout endpoints) with every column
-- schema calls for. What's still missing for the full sales-pipeline/
-- sponsor management and attendee-access feature:
--
-- 1. `organizations.sponsor_tier`/`sponsor_start_date` — written when a
--    consortium sponsorship goes active, cleared when it lapses.
-- 2. `event_sponsor_attendee_tiers` — per-event config of which sponsor
--    tiers get attendee-data access.
-- 3. Migrate the live `sponsors`/`sponsor_events` rows into
--    `sponsorships`/`sponsorship_events` (reconciled by `organization_id`
--    against anything already there). Keep the legacy source tables as a
--    rollback/reconciliation source until the backfill has been verified in
--    preview and production. A later, explicitly approved migration may drop
--    them after that verification; application code must not write to them.
-- 4. New email templates (`sponsorship-renewal-reminder-60`/`-30`,
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
    -- The legacy UNIQUE(event_id, sponsor_id, sponsorship_level) permits
    -- multiple tiers for one sponsor/event. Include the tier in the
    -- idempotency key so a later tier is not silently discarded before the
    -- legacy source tables are dropped below.
    AND sp.tier = se.sponsorship_level
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

-- Do not drop the legacy source tables in the same migration that backfills
-- them. D1 cannot restore those rows if a mapping defect is discovered after
-- deployment. Keeping the now-unused tables is cheap and makes row-level
-- reconciliation and recovery possible before a future cleanup migration.

-- ── New email templates ───────────────────────────────────────────

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'sponsorship-renewal-reminder-60', 1,
    'Sponsorship renewal due in 60 days',
    'The {{tierText}} sponsorship for {{organizationNameText}} renews on {{renewalDate}} (60 days from now).

[View sponsorship]({{managementUrl}})',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-renewal-reminder-30', 1,
    'Sponsorship renewal due in 30 days',
    'The {{tierText}} sponsorship for {{organizationNameText}} renews on {{renewalDate}} (30 days from now).

[View sponsorship]({{managementUrl}})',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-lapsed-staff', 1,
    'Sponsorship lapsed',
    'The {{tierText}} sponsorship for {{organizationNameText}} passed its renewal date ({{renewalDate}}) with no renewal recorded and has been automatically marked lapsed.

[View sponsorship]({{managementUrl}})',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-active-confirmation', 1,
    'Your PKI Consortium sponsorship is now active',
    'Hi {{contactNameText}},

Your {{tierText}} sponsorship for {{organizationNameText}} is now active{{#startDate}} as of {{startDate}}{{/startDate}}. Thank you for supporting the PKI Consortium.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsor-portal-access', 1,
    'Access your sponsor workspace',
    'Hi {{contactNameText}},

As a {{tierText}} sponsor of {{eventNameText}}, you can view and export basic attendee information for attendees who agreed to share their details with sponsors.

[Access your sponsor workspace]({{portalUrl}})

This link expires in {{expiresInMinutes}} minutes; you can request a new one at any time from the sponsor workspace sign-in page.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  );

-- Section: Group-owned events, recurring series, and meeting entry
--
-- Meetings are a controlled event profile. Recurrence is authoritative and
-- ICS is generated from it; uploaded calendar files are not a second source
-- of truth. Provider data stays behind a replaceable integration boundary.

CREATE TABLE event_profiles (
  key         TEXT NOT NULL PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

INSERT INTO event_profiles (key, label, description, active, sort_order, created_at, updated_at) VALUES
  ('meeting', 'Meeting', 'A recurring or one-off group meeting.', 1, 10, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('board_meeting', 'Board Meeting', 'A meeting for a governing group.', 1, 20, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('conference', 'Conference', 'A multi-session conference.', 1, 30, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('workshop', 'Workshop', 'An interactive workshop that may permit public registration.', 1, 40, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('tutorial', 'Tutorial', 'A focused educational event.', 1, 50, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

ALTER TABLE events ADD COLUMN owner_group_id TEXT REFERENCES groups(id);
ALTER TABLE events ADD COLUMN profile_key TEXT REFERENCES event_profiles(key);
ALTER TABLE events ADD COLUMN source_mode TEXT;
ALTER TABLE events ADD COLUMN links_json TEXT;
-- Audience policy is deliberately separate from registration and meeting-entry
-- policy. Keep validation in shared application schemas so extending the
-- catalog never requires rebuilding the D1 events table.
ALTER TABLE events ADD COLUMN visibility TEXT NOT NULL DEFAULT 'invitation_only';
-- allowed source_mode: hugo | portal | integration

CREATE INDEX idx_events_owner_profile
  ON events(owner_group_id, profile_key, starts_at, id);
CREATE INDEX idx_events_source_mode
  ON events(source_mode, updated_at, id);
CREATE INDEX idx_events_visibility_schedule
  ON events(visibility, starts_at, ends_at, id);
CREATE INDEX idx_events_owner_visibility_schedule
  ON events(owner_group_id, visibility, starts_at, id);

CREATE TRIGGER trg_portal_events_require_owner_insert
BEFORE INSERT ON events
WHEN NEW.source_mode = 'portal' AND NEW.owner_group_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'portal event requires an owning group');
END;

CREATE TRIGGER trg_portal_events_require_owner_update
BEFORE UPDATE OF source_mode, owner_group_id ON events
WHEN NEW.source_mode = 'portal' AND NEW.owner_group_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'portal event requires an owning group');
END;

CREATE TABLE event_group_grants (
  event_id   TEXT NOT NULL,
  group_id   TEXT NOT NULL,
  capability TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, group_id, capability),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(group_id) REFERENCES groups(id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_event_group_grants_group
  ON event_group_grants(group_id, capability, event_id);

ALTER TABLE registrations
  ADD COLUMN registration_group_id TEXT REFERENCES groups(id);

CREATE INDEX idx_registrations_group_event
  ON registrations(registration_group_id, event_id, status, created_at, id);

CREATE TRIGGER trg_group_registration_context_insert
BEFORE INSERT ON registrations
WHEN NEW.registration_group_id IS NOT NULL
  AND NEW.status <> 'cancelled'
  AND NOT EXISTS (
    SELECT 1
      FROM events event
      JOIN groups registration_group
        ON registration_group.id = NEW.registration_group_id
       AND registration_group.active = 1
      JOIN group_memberships membership
        ON membership.group_id = registration_group.id
       AND membership.user_id = NEW.user_id
       AND membership.left_at IS NULL
     WHERE event.id = NEW.event_id
       AND event.registration_mode <> 'no_registration'
       AND (
         event.owner_group_id = registration_group.id
         OR EXISTS (
           SELECT 1
             FROM event_group_grants grant_row
            WHERE grant_row.event_id = event.id
              AND grant_row.group_id = registration_group.id
              AND grant_row.capability = 'register'
         )
       )
  )
BEGIN
  SELECT RAISE(ABORT, 'EVENT_REGISTRATION_CONTEXT_CHANGED');
END;

CREATE TRIGGER trg_group_registration_context_update
BEFORE UPDATE OF event_id, user_id, status, registration_group_id ON registrations
WHEN NEW.registration_group_id IS NOT NULL
  AND NEW.status <> 'cancelled'
  AND NOT EXISTS (
    SELECT 1
      FROM events event
      JOIN groups registration_group
        ON registration_group.id = NEW.registration_group_id
       AND registration_group.active = 1
      JOIN group_memberships membership
        ON membership.group_id = registration_group.id
       AND membership.user_id = NEW.user_id
       AND membership.left_at IS NULL
     WHERE event.id = NEW.event_id
       AND event.registration_mode <> 'no_registration'
       AND (
         event.owner_group_id = registration_group.id
         OR EXISTS (
           SELECT 1
             FROM event_group_grants grant_row
            WHERE grant_row.event_id = event.id
              AND grant_row.group_id = registration_group.id
              AND grant_row.capability = 'register'
         )
       )
  )
BEGIN
  SELECT RAISE(ABORT, 'EVENT_REGISTRATION_CONTEXT_CHANGED');
END;

CREATE TABLE event_series (
  id                 TEXT NOT NULL PRIMARY KEY,
  event_id           TEXT NOT NULL UNIQUE,
  starts_at          TEXT NOT NULL,
  recurrence_rule    TEXT NOT NULL,
  timezone           TEXT NOT NULL,
  duration_minutes   INTEGER NOT NULL,
  location           TEXT,
  provider_type      TEXT,
  provider_data_json TEXT,
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  FOREIGN KEY(event_id) REFERENCES events(id)
);

CREATE INDEX idx_event_series_active
  ON event_series(active, event_id, id);

CREATE TABLE event_occurrences (
  id                         TEXT NOT NULL PRIMARY KEY,
  series_id                  TEXT NOT NULL,
  starts_at                  TEXT NOT NULL,
  ends_at                    TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'scheduled',
  -- allowed: scheduled | cancelled | completed
  location_override          TEXT,
  provider_join_url_ciphertext TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  UNIQUE (series_id, starts_at),
  UNIQUE (id, series_id),
  FOREIGN KEY(series_id) REFERENCES event_series(id),
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_event_occurrences_series_start
  ON event_occurrences(series_id, starts_at, id);
CREATE INDEX idx_event_occurrences_series_status_start
  ON event_occurrences(series_id, status, starts_at, id);
CREATE INDEX idx_event_occurrences_upcoming
  ON event_occurrences(status, starts_at, id);

CREATE TABLE event_occurrence_guests (
  id                 TEXT NOT NULL PRIMARY KEY,
  series_id          TEXT NOT NULL,
  occurrence_id      TEXT,
  user_id            TEXT,
  normalized_email   TEXT NOT NULL,
  name               TEXT NOT NULL,
  affiliation        TEXT,
  invitation_secret  TEXT NOT NULL,
  invitation_version INTEGER NOT NULL DEFAULT 1 CHECK (invitation_version >= 1),
  expires_at         TEXT NOT NULL,
  revoked_at         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  FOREIGN KEY(series_id) REFERENCES event_series(id),
  FOREIGN KEY(occurrence_id, series_id) REFERENCES event_occurrences(id, series_id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX idx_event_occurrence_guests_occurrence
  ON event_occurrence_guests(occurrence_id, revoked_at, normalized_email, id);
CREATE INDEX idx_event_occurrence_guests_series
  ON event_occurrence_guests(series_id, revoked_at, normalized_email, id);
CREATE UNIQUE INDEX uq_event_occurrence_guest_email
  ON event_occurrence_guests(occurrence_id, normalized_email)
  WHERE occurrence_id IS NOT NULL;
CREATE UNIQUE INDEX uq_event_series_guest_email
  ON event_occurrence_guests(series_id, normalized_email)
  WHERE occurrence_id IS NULL;

-- A guest invitation capability proves possession of the current invitation
-- secret, but a browser session is issued only after a separate, short-lived
-- verification challenge. The authorization hash binds the browser-held
-- secret to the independently delivered verification code without storing
-- either value. invitation_version invalidates outstanding challenges and
-- sessions whenever the invitation is intentionally rotated.
CREATE TABLE meeting_guest_browser_challenges (
  id                   TEXT NOT NULL PRIMARY KEY,
  guest_id             TEXT NOT NULL,
  occurrence_id        TEXT NOT NULL,
  invitation_version   INTEGER NOT NULL CHECK (invitation_version >= 1),
  authorization_hash   TEXT NOT NULL CHECK (
    length(authorization_hash) = 64 AND authorization_hash NOT GLOB '*[^0-9a-f]*'
  ),
  expires_at           TEXT NOT NULL,
  used_at              TEXT,
  created_at           TEXT NOT NULL,
  FOREIGN KEY(guest_id) REFERENCES event_occurrence_guests(id),
  FOREIGN KEY(occurrence_id) REFERENCES event_occurrences(id)
);

CREATE INDEX idx_meeting_guest_browser_challenges_guest
  ON meeting_guest_browser_challenges(guest_id, invitation_version, created_at, id);
CREATE INDEX idx_meeting_guest_browser_challenges_expiry
  ON meeting_guest_browser_challenges(expires_at, id);
CREATE INDEX idx_meeting_guest_browser_challenges_occurrence
  ON meeting_guest_browser_challenges(occurrence_id, guest_id, created_at, id);

CREATE TRIGGER trg_meeting_guest_browser_challenge_context
BEFORE INSERT ON meeting_guest_browser_challenges
WHEN unixepoch(NEW.expires_at) <= unixepoch()
  OR NOT EXISTS (
    SELECT 1
      FROM event_occurrence_guests guest
      JOIN event_series series ON series.id = guest.series_id
      JOIN events event ON event.id = series.event_id
      LEFT JOIN event_occurrences guest_occurrence
        ON guest_occurrence.id = guest.occurrence_id
       AND guest_occurrence.series_id = guest.series_id
     WHERE guest.id = NEW.guest_id
       AND guest.invitation_version = NEW.invitation_version
       AND guest.revoked_at IS NULL
       AND unixepoch(guest.expires_at) > unixepoch()
       AND unixepoch(NEW.expires_at) <= unixepoch(guest.expires_at)
       AND unixepoch(
             CASE WHEN guest.occurrence_id IS NULL THEN event.starts_at ELSE guest_occurrence.starts_at END
           ) IS NOT NULL
       AND unixepoch(
             CASE WHEN guest.occurrence_id IS NULL THEN event.ends_at ELSE guest_occurrence.ends_at END
           ) > unixepoch(
             CASE WHEN guest.occurrence_id IS NULL THEN event.starts_at ELSE guest_occurrence.starts_at END
           )
       AND unixepoch(
             CASE WHEN guest.occurrence_id IS NULL THEN event.ends_at ELSE guest_occurrence.ends_at END
           ) > unixepoch()
       AND unixepoch(NEW.expires_at) <= unixepoch(
             CASE WHEN guest.occurrence_id IS NULL THEN event.ends_at ELSE guest_occurrence.ends_at END
           )
       AND EXISTS (
         SELECT 1
           FROM current_event_occurrence_subject_eligibility eligible
          WHERE eligible.occurrence_id = NEW.occurrence_id
            AND eligible.guest_id = NEW.guest_id
       )
  )
BEGIN
  SELECT RAISE(ABORT, 'MEETING_GUEST_CHALLENGE_CONTEXT_CHANGED');
END;

-- Prevent retries, double-clicks, and parallel requests from generating an
-- email storm for the same invitation generation. The guard is enforced at
-- the database boundary so concurrent Workers cannot bypass it.
CREATE TRIGGER trg_meeting_guest_browser_challenge_rate_limit
BEFORE INSERT ON meeting_guest_browser_challenges
WHEN EXISTS (
  SELECT 1
    FROM meeting_guest_browser_challenges challenge
   WHERE challenge.guest_id = NEW.guest_id
     AND challenge.invitation_version = NEW.invitation_version
     AND unixepoch(challenge.created_at) > unixepoch() - 60
)
BEGIN
  SELECT RAISE(ABORT, 'MEETING_GUEST_CHALLENGE_RATE_LIMITED');
END;

CREATE TABLE meeting_guest_sessions (
  id                 TEXT NOT NULL PRIMARY KEY,
  guest_id           TEXT NOT NULL,
  challenge_id       TEXT NOT NULL UNIQUE,
  authorization_hash TEXT NOT NULL CHECK (
    length(authorization_hash) = 64 AND authorization_hash NOT GLOB '*[^0-9a-f]*'
  ),
  expires_at         TEXT NOT NULL,
  revoked_at         TEXT,
  created_at         TEXT NOT NULL,
  FOREIGN KEY(guest_id) REFERENCES event_occurrence_guests(id),
  FOREIGN KEY(challenge_id) REFERENCES meeting_guest_browser_challenges(id)
);

CREATE INDEX idx_meeting_guest_sessions_guest
  ON meeting_guest_sessions(guest_id, revoked_at, expires_at, id);

-- The session INSERT is the one atomic challenge-consumption boundary. A
-- concurrent completion cannot observe and consume the same challenge after
-- the winning INSERT marks it used, and a session can never outlive its guest.
CREATE TRIGGER trg_meeting_guest_session_validate
BEFORE INSERT ON meeting_guest_sessions
WHEN unixepoch(NEW.expires_at) <= unixepoch()
  OR NOT EXISTS (
    SELECT 1
      FROM meeting_guest_browser_challenges challenge
      JOIN event_occurrence_guests guest ON guest.id = challenge.guest_id
      JOIN event_series series ON series.id = guest.series_id
      JOIN events event ON event.id = series.event_id
      LEFT JOIN event_occurrences guest_occurrence
        ON guest_occurrence.id = guest.occurrence_id
       AND guest_occurrence.series_id = guest.series_id
     WHERE challenge.id = NEW.challenge_id
       AND challenge.guest_id = NEW.guest_id
       AND challenge.authorization_hash = NEW.authorization_hash
       AND challenge.used_at IS NULL
       AND unixepoch(challenge.expires_at) > unixepoch()
       AND challenge.invitation_version = guest.invitation_version
       AND guest.revoked_at IS NULL
       AND unixepoch(guest.expires_at) > unixepoch()
       AND unixepoch(NEW.expires_at) <= unixepoch(guest.expires_at)
       AND unixepoch(
             CASE WHEN guest.occurrence_id IS NULL THEN event.starts_at ELSE guest_occurrence.starts_at END
           ) IS NOT NULL
       AND unixepoch(
             CASE WHEN guest.occurrence_id IS NULL THEN event.ends_at ELSE guest_occurrence.ends_at END
           ) > unixepoch(
             CASE WHEN guest.occurrence_id IS NULL THEN event.starts_at ELSE guest_occurrence.starts_at END
           )
       AND unixepoch(
             CASE WHEN guest.occurrence_id IS NULL THEN event.ends_at ELSE guest_occurrence.ends_at END
           ) > unixepoch()
       AND unixepoch(NEW.expires_at) <= unixepoch(
             CASE WHEN guest.occurrence_id IS NULL THEN event.ends_at ELSE guest_occurrence.ends_at END
           )
  )
BEGIN
  SELECT RAISE(ABORT, 'MEETING_GUEST_SESSION_CONTEXT_CHANGED');
END;

CREATE TRIGGER trg_meeting_guest_session_consume_challenge
AFTER INSERT ON meeting_guest_sessions
BEGIN
  UPDATE meeting_guest_browser_challenges
     SET used_at = NEW.created_at
   WHERE id = NEW.challenge_id AND used_at IS NULL;
END;

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key,
   checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'meeting-guest-invitation', 1,
    'Invitation: {{eventName}}',
    'Hi {{guestName}},

You have been invited to {{eventName}}, starting {{startsAt}}.

[Open your meeting invitation]({{invitationUrl}})

For your protection, opening the invitation starts a separate verification step. The meeting destination is shown only after verification and acceptance of the current meeting terms.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'meeting-guest-verification-code', 1,
    'Your meeting verification code',
    'Hi {{guestName}},

Enter this code in the same browser where you opened the meeting invitation:

{{verificationCode}}

This code expires at {{expiresAt}}. If you did not request it, you may ignore this email.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  );

-- One canonical SQL read model defines whether a meeting subject may enter an
-- occurrence now. Token issuance and token consumption both use it so policy,
-- membership, registration, guest scope, revocation, and expiry cannot drift
-- between separate database guards.
CREATE VIEW current_event_occurrence_subject_eligibility AS
SELECT occurrence.id AS occurrence_id, event.id AS event_id,
       active_user.id AS user_id, NULL AS guest_id
  FROM event_occurrences occurrence
  JOIN event_series series ON series.id = occurrence.series_id AND series.active = 1
  JOIN events event ON event.id = series.event_id
  JOIN groups owner_group ON owner_group.id = event.owner_group_id AND owner_group.active = 1
  JOIN users active_user ON active_user.active = 1
 WHERE occurrence.status = 'scheduled'
   AND (
     COALESCE(json_extract(event.settings_json, '$.memberEligibility'), 'owner_group') = 'public'
     OR EXISTS (
       SELECT 1 FROM group_memberships membership
        JOIN groups membership_group ON membership_group.id = membership.group_id AND membership_group.active = 1
        WHERE membership.user_id = active_user.id
          AND membership.left_at IS NULL
          AND (
            membership.group_id = event.owner_group_id
            OR (
              json_extract(event.settings_json, '$.memberEligibility') = 'shared_groups'
              AND EXISTS (
                SELECT 1 FROM event_group_grants grant_row
                 WHERE grant_row.event_id = event.id
                   AND grant_row.group_id = membership.group_id
                   AND grant_row.capability = 'attend'
              )
            )
          )
     )
   )
   AND (
     event.registration_mode NOT IN ('required', 'public')
     OR EXISTS (
       SELECT 1 FROM registrations registration
        WHERE registration.event_id = event.id
          AND registration.user_id = active_user.id
          AND registration.status = 'registered'
     )
   )
UNION ALL
SELECT occurrence.id AS occurrence_id, event.id AS event_id,
       NULL AS user_id, guest.id AS guest_id
  FROM event_occurrences occurrence
  JOIN event_series series ON series.id = occurrence.series_id AND series.active = 1
  JOIN events event ON event.id = series.event_id
  JOIN groups owner_group ON owner_group.id = event.owner_group_id AND owner_group.active = 1
  JOIN event_occurrence_guests guest
    ON guest.series_id = occurrence.series_id
   AND (guest.occurrence_id IS NULL OR guest.occurrence_id = occurrence.id)
 WHERE occurrence.status = 'scheduled'
   AND guest.revoked_at IS NULL
   AND unixepoch(guest.expires_at) > unixepoch()
   AND unixepoch(
         CASE WHEN guest.occurrence_id IS NULL THEN event.starts_at ELSE occurrence.starts_at END
       ) IS NOT NULL
   AND unixepoch(
         CASE WHEN guest.occurrence_id IS NULL THEN event.ends_at ELSE occurrence.ends_at END
       ) > unixepoch(
         CASE WHEN guest.occurrence_id IS NULL THEN event.starts_at ELSE occurrence.starts_at END
       )
   AND unixepoch(
         CASE WHEN guest.occurrence_id IS NULL THEN event.ends_at ELSE occurrence.ends_at END
       ) > unixepoch()
   AND COALESCE(json_extract(event.settings_json, '$.guestPolicy'), 'none')
       IN ('occurrence_invitation', 'public_registration', 'invitation_only');

-- Meeting access does not require an event registration, while the deployed
-- consent_acceptances table intentionally requires a registration or proposal.
-- One companion table therefore records current-version meeting terms for
-- either an authenticated user or invited guest without duplicating the term.
CREATE TABLE event_access_term_acceptances (
  id              TEXT NOT NULL PRIMARY KEY,
  event_id        TEXT NOT NULL,
  user_id         TEXT,
  guest_id        TEXT,
  event_term_id   TEXT NOT NULL,
  accepted_at     TEXT NOT NULL,
  ip_hash         TEXT,
  user_agent_hash TEXT,
  CHECK ((user_id IS NOT NULL AND guest_id IS NULL) OR (user_id IS NULL AND guest_id IS NOT NULL)),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(guest_id) REFERENCES event_occurrence_guests(id),
  FOREIGN KEY(event_term_id) REFERENCES event_terms(id)
);

CREATE UNIQUE INDEX uq_event_access_term_user
  ON event_access_term_acceptances(event_id, user_id, event_term_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_event_access_term_guest
  ON event_access_term_acceptances(event_id, guest_id, event_term_id)
  WHERE guest_id IS NOT NULL;
CREATE INDEX idx_event_access_term_subject
  ON event_access_term_acceptances(event_id, user_id, guest_id, event_term_id);

CREATE TRIGGER trg_event_access_term_context_insert
BEFORE INSERT ON event_access_term_acceptances
WHEN NOT EXISTS (
  SELECT 1 FROM event_terms term
   WHERE term.id = NEW.event_term_id AND term.event_id = NEW.event_id
)
OR (
  NEW.guest_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM event_occurrence_guests guest
      JOIN event_series series ON series.id = guest.series_id
     WHERE guest.id = NEW.guest_id AND series.event_id = NEW.event_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'event access term context invalid');
END;

-- The join landing is an advisory read. Membership, registration, guest,
-- session, occurrence, and current-term state can all change before the
-- intentional POST. Revalidate the exact authenticated session and every
-- policy condition inside the same D1 batch as the confirmation.
CREATE TABLE event_occurrence_join_guards (
  id            TEXT NOT NULL PRIMARY KEY,
  session_kind  TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  occurrence_id TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  user_id       TEXT,
  guest_id      TEXT,
  CHECK (
    (session_kind = 'member' AND user_id IS NOT NULL AND guest_id IS NULL)
    OR (session_kind = 'guest' AND user_id IS NULL AND guest_id IS NOT NULL)
  ),
  FOREIGN KEY(occurrence_id) REFERENCES event_occurrences(id),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(guest_id) REFERENCES event_occurrence_guests(id)
);

CREATE TRIGGER trg_event_occurrence_join_guard_validate
BEFORE INSERT ON event_occurrence_join_guards
WHEN NOT EXISTS (
  SELECT 1
    FROM event_occurrences occurrence
    JOIN event_series series ON series.id = occurrence.series_id
    JOIN events event ON event.id = series.event_id
   WHERE occurrence.id = NEW.occurrence_id
     AND event.id = NEW.event_id
     AND occurrence.status = 'scheduled'
     AND (
       (
         NEW.session_kind = 'member'
         AND EXISTS (
           SELECT 1 FROM sessions member_session
            WHERE member_session.id = NEW.session_id
              AND member_session.user_id = NEW.user_id
              AND member_session.session_type = 'auth'
              AND member_session.revoked_at IS NULL
              AND unixepoch(member_session.expires_at) > unixepoch()
         )
       )
       OR (
         NEW.session_kind = 'guest'
         AND EXISTS (
           SELECT 1
             FROM meeting_guest_sessions guest_session
             JOIN meeting_guest_browser_challenges challenge
               ON challenge.id = guest_session.challenge_id
             JOIN event_occurrence_guests guest
               ON guest.id = guest_session.guest_id AND guest.id = challenge.guest_id
            WHERE guest_session.id = NEW.session_id
              AND guest_session.guest_id = NEW.guest_id
              AND challenge.occurrence_id = NEW.occurrence_id
              AND guest_session.revoked_at IS NULL
              AND unixepoch(guest_session.expires_at) > unixepoch()
              AND challenge.used_at IS NOT NULL
              AND guest_session.authorization_hash = challenge.authorization_hash
              AND challenge.invitation_version = guest.invitation_version
              AND guest.revoked_at IS NULL
              AND unixepoch(guest.expires_at) > unixepoch()
         )
       )
     )
     AND EXISTS (
       SELECT 1 FROM current_event_occurrence_subject_eligibility eligible
        WHERE eligible.occurrence_id = NEW.occurrence_id
          AND eligible.event_id = NEW.event_id
          AND eligible.user_id IS NEW.user_id
          AND eligible.guest_id IS NEW.guest_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM event_terms required_term
        WHERE required_term.event_id = event.id
          AND required_term.audience_type = 'attendee'
          AND required_term.active = 1
          AND required_term.required = 1
          AND NOT EXISTS (
            SELECT 1 FROM event_access_term_acceptances acceptance
             WHERE acceptance.event_id = event.id
               AND acceptance.event_term_id = required_term.id
               AND (
                 (NEW.user_id IS NOT NULL AND acceptance.user_id = NEW.user_id)
                 OR (NEW.guest_id IS NOT NULL AND acceptance.guest_id = NEW.guest_id)
               )
          )
     )
)
BEGIN
  SELECT RAISE(ABORT, 'MEETING_JOIN_CONTEXT_CHANGED');
END;

CREATE TRIGGER trg_event_occurrence_join_guard_release
AFTER INSERT ON event_occurrence_join_guards
BEGIN
  DELETE FROM event_occurrence_join_guards WHERE id = NEW.id;
END;

CREATE TABLE event_occurrence_join_confirmations (
  id                          TEXT NOT NULL PRIMARY KEY,
  occurrence_id               TEXT NOT NULL,
  user_id                     TEXT,
  guest_id                    TEXT,
  name_snapshot               TEXT NOT NULL,
  affiliation_snapshot        TEXT,
  join_count                  INTEGER NOT NULL DEFAULT 1,
  confirmed_at                TEXT NOT NULL,
  attendance_verified_at      TEXT,
  attendance_verification_source TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  CHECK ((user_id IS NOT NULL AND guest_id IS NULL) OR (user_id IS NULL AND guest_id IS NOT NULL)),
  FOREIGN KEY(occurrence_id) REFERENCES event_occurrences(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(guest_id) REFERENCES event_occurrence_guests(id)
);

CREATE UNIQUE INDEX uq_event_occurrence_join_user
  ON event_occurrence_join_confirmations(occurrence_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_event_occurrence_join_guest
  ON event_occurrence_join_confirmations(occurrence_id, guest_id)
  WHERE guest_id IS NOT NULL;
CREATE INDEX idx_event_occurrence_attendance
  ON event_occurrence_join_confirmations(occurrence_id, attendance_verified_at, confirmed_at, id);

-- Event management may be delegated to another group's effective leadership.
-- This short-lived row rechecks both the exact event capability and the
-- actor's current group-management authority in the same D1 batch as the
-- protected mutation, closing grant and leadership revocation races.
CREATE TABLE event_resource_management_guards (
  id                TEXT NOT NULL PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id),
  group_id          TEXT NOT NULL REFERENCES groups(id),
  required_capability TEXT NOT NULL,
  actor_user_id     TEXT REFERENCES users(id),
  trusted_service   INTEGER NOT NULL DEFAULT 0 CHECK (trusted_service IN (0, 1)),
  created_at        TEXT NOT NULL,
  CHECK (
    (actor_user_id IS NOT NULL AND trusted_service = 0)
    OR (actor_user_id IS NULL AND trusted_service = 1)
  )
);

CREATE TRIGGER trg_event_resource_management_guard_validate
BEFORE INSERT ON event_resource_management_guards
WHEN NEW.required_capability NOT IN ('manage', 'manage_attendance')
OR NOT EXISTS (
  SELECT 1
    FROM events event
    JOIN groups target_group ON target_group.id = NEW.group_id AND target_group.active = 1
   WHERE event.id = NEW.event_id
     AND (
       event.owner_group_id = target_group.id
       OR EXISTS (
         SELECT 1 FROM event_group_grants grant_row
         WHERE grant_row.event_id = event.id
            AND grant_row.group_id = target_group.id
            AND (
              (NEW.required_capability = 'manage' AND grant_row.capability = 'manage')
              OR (
                NEW.required_capability = 'manage_attendance'
                AND grant_row.capability IN ('manage_attendance', 'manage')
              )
            )
       )
     )
     AND (
       NEW.trusted_service = 1
       OR EXISTS (
         SELECT 1 FROM users active_actor
          WHERE active_actor.id = NEW.actor_user_id
            AND active_actor.active = 1
       )
     )
     AND (
       NEW.trusted_service = 1
       OR EXISTS (
         SELECT 1 FROM users actor_user
          WHERE actor_user.id = NEW.actor_user_id
            AND actor_user.active = 1
            AND actor_user.role = 'admin'
       )
       OR EXISTS (
         SELECT 1
           FROM user_roles actor_role
           JOIN role_permissions role_permission ON role_permission.role_id = actor_role.role_id
          WHERE actor_role.user_id = NEW.actor_user_id
            AND role_permission.permission = 'groups:write'
            AND actor_role.revoked_at IS NULL
            AND (actor_role.expires_at IS NULL OR actor_role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            AND (
              (actor_role.context_type IS NULL AND actor_role.context_id IS NULL)
              OR (actor_role.context_type = 'group' AND actor_role.context_id = target_group.id)
            )
       )
       OR EXISTS (
         SELECT 1 FROM permission_grants direct_grant
          WHERE direct_grant.user_id = NEW.actor_user_id
            AND direct_grant.permission = 'groups:write'
            AND direct_grant.revoked_at IS NULL
            AND (direct_grant.expires_at IS NULL OR direct_grant.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            AND (
              (direct_grant.context_type IS NULL AND direct_grant.context_id IS NULL)
              OR (direct_grant.context_type = 'group' AND direct_grant.context_id = target_group.id)
            )
       )
       OR EXISTS (
         WITH RECURSIVE effective_lineage(id, depth, continue_up) AS (
           SELECT target_group.id, 0,
                  CASE WHEN target_group.governance_inheritance_mode = 'inherited' THEN 1 ELSE 0 END
           UNION ALL
           SELECT parent.id, lineage.depth + 1,
                  CASE WHEN parent.governance_inheritance_mode = 'inherited' THEN 1 ELSE 0 END
             FROM effective_lineage lineage
             JOIN groups child ON child.id = lineage.id
             JOIN groups parent ON parent.id = child.parent_group_id
            WHERE lineage.continue_up = 1
         )
         SELECT 1
           FROM effective_lineage lineage
           JOIN user_roles inherited_role
             ON inherited_role.context_type = 'group'
            AND inherited_role.context_id = lineage.id
            AND inherited_role.user_id = NEW.actor_user_id
            AND inherited_role.role_id IN ('role-group_lead', 'role-group_deputy_lead')
            AND inherited_role.revoked_at IS NULL
            AND (inherited_role.expires_at IS NULL OR inherited_role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           JOIN role_permissions inherited_permission
             ON inherited_permission.role_id = inherited_role.role_id
            AND inherited_permission.permission = 'groups:write'
          LIMIT 1
       )
     )
)
BEGIN
  SELECT RAISE(ABORT, 'EVENT_RESOURCE_MANAGEMENT_CONTEXT_CHANGED');
END;

CREATE TRIGGER trg_event_resource_management_guard_release
AFTER INSERT ON event_resource_management_guards
BEGIN
  DELETE FROM event_resource_management_guards WHERE id = NEW.id;
END;

-- Seed portal-managed meeting aggregates, not uploaded files. Recurrence is
-- intentionally empty until staff confirms each real schedule.
INSERT OR IGNORE INTO events
  (id, slug, name, timezone, starts_at, ends_at, source_path, base_path,
   capacity_in_person, registration_mode, invite_limit_attendee, settings_json,
   created_at, updated_at, owner_group_id, profile_key, source_mode)
SELECT
  'event-meeting-' || slug,
  'meeting-' || slug,
  name || ' Meeting',
  'Europe/Amsterdam',
  NULL,
  NULL,
  NULL,
  '/portal/groups/' || slug || '/meetings',
  NULL,
  'no_registration',
  0,
  '{"memberEligibility":"owner_group","guestPolicy":"occurrence_invitation"}',
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  id,
  CASE WHEN type_key = 'board' THEN 'board_meeting' ELSE 'meeting' END,
  'portal'
FROM groups
WHERE slug IN ('all-members', 'pqc', 'cbom', 'cm', 'tcwg', 'ca', 'pkimm');

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
  owner_group_id        TEXT NOT NULL REFERENCES groups(id),
  electorate_mode       TEXT NOT NULL DEFAULT 'per_member',
  -- allowed: per_member | per_person
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
  -- JSON array of membership category letters entitled to a ballot; NULL
  -- means eligibility follows the owning group's membership policy.
  threshold_type        TEXT NOT NULL,
  -- allowed: simple_majority | supermajority | successive_elimination
  question_form_id      TEXT REFERENCES forms(id),
  -- A consultation asks a form, not a single question: "would you support
  -- this, and how would you want it done" is two questions and one opinion.
  -- Linking the form gives it everything forms already provide — several
  -- questions, stable field and option identities, labels that may be
  -- reworded after responses exist, and options archived without
  -- invalidating an answer already given — while the vote keeps what a vote
  -- owns: who is eligible, the window, and one response per represented
  -- Member. Deliberately not constrained to `vote_type = 'consultation'` in
  -- SQL: which vote types may carry a form is product policy that can evolve,
  -- and belongs in the shared schema rather than a table constraint a future
  -- change has to rebuild.
  quorum_percent        INTEGER CHECK (quorum_percent IS NULL OR (quorum_percent BETWEEN 1 AND 100)),
  -- NULL is the bylaw default: Article 10 decides a matter "by majority vote
  -- of the members ... who cast a vote", so the denominator is ballots cast
  -- and no minimum turnout applies. A percentage opts one vote into a
  -- turnout floor, which is stricter than the bylaws require and therefore a
  -- deliberate per-vote choice rather than an installation-wide default.
  tie_break_mode        TEXT NOT NULL DEFAULT 'none',
  -- allowed: none | chair
  -- 'none' is Article 10: "In the case of a tie vote, the matter will not be
  -- approved." 'chair' is the Board and Executive Council rule that the Chair
  -- has the deciding vote — implemented as the chair's own ballot counting
  -- twice, so the deciding vote is one they actually cast rather than a
  -- separate decision taken after seeing the result.
  excluded_member_ids   TEXT,
  -- JSON array of members.id barred from this vote regardless of category.
  -- Article 3 requires it: a proposal to withdraw a Member's status is
  -- decided "not including the Member who is the subject of the proposal ...
  -- who is not entitled to vote on the proposal".
  opens_at              TEXT NOT NULL,
  closes_at             TEXT NOT NULL,
  current_round         INTEGER NOT NULL DEFAULT 1,
  transition_revision   INTEGER NOT NULL DEFAULT 0,
  transition_processing_token TEXT,
  transition_lease_expires_at TEXT,
  -- Lifecycle facts: WHICH side effects have already run. Whether the ballot
  -- box is open is NOT stored — it is derived from opens_at/closes_at, so it
  -- cannot drift from the schedule while a transition job is late. Conflating
  -- the two previously let a vote read as open past its own deadline.
  opened_at             TEXT,
  closed_at             TEXT,
  cancelled_at          TEXT,
  cancellation_reason   TEXT,
  result_json           TEXT,
  visibility             TEXT NOT NULL DEFAULT 'private',
  -- allowed: private | public
  public_detail_level   TEXT NOT NULL DEFAULT 'aggregate',
  -- allowed: outcome_only | aggregate | full_breakdown
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX idx_votes_group_schedule
  ON votes(owner_group_id, opens_at, id);
-- The dispatcher's two selection paths. Partial on the lifecycle fact rather
-- than a status string, so each index covers exactly the rows still needing
-- that side effect.
CREATE INDEX idx_votes_pending_open
  ON votes(opens_at, id)
  WHERE opened_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX idx_votes_pending_close
  ON votes(closes_at, id)
  WHERE closed_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX idx_votes_visibility ON votes(visibility, closes_at);

CREATE TABLE vote_group_grants (
  vote_id    TEXT NOT NULL,
  group_id   TEXT NOT NULL,
  capability TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (vote_id, group_id, capability),
  FOREIGN KEY(vote_id) REFERENCES votes(id),
  FOREIGN KEY(group_id) REFERENCES groups(id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_vote_group_grants_group
  ON vote_group_grants(group_id, capability, vote_id);

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

-- ── Consultation responses ────────────────────────────────────────
-- A consultation's answers are ordinary form submissions, so form editing,
-- answer history, and response statistics all apply unchanged. This table
-- owns only what a vote owns: which represented Member a submission speaks
-- for, and that there is exactly one of them per round. Keeping it separate
-- means `form_submissions` never learns about electorates.
CREATE TABLE vote_consultation_responses (
  id            TEXT NOT NULL PRIMARY KEY,
  vote_id       TEXT NOT NULL REFERENCES votes(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  identity_id   TEXT NOT NULL REFERENCES identities(id),
  member_id     TEXT REFERENCES members(id),
  -- member electorate: the represented Member this response speaks for;
  -- person electorate: NULL, exactly as vote_ballots does it.
  submission_id TEXT NOT NULL REFERENCES form_submissions(id),
  round         INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_vote_consultation_responses_member
  ON vote_consultation_responses(vote_id, member_id, round)
  WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX uq_vote_consultation_responses_person
  ON vote_consultation_responses(vote_id, user_id, round)
  WHERE member_id IS NULL;
CREATE INDEX idx_vote_consultation_responses_submission
  ON vote_consultation_responses(submission_id);

CREATE TABLE vote_ballots (
  id           TEXT NOT NULL PRIMARY KEY,
  vote_id      TEXT NOT NULL REFERENCES votes(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  identity_id  TEXT NOT NULL REFERENCES identities(id),
  member_id    TEXT REFERENCES members(id),
  -- member electorate: the represented Member whose separate ballot this is;
  -- person electorate: NULL. Every active representative may replace the
  -- Member ballot, and the last authorized submission is effective.
  choice       TEXT NOT NULL,
  -- motion/consultation: in_favor | opposed | abstain
  -- election: a vote_candidates.id
  round           INTEGER NOT NULL DEFAULT 1,
  submitted_at    TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  ip_hash         TEXT
);

-- Cover scheduled tally aggregation without loading every ballot row or
-- returning to the table for each choice.
CREATE INDEX idx_vote_ballots_vote_round ON vote_ballots(vote_id, round, choice);
-- Cover the staff ballot audit's bounded default order without sorting every
-- ballot for the vote before applying LIMIT/OFFSET.
CREATE INDEX idx_vote_ballots_vote_audit_page
  ON vote_ballots(vote_id, round, submitted_at, id);
-- One effective ballot per represented Member and round.
CREATE UNIQUE INDEX idx_vote_ballots_member_round ON vote_ballots(vote_id, member_id, round)
  WHERE member_id IS NOT NULL;
-- Person electorates keep one ballot per person and round.
CREATE UNIQUE INDEX idx_vote_ballots_user_round ON vote_ballots(vote_id, user_id, round)
  WHERE member_id IS NULL;

-- Cover set-based Member electorate resolution without scanning inactive or
-- individual membership aggregates on every vote opening/round transition.
CREATE INDEX idx_members_active_organization_notifications
  ON members(organization_id, id)
  WHERE status = 'active' AND organization_id IS NOT NULL;

-- Immutable event-time recipient snapshots. These are created atomically with
-- the vote opening/round transition, so a later close, round advance, role
-- change, or queue-worker failure cannot erase the notification obligation.
CREATE TABLE vote_representative_notification_intents (
  vote_id          TEXT NOT NULL REFERENCES votes(id),
  round            INTEGER NOT NULL,
  member_id        TEXT NOT NULL REFERENCES members(id),
  identity_id      TEXT NOT NULL REFERENCES identities(id),
  representative_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_email  TEXT NOT NULL,
  representative_name TEXT NOT NULL,
  organization_name TEXT NOT NULL,
  vote_title       TEXT NOT NULL,
  closes_at        TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  queued_outbox_id TEXT,
  queued_at        TEXT,
  PRIMARY KEY (vote_id, round, member_id, identity_id)
);

CREATE INDEX idx_vote_representative_notification_intents_pending
  ON vote_representative_notification_intents(created_at, vote_id, round, member_id, identity_id)
  WHERE queued_outbox_id IS NULL;

CREATE UNIQUE INDEX uq_vote_representative_notification_intents_outbox
  ON vote_representative_notification_intents(queued_outbox_id)
  WHERE queued_outbox_id IS NOT NULL;

CREATE TABLE vote_proposals (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  vote_type           TEXT NOT NULL,
  -- allowed: election | motion | consultation
  owner_group_id      TEXT NOT NULL REFERENCES groups(id),
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

-- Resolves the proposal that produced a vote, and keeps a vote delete from
-- scanning every proposal. Partial: most proposals never reach a vote.
CREATE INDEX idx_vote_proposals_vote
  ON vote_proposals(vote_id)
  WHERE vote_id IS NOT NULL;

CREATE INDEX idx_vote_proposals_group_status
  ON vote_proposals(owner_group_id, status, created_at, id);

-- Supports both the bounded portal list (status + owning group, ordered by
-- created_at) and the bounded admin list (status alone, ordered by
-- created_at) via a shared leading (status) column.
CREATE INDEX idx_vote_proposals_status_scope_created_at
  ON vote_proposals(status, owner_group_id, created_at, id);

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
    lower(hex(randomblob(16))), 'member-vote-representative-notify', 1,
    'Vote open: {{voteTitle}}',
    'Hi {{representativeName}},

A vote is now open for {{organizationName}}: "{{voteTitle}}".

Each represented organization has a separate ballot. Any active representative may submit or update this organization''s ballot; the latest authorized submission before close is effective.

Voting closes {{closesAt}}. Cast this organization''s ballot in the portal at {{voteUrl}}.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'vote-proposal-rejected', 1,
    'Your vote proposal was not approved: {{proposalTitle}}',
    'Hi {{proposerName}},

Your proposed vote "{{proposalTitle}}" was not approved.

Reason: {{rejectionReason}}

You may submit a revised proposal at any time.',
    'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
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

-- Section: group leadership membership digest
-- Weekly group membership-change digest for group leads and deputy leads
-- (2026-07-31 manual-testing feedback). "Send an email to the chairs when
-- someone joins or leaves the group... not a spam email every time
-- there is a change" — batched weekly, one email per (group, leader)
-- pair, only for groups with at least one join/leave in the past 7 days.
-- See the shared group membership digest service.
--
-- No schema change needed for the opt-out preference itself — it's a new
-- key (`groupLeadershipMembershipDigest`, default true) on the existing
-- `users.notification_preferences_json` blob added by consolidated migration 0035, per
-- that migration's own "no CHECK constraint, validated at the application
-- layer" convention. This migration only seeds the email template.

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES (
  lower(hex(randomblob(16))), 'group-leadership-membership-digest', 1,
  '{{groupName}} — weekly membership update',
  'Hi {{recipientName}},

Here is a summary of {{groupName}} membership changes over the past week:

{{#joined}}
+ {{name}} ({{organizationName}}) joined
{{/joined}}
{{#left}}
- {{name}} ({{organizationName}}) left
{{/left}}

You are receiving this because you are a leader of this group. You can turn this off any time in your portal Account Settings under Notification preferences.',
  'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
);

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
-- Resolve any legacy duplicates deterministically before enforcing the
-- invariant. Retain the newest still-valid capability because it is the one
-- most recently delivered. Prefer a canonical creation timestamp over an
-- unparseable legacy value; equal or wholly ambiguous timestamps use the
-- greatest id as a stable deterministic tiebreaker.
UPDATE invites
SET status = 'revoked'
WHERE status = 'sent'
  AND id <> (
    SELECT keeper.id
    FROM invites keeper
    WHERE keeper.event_id = invites.event_id
      AND keeper.invitee_email = invites.invitee_email
      AND keeper.invite_type = invites.invite_type
      AND keeper.status = 'sent'
    ORDER BY
      CASE
        WHEN keeper.created_at = strftime('%Y-%m-%dT%H:%M:%fZ', keeper.created_at) THEN 1
        ELSE 0
      END DESC,
      CASE
        WHEN keeper.created_at = strftime('%Y-%m-%dT%H:%M:%fZ', keeper.created_at) THEN keeper.created_at
        ELSE ''
      END DESC,
      keeper.id DESC
    LIMIT 1
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

-- Consent evidence belongs to exactly one event aggregate. Enforce the
-- relationship at the database boundary because the table is also written by
-- imports, retention tooling, and tests that do not pass through consent.ts.
-- Proposal consents may be accepted by the proposer or any proposal speaker;
-- registration consents must match the registration's event and user.
CREATE TRIGGER validate_consent_acceptance_insert
BEFORE INSERT ON consent_acceptances
FOR EACH ROW
WHEN NOT (
  (
    NEW.registration_id IS NOT NULL
    AND NEW.proposal_id IS NULL
    AND EXISTS (
      SELECT 1 FROM registrations r
      WHERE r.id = NEW.registration_id
        AND r.event_id = NEW.event_id
        AND r.user_id = NEW.user_id
    )
  )
  OR (
    NEW.registration_id IS NULL
    AND NEW.proposal_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM session_proposals p
      LEFT JOIN proposal_speakers ps
        ON ps.proposal_id = p.id AND ps.user_id = NEW.user_id
      WHERE p.id = NEW.proposal_id
        AND p.event_id = NEW.event_id
        AND (p.proposer_user_id = NEW.user_id OR ps.id IS NOT NULL)
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'CONSENT_ACCEPTANCE_CONTEXT_INVALID');
END;

CREATE TRIGGER validate_consent_acceptance_update
BEFORE UPDATE OF registration_id, proposal_id, event_id, user_id ON consent_acceptances
FOR EACH ROW
WHEN NOT (
  (
    NEW.registration_id IS NOT NULL
    AND NEW.proposal_id IS NULL
    AND EXISTS (
      SELECT 1 FROM registrations r
      WHERE r.id = NEW.registration_id
        AND r.event_id = NEW.event_id
        AND r.user_id = NEW.user_id
    )
  )
  OR (
    NEW.registration_id IS NULL
    AND NEW.proposal_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM session_proposals p
      LEFT JOIN proposal_speakers ps
        ON ps.proposal_id = p.id AND ps.user_id = NEW.user_id
      WHERE p.id = NEW.proposal_id
        AND p.event_id = NEW.event_id
        AND (p.proposer_user_id = NEW.user_id OR ps.id IS NOT NULL)
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'CONSENT_ACCEPTANCE_CONTEXT_INVALID');
END;

-- Admin attendee export filters by event/status and emits chronological rows.
CREATE INDEX IF NOT EXISTS idx_registrations_event_status_created
  ON registrations(event_id, status, created_at);

-- Retention due-work discovers the oldest eligible events before joining their
-- registrations. The dynamic per-policy retention predicate cannot be indexed,
-- but this index supports the event ordering and avoids an unrelated table sort.
CREATE INDEX IF NOT EXISTS idx_events_ends_at_id
  ON events(ends_at, id);

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

-- Reviews are read back for one proposal in round order. Without this the
-- lookup scans the whole history and a proposal delete scans it again.
CREATE INDEX idx_proposal_review_history_proposal
  ON proposal_review_history(proposal_id, review_round, review_id);

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

-- Organization representative lifecycle notifications are durable and
-- transactional with their corresponding association, block, or restoration.
INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key,
   checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES (
  lower(hex(randomblob(16))), 'organization-identity-changed', 1,
  'Your organization identity changed',
  'Hi {{recipientName}},

{{changeMessage}}

When this identity is active, actions taken in that capacity are attributed to {{organizationName}}. Invitations require the recipient to sign in and accept them. If this change is unexpected, please contact an authorized contact for the organization.',
  'markdown', NULL, '', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transactional'
);

-- Email rendering has one canonical active version per template. Normalize any
-- branch-local duplicate active rows before enforcing the invariant; this is an
-- in-place status correction and does not rebuild the table.
WITH ranked_active_templates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY template_key
           ORDER BY version DESC, created_at DESC, id DESC
         ) AS active_rank
  FROM email_template_versions
  WHERE status = 'active'
)
UPDATE email_template_versions
SET status = 'archived'
WHERE id IN (
  SELECT id FROM ranked_active_templates WHERE active_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_template_versions_one_active
  ON email_template_versions(template_key)
  WHERE status = 'active';

-- ── Scheduled job registry ───────────────────────────────────────────────
--
-- One row per recurring job, replacing a fixed cron expression per lane.
-- The dispatcher is level-triggered: every job re-derives what is due from
-- domain state on each run, so a missed schedule is self-healing and a state
-- change never has to cancel anything. `wake_requested` is a latency hint set
-- by producers, never the correctness mechanism.
--
-- A scheduled invocation that exceeds its CPU limit is terminated without
-- running any error handler, so a crashed run cannot record its own failure.
-- The lease is therefore the only reliable detector: a run writes
-- `running_since` and `lease_expires_at` when it claims the job, and a run
-- that dies leaves them behind for the next pass to reap as `abandoned`.
CREATE TABLE scheduled_jobs (
  job_key               TEXT NOT NULL PRIMARY KEY,
  interval_seconds      INTEGER NOT NULL CHECK (interval_seconds > 0),
  next_run_at           TEXT NOT NULL,
  wake_requested        INTEGER NOT NULL DEFAULT 0 CHECK (wake_requested IN (0, 1)),

  -- Separate from last_run_at on purpose: "ran 2 minutes ago, last succeeded
  -- 3 days ago" is the alarming case a single timestamp hides.
  last_run_at           TEXT,
  last_success_at       TEXT,
  last_status           TEXT CHECK (last_status IN ('succeeded', 'failed', 'abandoned', 'budget_exhausted')),
  last_error            TEXT,
  last_duration_ms      INTEGER,

  -- A job that always dies mid-run is doing too much per tick; that is a
  -- different defect from one that raises an error, so they count separately.
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  consecutive_abandoned INTEGER NOT NULL DEFAULT 0,

  running_since         TEXT,
  lease_expires_at      TEXT,
  run_token             TEXT,

  paused_at             TEXT,
  paused_by_user_id     TEXT,
  paused_reason         TEXT,

  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((running_since IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((running_since IS NULL) = (run_token IS NULL)),
  FOREIGN KEY(paused_by_user_id) REFERENCES users(id)
);

-- The dispatcher's only selection path: unpaused jobs that are due or woken.
CREATE INDEX idx_scheduled_jobs_due
  ON scheduled_jobs(next_run_at, job_key)
  WHERE paused_at IS NULL;

-- The reaper's path: claimed runs whose lease has expired.
CREATE INDEX idx_scheduled_jobs_expired_lease
  ON scheduled_jobs(lease_expires_at)
  WHERE running_since IS NOT NULL;

CREATE INDEX idx_scheduled_jobs_paused
  ON scheduled_jobs(paused_at)
  WHERE paused_at IS NOT NULL;

-- Seeded from the cron expressions these lanes previously used, so cadence
-- becomes data rather than a deployment.
INSERT INTO scheduled_jobs (job_key, interval_seconds, next_run_at) VALUES
  ('due_work',                  900, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('on_hold_due_work',          900, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ec_auto_approve',           900, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('google_groups_sync',        900, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sponsorship_due_work',    86400, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('votes_due_work',            900, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('retention',               86400, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('consultation_batch',      86400, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('ec_review_batch',         86400, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('working_group_chair_digest', 604800, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ── Google Groups observed membership ────────────────────────────────────
--
-- Desired state records what we intend; this records what the provider
-- actually reported. Keeping them apart is what makes an unsubscribe
-- detectable: a member we once observed present who is now absent has left,
-- and must not be silently re-added by any reconciliation.
--
-- `confirmed_subscribed_at` is the first time we saw them present, so an
-- absence is only meaningful once presence was actually confirmed. Without
-- it, a member queued but not yet added would look like an unsubscribe.
CREATE TABLE google_groups_observed_membership (
  user_id                  TEXT NOT NULL,
  google_group_email       TEXT NOT NULL,

  confirmed_subscribed_at  TEXT,
  last_observed_present_at TEXT,
  last_observed_absent_at  TEXT,

  -- Set once, when a previously confirmed member is first seen absent.
  unsubscribed_at          TEXT,
  -- How we learned of it. 'provider_absence' is the always-available
  -- inference; the audit-log sources are enrichment and may be unavailable,
  -- because Groups audit events are retained for 180 days and do not cover
  -- every removal path.
  unsubscribe_source       TEXT CHECK (
    unsubscribe_source IN ('provider_absence', 'self_unsubscribe', 'admin_removed', 'account_removed')
  ),
  -- Cleared only by an explicit local resubscribe, never by reconciliation.
  suppressed               INTEGER NOT NULL DEFAULT 0 CHECK (suppressed IN (0, 1)),

  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, google_group_email),
  FOREIGN KEY(user_id) REFERENCES users(id),
  CHECK (unsubscribed_at IS NULL OR confirmed_subscribed_at IS NOT NULL),
  CHECK ((unsubscribed_at IS NULL) = (unsubscribe_source IS NULL))
);

-- Suppression lookup on the add path, and the unsubscribe-notification sweep.
CREATE INDEX idx_google_groups_observed_suppressed
  ON google_groups_observed_membership(user_id, google_group_email)
  WHERE suppressed = 1;

CREATE INDEX idx_google_groups_observed_unsubscribed
  ON google_groups_observed_membership(unsubscribed_at, user_id)
  WHERE unsubscribed_at IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- Member profile: skills a person is vouched for, what they are open to, and
-- the standing they have earned.
--
-- Two deliberate shapes:
--
--   * No CHECK freezes a vocabulary. Skill names, the reasons points are
--     awarded, recognition keys and availability visibility are all product
--     policy that will change; they are enforced by the shared Zod domain
--     schemas on every write path, which can evolve without a table rebuild.
--   * Points are a ledger, not a counter on `users`. A total that is only ever
--     incremented cannot be audited, corrected, or explained to the person it
--     describes; a ledger can be summed, and a wrong award is reversed by
--     another row rather than by editing history.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Skills ────────────────────────────────────────────────────────────────────

-- The consortium's shared skill vocabulary. Curated rather than free text, so
-- "eIDAS", "eIDAS " and "EIDAS" are one skill that can be counted and searched.
CREATE TABLE skills (
  id         TEXT NOT NULL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_skills_active ON skills(active, name);

-- A skill a person claims. The claim is theirs; the weight behind it comes
-- from the vouches below, which is why a claim carries no count of its own.
CREATE TABLE user_skills (
  id         TEXT NOT NULL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  skill_id   TEXT NOT NULL REFERENCES skills(id),
  -- The order the person arranged their own skills in.
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, skill_id)
);

CREATE INDEX idx_user_skills_user ON user_skills(user_id, sort_order, id);

-- One member vouching for one claimed skill.
--
-- The UNIQUE constraint is the whole anti-inflation rule that can be expressed
-- structurally: one person, one vouch, no repeats. The other two rules cannot
-- be — a row cannot see whether the voucher is the claimant, nor whether they
-- share a group — so they are enforced on the write path with test coverage.
CREATE TABLE user_skill_vouches (
  id              TEXT NOT NULL PRIMARY KEY,
  user_skill_id   TEXT NOT NULL REFERENCES user_skills(id),
  voucher_user_id TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL,
  UNIQUE(user_skill_id, voucher_user_id)
);

CREATE INDEX idx_user_skill_vouches_skill ON user_skill_vouches(user_skill_id);
CREATE INDEX idx_user_skill_vouches_voucher ON user_skill_vouches(voucher_user_id);

-- ── Availability ──────────────────────────────────────────────────────────────

-- What a member is open to. One row per person, absent when they have said
-- nothing — an absent row is "not looking", which is the safe default for
-- something this public.
--
-- `available_from` is a calendar date, not an instant: "available from Q1
-- 2027" is a date in the person's own reckoning and must not drift by a
-- timezone.
CREATE TABLE user_availability (
  user_id            TEXT NOT NULL PRIMARY KEY REFERENCES users(id),
  open_to_employment INTEGER NOT NULL DEFAULT 0 CHECK (open_to_employment IN (0, 1)),
  open_to_contract   INTEGER NOT NULL DEFAULT 0 CHECK (open_to_contract IN (0, 1)),
  -- What is on offer, as the member wrote it, kept apart because the two
  -- states are answered differently: someone open to employment names the
  -- roles they want, someone open to contract work names the services they
  -- sell. One column for both made a member who is open to only one of them
  -- read as if the other's terms applied too.
  roles_sought       TEXT,
  services_offered   TEXT,
  note               TEXT,
  available_from     TEXT,
  -- Who may see this. Evolvable policy, enforced in the shared schema.
  visibility         TEXT NOT NULL DEFAULT 'members',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- ── Standing ──────────────────────────────────────────────────────────────────

-- Points awarded, one row per award, never mutated.
--
-- `reason_key` says what earned it and `source_type`/`source_ref` point at the
-- thing that did — a meeting attended, a document reviewed — so an award can
-- be traced back and a duplicate can be detected. Points may be negative: a
-- correction is another row, not an edit.
CREATE TABLE user_standing_awards (
  id          TEXT NOT NULL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  reason_key  TEXT NOT NULL,
  points      INTEGER NOT NULL,
  source_type TEXT,
  source_ref  TEXT,
  awarded_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_user_standing_awards_user ON user_standing_awards(user_id, awarded_at, id);

-- The same award must never be recorded twice for the same cause. Partial so
-- that an award with no traceable source (a manual grant) is still allowed.
CREATE UNIQUE INDEX idx_user_standing_awards_source
  ON user_standing_awards(user_id, reason_key, source_type, source_ref)
  WHERE source_type IS NOT NULL AND source_ref IS NOT NULL;

-- Standings that are held rather than accumulated: "Chair", "Founding
-- delegate", "3-year streak". Distinct from points because they are stated,
-- not summed, and because one can be withdrawn without recomputing a total.
CREATE TABLE user_recognitions (
  id               TEXT NOT NULL PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  recognition_key  TEXT NOT NULL,
  label            TEXT NOT NULL,
  awarded_at       TEXT NOT NULL,
  withdrawn_at     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE(user_id, recognition_key),
  CHECK (withdrawn_at IS NULL OR withdrawn_at >= awarded_at)
);

CREATE INDEX idx_user_recognitions_user ON user_recognitions(user_id, awarded_at, id);

-- ── Standing levels ──────────────────────────────────────────────────────────

-- The bands a points total places into.
--
-- A reference table rather than constants in the application: what counts as a
-- Contributor is the consortium's decision and will be argued about, and a
-- threshold compiled into a deployment cannot be changed by the people who own
-- it. `from_points` is the floor of the band; the highest band has no ceiling.
CREATE TABLE standing_levels (
  id          TEXT NOT NULL PRIMARY KEY,
  level       INTEGER NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  from_points INTEGER NOT NULL UNIQUE,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_standing_levels_active ON standing_levels(active, from_points);

-- Opening positions, taken from the profile design. Provisional: change these
-- rows, not any code, when the consortium settles the ladder.
INSERT INTO standing_levels (id, level, name, from_points, active, created_at, updated_at) VALUES
  ('level-1', 1, 'Participant',  0,    1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('level-2', 2, 'Contributor',  250,  1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('level-3', 3, 'Contributor',  900,  1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('level-4', 4, 'Contributor',  1800, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('level-5', 5, 'Steward',      3000, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
