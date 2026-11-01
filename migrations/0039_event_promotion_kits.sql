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
-- personal choices remain in their canonical records.
INSERT INTO event_promotion_renders
 (id,event_id,occurrence_id,user_id,revision,fingerprint,format,origin,cache_key,
  status,attempts,next_attempt_at,created_at,updated_at,requested_at)
SELECT id,event_id,occurrence_id,user_id,revision,NULL,format,origin,cache_key,
 'queued',attempts,
 CASE WHEN status='rendering' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE next_attempt_at END,
 created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'),created_at
FROM event_agenda_promotion_render_jobs
WHERE status IN ('queued','retrying','rendering');
DROP TABLE event_agenda_promotion_render_jobs;


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

-- Flexible event registration attendance types.
-- The aggregate uses the same event-configured value as its day records. Its
-- original CHECK froze an evolving vocabulary and rejected valid options.
-- Production and preview use the same registrations schema before this rebuild.
-- Preview already recorded 0039: apply this section only as an atomic file import.
-- A rebuild is necessary because the old column's CHECK cannot be altered in place.
-- An additive override would leave old readers with a misleading attendance type.
-- legacy_alter_table preserves views while the replacement receives its final name.
-- D1 does not disable foreign keys, and DROP can run cascades even when deferred.
-- The only cascading children are transient guard tables, asserted empty below.
-- Preserve dependent rows without leaving unresolved deferred foreign keys.
-- Their triggers are suspended and restored exactly to avoid side effects.
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

CREATE TABLE registrations_rebuilt (
  id                              TEXT    NOT NULL PRIMARY KEY,
  event_id                        TEXT    NOT NULL,
  user_id                         TEXT    NOT NULL,
  invite_id                       TEXT,
  status                          TEXT    NOT NULL CHECK (status IN ('pending_email_confirmation', 'registered', 'waitlisted', 'cancelled')),
  attendance_type                 TEXT    NOT NULL,
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

INSERT INTO registrations_rebuilt ("id", "event_id", "user_id", "invite_id", "status", "attendance_type", "source_type", "source_ref", "custom_answers_json", "referred_by_code", "confirmation_link_secret", "manage_link_secret", "confirmed_at", "cancelled_at", "created_at", "updated_at", "confirmation_reminder_sent_at", "pending_confirmation_deadline_at", "cancellation_reason_code", "transition_revision", "created_identity_user_id", "form_placement_id", "registration_group_id", "registration_identity_id") SELECT "id", "event_id", "user_id", "invite_id", "status", "attendance_type", "source_type", "source_ref", "custom_answers_json", "referred_by_code", "confirmation_link_secret", "manage_link_secret", "confirmed_at", "cancelled_at", "created_at", "updated_at", "confirmation_reminder_sent_at", "pending_confirmation_deadline_at", "cancellation_reason_code", "transition_revision", "created_identity_user_id", "form_placement_id", "registration_group_id", "registration_identity_id" FROM registrations;

DROP TABLE registrations;

ALTER TABLE registrations_rebuilt RENAME TO registrations;
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

CREATE INDEX idx_registrations_event_status       ON registrations(event_id, status, attendance_type);

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
