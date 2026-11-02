-- Shared promotion text is an attribute of the agenda session. Its approval
-- and audit lifecycle already belongs to the agenda revision, not another entity.
ALTER TABLE event_agenda_occurrences ADD COLUMN promotion_copy_json TEXT
 CHECK(promotion_copy_json IS NULL OR json_valid(promotion_copy_json));
UPDATE event_agenda_occurrences
 SET promotion_copy_json=(SELECT copy_json FROM event_agenda_promotion_copy WHERE occurrence_id=event_agenda_occurrences.id)
 WHERE EXISTS(SELECT 1 FROM event_agenda_promotion_copy WHERE occurrence_id=event_agenda_occurrences.id);
DROP TABLE event_agenda_promotion_copy;

-- Referral traffic and registrations already have canonical attribution.
-- File-download counters are not needed to deliver or credit shared materials.
DROP TABLE event_agenda_promotion_downloads;

-- Personal presentation choices contain authored promotion text and resource
-- references only. Names, affiliations, portraits, schedule and sponsor data
-- continue to be resolved from their canonical records.
CREATE TABLE event_promotion_kits (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 occurrence_id TEXT REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 1,
 composition_json TEXT NOT NULL CHECK(json_valid(composition_json)),
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX event_promotion_kit_owner ON event_promotion_kits(event_id,user_id,COALESCE(occurrence_id,''));

-- One render queue serves session and attendee kits. The old session-only
-- queue cannot represent attendee work because its session reference is required.
-- Carry unfinished work forward below; do not retain an unused cache archive.
CREATE TABLE event_promotion_renders (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 occurrence_id TEXT REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 fingerprint TEXT,
 format TEXT NOT NULL, origin TEXT NOT NULL, cache_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL, processing_token TEXT, lease_expires_at TEXT,
 last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, requested_at TEXT
);
CREATE INDEX event_promotion_render_due ON event_promotion_renders(status,next_attempt_at,lease_expires_at);
CREATE INDEX event_promotion_render_owner ON event_promotion_renders(event_id,user_id,occurrence_id,fingerprint,format);
-- Keep current kit progress bounded independently of completed or obsolete render history.
CREATE INDEX event_promotion_render_requested ON event_promotion_renders(event_id,user_id,occurrence_id,format,requested_at DESC);

-- A migrated request resolves its fingerprint and artifact location under the
-- normal worker lease. Completed cache entries are disposable; authored copy,
-- personal choices remain in their canonical records. The panel format is
-- retired, so its unfinished requests are not carried forward.
INSERT INTO event_promotion_renders
 (id,event_id,occurrence_id,user_id,revision,fingerprint,format,origin,cache_key,
  status,attempts,next_attempt_at,created_at,updated_at,requested_at)
SELECT id,event_id,occurrence_id,user_id,revision,NULL,format,origin,cache_key,
 'queued',attempts,
 CASE WHEN status='rendering' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE next_attempt_at END,
 created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'),created_at
FROM event_agenda_promotion_render_jobs
WHERE status IN ('queued','retrying','rendering') AND format<>'panel';
DROP TABLE event_agenda_promotion_render_jobs;

-- Badges join the same render queue: one row per referral code, its revision
-- counting re-render requests. Carry every badge row forward, so cached images
-- keep matching their revision; unfinished work resumes under a fresh lease.
INSERT INTO event_promotion_renders
 (id,event_id,occurrence_id,user_id,revision,fingerprint,format,origin,cache_key,
  status,attempts,next_attempt_at,last_error,created_at,updated_at,requested_at)
SELECT 'badge:'||referral.code,referral.event_id,NULL,
 CASE referral.owner_type WHEN 'registration' THEN registration.user_id ELSE referral.created_by_user_id END,
 job.requested_generation,NULL,'badge','','og-badges/'||referral.code,
 CASE WHEN job.status='rendering' THEN 'queued' ELSE job.status END,job.attempts,
 CASE WHEN job.status='rendering' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE job.next_attempt_at END,
 job.last_error,job.created_at,COALESCE(job.rendered_at,job.updated_at),job.updated_at
FROM badge_render_jobs job
JOIN referral_codes referral ON referral.code=job.referral_code
LEFT JOIN registrations registration ON referral.owner_type='registration' AND registration.id=referral.owner_id
WHERE CASE referral.owner_type WHEN 'registration' THEN registration.user_id ELSE referral.created_by_user_id END IS NOT NULL;
DROP TABLE badge_render_jobs;


-- A bulk request contains resource references only. The dispatcher prepares
-- bounded recipients for the existing render queue; it never renders a full
-- event inside an HTTP request.
CREATE TABLE event_promotion_batches (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 requested_by TEXT NOT NULL REFERENCES users(id),
 published_revision INTEGER NOT NULL,
 formats_json TEXT NOT NULL CHECK(json_valid(formats_json)),
 origin TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX event_promotion_batch_event ON event_promotion_batches(event_id,created_at);
CREATE TABLE event_promotion_batch_recipients (
 batch_id TEXT NOT NULL REFERENCES event_promotion_batches(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'queued',
 fingerprint TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL,
 processing_token TEXT,
 lease_expires_at TEXT,
 last_error TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(batch_id,occurrence_id,user_id)
);
CREATE INDEX event_promotion_batch_due ON event_promotion_batch_recipients(status,next_attempt_at,lease_expires_at);


-- Pending email changes are requests, not ownership. Verified primary/alias uniqueness remains unchanged.
DROP INDEX uq_users_pending_email;
DROP INDEX idx_users_pending_email_unique;
DROP TRIGGER trg_users_pending_email_reservation_update;

-- A speaker invitation is mailed to one address, which may be an alias of an existing account.
-- Until the speaker accepts, the proposer sees that address rather than the account's primary one,
-- and only that mailbox may continue from the link without another proof. NULL on rows that predate it.
ALTER TABLE proposal_speakers ADD COLUMN invited_email TEXT;

-- Sentence-case the seeded membership application questions. A label an
-- administrator has already edited no longer matches and is left alone.

UPDATE form_fields
SET label = 'Role or job title'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'job_title'
  AND label = 'Role / Job Title';

UPDATE form_fields
SET label = 'Organization website'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'organization_website'
  AND label = 'Organization Website';

UPDATE form_fields
SET label = 'About yourself'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'about_yourself'
  AND label = 'About Yourself';

UPDATE form_fields
SET label = 'About your organization'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'about_organization'
  AND label = 'About Your Organization';

UPDATE form_fields
SET label = 'Why do you want to join the PKI Consortium?'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'reason'
  AND label = 'Why do you want to join PKI Consortium?';

UPDATE form_fields
SET label = 'Working groups of interest'
WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
  AND key = 'working_groups'
  AND label = 'Working Groups of Interest';

-- Registration attendance is recorded per event day.
-- Replace the obsolete registration-wide attendance value with day-only attendance.
-- The old CHECK cannot be dropped in place, and a second column would preserve
-- contradictory sources of truth.
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
-- Registration-wide attendance was retired in 0039. Delivery must use the
-- confirmed day selection and its configured live access mode.
DROP VIEW email_delivery_guard_states;
CREATE VIEW email_delivery_guard_states AS
 SELECT reminder.id,reminder.sequence AS version,
 CASE WHEN reminder.status='queued' AND reminder.due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND reminder.start_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND person.active=1 AND person.email=reminder.recipient_email AND preference.reminder_enabled=1 AND preference.reminder_minutes=reminder.reminder_minutes
 AND participation.status='reserved' AND entry.sequence=reminder.sequence AND entry.status='confirmed'
 AND json_extract(occurrence.value,'$.startAt')=reminder.start_at
 AND registration.status='registered'
 AND EXISTS (
   SELECT 1 FROM registration_day_attendance attendance
   JOIN event_days day ON day.id=attendance.event_day_id
   WHERE attendance.registration_id=registration.id AND day.event_id=registration.event_id
     AND day.day_date=reminder.day_date
     AND COALESCE((
       SELECT CASE WHEN json_valid(option.value) THEN json_extract(option.value,'$.accessMode') END
       FROM json_each(CASE WHEN json_valid(day.attendance_options_json) THEN day.attendance_options_json ELSE '[]' END) option
       WHERE CASE WHEN json_valid(option.value) THEN json_extract(option.value,'$.value') END=attendance.attendance_type
       LIMIT 1
     ), CASE attendance.attendance_type WHEN 'in_person' THEN 'physical' WHEN 'virtual' THEN 'remote' ELSE 'none' END)=participation.attendance_mode
     AND NOT EXISTS (
       SELECT 1 FROM event_day_waitlist_entries waiting
       WHERE waiting.registration_id=attendance.registration_id AND waiting.event_day_id=attendance.event_day_id
         AND waiting.status IN ('waiting','offered','expired')
     )
 )
 THEN 1 ELSE 0 END AS deliverable
 FROM agenda_session_reminders reminder
 JOIN users person ON person.id=reminder.user_id
 JOIN agenda_calendar_preferences preference ON preference.event_id=reminder.event_id AND preference.user_id=reminder.user_id
 LEFT JOIN agenda_session_participations participation ON participation.occurrence_id=reminder.occurrence_id AND participation.user_id=reminder.user_id
 LEFT JOIN agenda_calendar_entries entry ON entry.event_id=reminder.event_id AND entry.occurrence_id=reminder.occurrence_id AND entry.user_id=reminder.user_id
 LEFT JOIN registrations registration ON registration.event_id=reminder.event_id AND registration.user_id=reminder.user_id
 LEFT JOIN event_agenda_state state ON state.event_id=reminder.event_id
 LEFT JOIN event_agenda_publications publication ON publication.event_id=state.event_id AND publication.revision=state.published_revision
 LEFT JOIN json_each(publication.snapshot_json,'$.occurrences') occurrence ON json_extract(occurrence.value,'$.id')=reminder.occurrence_id
 UNION ALL SELECT invitation.id,0 AS version,CASE WHEN invitation.revoked_at IS NULL AND person.active=1 THEN 1 ELSE 0 END AS deliverable
 FROM agenda_session_invitations invitation JOIN users person ON person.id=invitation.user_id;
