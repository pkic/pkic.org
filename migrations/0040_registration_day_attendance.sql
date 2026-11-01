-- Replace the obsolete registration-wide attendance value with day-only attendance.
-- Applied migration 0039 remains immutable. The old CHECK cannot be dropped in
-- place, and a second column would preserve contradictory sources of truth.
-- Stop if any registration still depends on the old value or unexpected child
-- triggers exist. Restore dependent rows and triggers inside the atomic batch.
-- Preview and production application require separate approval and coordination.
PRAGMA legacy_alter_table = ON;

-- Both tables contain only transient transaction guards and must be empty.
CREATE TABLE registration_rebuild_guard (invalid INTEGER NOT NULL CHECK (invalid = 0));
INSERT INTO registration_rebuild_guard (invalid)
 SELECT (SELECT COUNT(*) FROM registration_transition_guards) + (SELECT COUNT(*) FROM event_day_capacity_guards);

-- Refuse unexpected dependent-table triggers before suspending the known set.
INSERT INTO registration_rebuild_guard (invalid)
 SELECT ABS(COUNT(*) - 10) FROM sqlite_schema WHERE type = 'trigger' AND name IN ('trg_event_day_waitlist_delete_revision', 'trg_event_day_waitlist_insert_revision', 'trg_event_day_waitlist_update_revision', 'trg_registration_day_attendance_delete_revision', 'trg_registration_day_attendance_insert_revision', 'trg_registration_day_attendance_update_revision', 'validate_event_day_waitlist_insert', 'validate_event_day_waitlist_update', 'validate_registration_day_attendance_insert', 'validate_registration_day_attendance_update');
INSERT INTO registration_rebuild_guard (invalid)
 SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger'
 AND tbl_name IN ('calendar_rsvp_events', 'event_day_waitlist_entries', 'registration_attendance_history', 'registration_badge_role_overrides', 'registration_day_attendance')
 AND name NOT IN ('trg_event_day_waitlist_delete_revision', 'trg_event_day_waitlist_insert_revision', 'trg_event_day_waitlist_update_revision', 'trg_registration_day_attendance_delete_revision', 'trg_registration_day_attendance_insert_revision', 'trg_registration_day_attendance_update_revision', 'validate_event_day_waitlist_insert', 'validate_event_day_waitlist_update', 'validate_registration_day_attendance_insert', 'validate_registration_day_attendance_update');
DROP TRIGGER trg_event_day_waitlist_delete_revision;
DROP TRIGGER trg_event_day_waitlist_insert_revision;
DROP TRIGGER trg_event_day_waitlist_update_revision;
DROP TRIGGER trg_registration_day_attendance_delete_revision;
DROP TRIGGER trg_registration_day_attendance_insert_revision;
DROP TRIGGER trg_registration_day_attendance_update_revision;
DROP TRIGGER validate_event_day_waitlist_insert;
DROP TRIGGER validate_event_day_waitlist_update;
DROP TRIGGER validate_registration_day_attendance_insert;
DROP TRIGGER validate_registration_day_attendance_update;

-- Refuse loss of registration-only attendance; resolve those records before dropping the column.
INSERT INTO registration_rebuild_guard (invalid)
 SELECT COUNT(*) FROM registrations r WHERE NOT EXISTS (SELECT 1 FROM registration_day_attendance d WHERE d.registration_id = r.id);

CREATE TABLE registration_rebuild_backup_calendar_rsvp_events AS SELECT * FROM calendar_rsvp_events;
CREATE TABLE registration_rebuild_backup_event_day_waitlist_entries AS SELECT * FROM event_day_waitlist_entries;
CREATE TABLE registration_rebuild_backup_registration_attendance_history AS SELECT * FROM registration_attendance_history;
CREATE TABLE registration_rebuild_backup_registration_badge_role_overrides AS SELECT * FROM registration_badge_role_overrides;
CREATE TABLE registration_rebuild_backup_registration_day_attendance AS SELECT * FROM registration_day_attendance;

DELETE FROM calendar_rsvp_events;
DELETE FROM event_day_waitlist_entries;
DELETE FROM registration_attendance_history;
DELETE FROM registration_badge_role_overrides;
DELETE FROM registration_day_attendance;

DROP VIEW event_participant_role_sources;

CREATE TABLE registrations_rebuilt (
  id                              TEXT    NOT NULL PRIMARY KEY,
  event_id                        TEXT    NOT NULL,
  user_id                         TEXT    NOT NULL,
  invite_id                       TEXT,
  status                          TEXT    NOT NULL CHECK (status IN ('pending_email_confirmation', 'registered', 'waitlisted', 'cancelled')),
  source_type                     TEXT    NOT NULL CHECK (length(source_type) >= 2 AND length(source_type) <= 64),
  source_ref                      TEXT,
  custom_answers_json             TEXT,
  referred_by_code                TEXT,
  confirmation_link_secret         TEXT    UNIQUE,
  manage_link_secret               TEXT    NOT NULL UNIQUE,
  confirmed_at                    TEXT,
  cancelled_at                    TEXT,
  created_at                      TEXT    NOT NULL,
  updated_at                      TEXT    NOT NULL, confirmation_reminder_sent_at TEXT, pending_confirmation_deadline_at TEXT, cancellation_reason_code TEXT, transition_revision INTEGER NOT NULL DEFAULT 0, created_identity_user_id TEXT REFERENCES users(id), form_placement_id TEXT REFERENCES form_placements(id), registration_group_id TEXT REFERENCES groups(id), registration_identity_id TEXT REFERENCES identities(id) ON DELETE SET NULL,
  UNIQUE(event_id, user_id),
  FOREIGN KEY(event_id) REFERENCES events(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(invite_id) REFERENCES invites(id)
);

INSERT INTO registrations_rebuilt ("id", "event_id", "user_id", "invite_id", "status", "source_type", "source_ref", "custom_answers_json", "referred_by_code", "confirmation_link_secret", "manage_link_secret", "confirmed_at", "cancelled_at", "created_at", "updated_at", "confirmation_reminder_sent_at", "pending_confirmation_deadline_at", "cancellation_reason_code", "transition_revision", "created_identity_user_id", "form_placement_id", "registration_group_id", "registration_identity_id") SELECT "id", "event_id", "user_id", "invite_id", "status", "source_type", "source_ref", "custom_answers_json", "referred_by_code", "confirmation_link_secret", "manage_link_secret", "confirmed_at", "cancelled_at", "created_at", "updated_at", "confirmation_reminder_sent_at", "pending_confirmation_deadline_at", "cancellation_reason_code", "transition_revision", "created_identity_user_id", "form_placement_id", "registration_group_id", "registration_identity_id" FROM registrations;

DROP TABLE registrations;

ALTER TABLE registrations_rebuilt RENAME TO registrations;
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
  NULL AS subrole,
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

PRAGMA legacy_alter_table = OFF;

INSERT INTO calendar_rsvp_events SELECT * FROM registration_rebuild_backup_calendar_rsvp_events;
DROP TABLE registration_rebuild_backup_calendar_rsvp_events;
INSERT INTO event_day_waitlist_entries SELECT * FROM registration_rebuild_backup_event_day_waitlist_entries;
DROP TABLE registration_rebuild_backup_event_day_waitlist_entries;
INSERT INTO registration_attendance_history SELECT * FROM registration_rebuild_backup_registration_attendance_history;
DROP TABLE registration_rebuild_backup_registration_attendance_history;
INSERT INTO registration_badge_role_overrides SELECT * FROM registration_rebuild_backup_registration_badge_role_overrides;
DROP TABLE registration_rebuild_backup_registration_badge_role_overrides;
INSERT INTO registration_day_attendance SELECT * FROM registration_rebuild_backup_registration_day_attendance;
DROP TABLE registration_rebuild_backup_registration_day_attendance;

CREATE TRIGGER trg_event_day_waitlist_delete_revision
AFTER DELETE ON event_day_waitlist_entries
FOR EACH ROW
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE id = OLD.event_day_id;
END;

CREATE TRIGGER trg_event_day_waitlist_insert_revision
AFTER INSERT ON event_day_waitlist_entries
FOR EACH ROW
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE id = NEW.event_day_id;
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

CREATE TRIGGER trg_registration_day_attendance_delete_revision
AFTER DELETE ON registration_day_attendance
FOR EACH ROW
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE id = OLD.event_day_id;
END;

CREATE TRIGGER trg_registration_day_attendance_insert_revision
AFTER INSERT ON registration_day_attendance
FOR EACH ROW
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE id = NEW.event_day_id;
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


CREATE INDEX idx_registrations_created_at
  ON registrations(created_at);

CREATE INDEX idx_registrations_event_status ON registrations(event_id, status);

CREATE INDEX idx_registrations_event_status_created
  ON registrations(event_id, status, created_at);

CREATE INDEX idx_registrations_form_placement
  ON registrations(form_placement_id, created_at, id);

CREATE INDEX idx_registrations_group_event
  ON registrations(registration_group_id, event_id, status, created_at, id);

CREATE INDEX idx_registrations_identity ON registrations(registration_identity_id, event_id);

CREATE INDEX idx_registrations_user_event_status
  ON registrations(user_id, event_id, status);

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

CREATE TRIGGER trg_registration_capacity_delete_revision
AFTER DELETE ON registrations
FOR EACH ROW
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE event_id = OLD.event_id;
END;

CREATE TRIGGER trg_registration_capacity_insert_revision
AFTER INSERT ON registrations
FOR EACH ROW
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE event_id = NEW.event_id;
END;

CREATE TRIGGER trg_registration_capacity_update_revision
AFTER UPDATE OF status ON registrations
FOR EACH ROW
WHEN OLD.status IS NOT NEW.status
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE event_id IN (OLD.event_id, NEW.event_id);
END;

CREATE TRIGGER trg_registration_identity_owner_insert
BEFORE INSERT ON registrations
WHEN NEW.registration_identity_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM identities identity
    WHERE identity.id = NEW.registration_identity_id AND identity.user_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'REGISTRATION_IDENTITY_OWNER_MISMATCH'); END;

CREATE TRIGGER trg_registration_identity_owner_update
BEFORE UPDATE OF registration_identity_id, user_id ON registrations
WHEN NEW.registration_identity_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM identities identity
    WHERE identity.id = NEW.registration_identity_id AND identity.user_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'REGISTRATION_IDENTITY_OWNER_MISMATCH'); END;

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

-- Resetting deferred checks requires explicit proof that registration references survived.
INSERT INTO registration_rebuild_guard (invalid) SELECT COUNT(*) FROM registration_day_attendance child WHERE child.registration_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.id = child.registration_id);
INSERT INTO registration_rebuild_guard (invalid) SELECT COUNT(*) FROM registration_attendance_history child WHERE child.registration_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.id = child.registration_id);
INSERT INTO registration_rebuild_guard (invalid) SELECT COUNT(*) FROM event_day_waitlist_entries child WHERE child.registration_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.id = child.registration_id);
INSERT INTO registration_rebuild_guard (invalid) SELECT COUNT(*) FROM calendar_rsvp_events child WHERE child.registration_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.id = child.registration_id);
INSERT INTO registration_rebuild_guard (invalid) SELECT COUNT(*) FROM registration_badge_role_overrides child WHERE child.registration_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.id = child.registration_id);
INSERT INTO registration_rebuild_guard (invalid) SELECT COUNT(*) FROM registration_transition_guards child WHERE child.registration_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.id = child.registration_id);
INSERT INTO registration_rebuild_guard (invalid) SELECT COUNT(*) FROM event_day_capacity_guards child WHERE child.claim_registration_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.id = child.claim_registration_id);
DROP TABLE registration_rebuild_guard;
