-- One additive migration for pending platform changes, including private organization contacts.
-- Organization affiliations exist independently of organization membership.
-- Identity is independent of membership: anyone may hold an organization
-- affiliation or an individual identity, so no membership guard remains.
DROP TRIGGER IF EXISTS trg_identities_member_scope_insert;
DROP TRIGGER trg_identities_reject_individual_conflict_insert;
DROP TRIGGER trg_identities_reject_individual_conflict_update;
DROP TRIGGER trg_members_reject_organization_identity_insert;
DROP TRIGGER trg_members_reject_organization_identity_update;
ALTER TABLE proposal_speakers ADD COLUMN acting_identity_id TEXT REFERENCES identities(id);
ALTER TABLE proposal_speakers ADD COLUMN acting_identity_selected_at TEXT;
CREATE INDEX proposal_speakers_acting_identity ON proposal_speakers(acting_identity_id) WHERE acting_identity_id IS NOT NULL;
CREATE TRIGGER proposal_speaker_identity_binding_insert BEFORE INSERT ON proposal_speakers
WHEN (NEW.acting_identity_selected_at IS NULL AND NEW.acting_identity_id IS NOT NULL)
  OR (NEW.acting_identity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM identities WHERE id=NEW.acting_identity_id AND user_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'PROPOSAL_SPEAKER_IDENTITY_BINDING_INVALID'); END;
CREATE TRIGGER proposal_speaker_identity_binding_update BEFORE UPDATE OF user_id,acting_identity_id,acting_identity_selected_at ON proposal_speakers
WHEN (NEW.acting_identity_selected_at IS NULL AND NEW.acting_identity_id IS NOT NULL)
  OR (NEW.acting_identity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM identities WHERE id=NEW.acting_identity_id AND user_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'PROPOSAL_SPEAKER_IDENTITY_BINDING_INVALID'); END;
-- ── Event city and country ─────────────────────────────────────────────────
-- Where an event takes place is two normalized columns rather than one
-- free-text settings label: lists and public pages read, filter and sort by
-- them, and the country is an ISO 3166-1 alpha-2 code whose name is resolved
-- for the reader at presentation. The CHECK holds only the code's durable
-- shape; which codes exist is validated by the shared contract.
ALTER TABLE events ADD COLUMN city TEXT;
ALTER TABLE events ADD COLUMN country TEXT CHECK(country IS NULL OR (length(country) = 2 AND country GLOB '[A-Z][A-Z]'));
-- Backfill from the retired `settings_json.location` label where it reads as
-- "City, Country" (or "City, Region, Country") and the last part names a
-- country this mapping knows; the region is dropped. A label that names how
-- people attend ("Amsterdam and online") or any other shape is left null for
-- organizers to fill in. These backfills add new facts and retire a key no
-- client may send, so they keep each event's revision.
WITH country_names(name, code) AS (VALUES
  ('netherlands','NL'),('the netherlands','NL'),('nl','NL'),
  ('united states','US'),('united states of america','US'),('the united states','US'),('usa','US'),('us','US'),
  ('canada','CA'),('ca','CA'),
  ('malaysia','MY'),('my','MY')
), labels AS (
  SELECT id, trim(json_extract(settings_json,'$.location')) AS label
    FROM events
   WHERE json_valid(settings_json) AND json_type(settings_json,'$.location') = 'text'
), parts AS (
  SELECT id, trim(substr(label, 1, instr(label, ',') - 1)) AS city,
         lower(trim(replace(label, rtrim(label, replace(label, ',', '')), ''))) AS country_name
    FROM labels WHERE instr(label, ',') > 1
)
UPDATE events
   SET city = parts.city, country = country_names.code
  FROM parts JOIN country_names ON country_names.name = parts.country_name
 WHERE events.id = parts.id AND events.city IS NULL AND events.country IS NULL
   AND parts.city <> '' AND length(parts.city) <= 80
   AND lower(parts.city) NOT GLOB '*online*' AND lower(parts.city) NOT GLOB '*virtual*'
   AND lower(parts.city) NOT GLOB '*hybrid*' AND parts.city NOT GLOB '*[/&+|]*'
   AND lower(parts.city) NOT GLOB '* and *' AND lower(parts.city) NOT GLOB '* or *';
-- The label is retired with its contract field; nothing reads the key again.
UPDATE events SET settings_json = json_remove(settings_json,'$.location')
 WHERE json_valid(settings_json) AND json_type(settings_json,'$.location') IS NOT NULL;
-- The past conferences never carried the label; their pages name the city and country. Slugs and
-- zones as the importers wrote them: scripts/migrate-members/constants.mjs for the three Hugo events,
-- and the agenda importer's directory slug for Ottawa 2023 (created as a portal event).
-- Sources: content/events/2023/pqc-conference-amsterdam-nl/index.md, content/events/2025/pqc-conference-austin-us/index.md,
-- content/events/2025/pqc-conference-kuala-lumpur-my/_index.md, content/events/2023/post-quantum-cryptography-conference/index.md
WITH authored_places(slug, timezone, city, country) AS (VALUES
  ('pqc-conference-amsterdam-nl-2023','Europe/Amsterdam','Amsterdam','NL'),
  ('pqc-conference-austin-us-2025','America/Chicago','Austin','US'),
  ('pqc-conference-kuala-lumpur-my-2025','Asia/Kuala_Lumpur','Kuala Lumpur','MY'),
  ('post-quantum-cryptography-conference','America/Toronto','Ottawa','CA')
)
UPDATE events
   SET city = authored_places.city, country = authored_places.country
  FROM authored_places
 WHERE events.slug = authored_places.slug AND events.timezone = authored_places.timezone
   AND events.city IS NULL AND events.country IS NULL;
CREATE TABLE event_agenda_state (event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 0, travel_minutes INTEGER NOT NULL DEFAULT 0 CHECK(travel_minutes >= 0), published_revision INTEGER, updated_at TEXT NOT NULL);
-- virtual_room_url: a location's default virtual-room link; sessions without their own media plan follow it.
CREATE TABLE event_agenda_rooms (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, name TEXT NOT NULL, setup_minutes INTEGER NOT NULL DEFAULT 0 CHECK(setup_minutes >= 0), capacity INTEGER CHECK(capacity >= 0), virtual_room_url TEXT, UNIQUE(event_id,name));
-- planned_media_json: NULL follows the primary location's planned media; a JSON object is the session's own plan.
CREATE TABLE event_agenda_occurrences (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', presentation_url TEXT,recording_url TEXT,start_at TEXT, end_at TEXT, room_id TEXT REFERENCES event_agenda_rooms(id), admission_policy TEXT NOT NULL DEFAULT 'preference', remote_capacity INTEGER CHECK(remote_capacity >= 0), capacity INTEGER CHECK(capacity >= 0), visibility TEXT NOT NULL DEFAULT 'public', kind TEXT NOT NULL DEFAULT 'session', track TEXT, format TEXT, placeholder INTEGER NOT NULL DEFAULT 0 CHECK(placeholder IN (0,1)), planned_media_json TEXT CHECK(planned_media_json IS NULL OR json_valid(planned_media_json)), source_key TEXT, CHECK((start_at IS NULL AND end_at IS NULL) OR (start_at IS NOT NULL AND end_at > start_at)), UNIQUE(event_id,source_key));
CREATE INDEX event_agenda_occurrences_schedule ON event_agenda_occurrences(event_id,start_at,id);
CREATE INDEX event_agenda_occurrences_track ON event_agenda_occurrences(event_id,track,id);
CREATE INDEX event_agenda_occurrences_room ON event_agenda_occurrences(event_id,room_id,start_at,end_at);
CREATE TABLE event_agenda_occurrence_speakers (occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(occurrence_id,user_id));
CREATE INDEX event_agenda_speaker_schedule ON event_agenda_occurrence_speakers(user_id,occurrence_id);
CREATE TABLE event_agenda_shifts (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,name TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,room_id TEXT REFERENCES event_agenda_rooms(id),track TEXT,roles_json TEXT NOT NULL,role_requirements_json TEXT NOT NULL DEFAULT '[]',CHECK(end_at > start_at));
CREATE TABLE event_agenda_role_members (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),roles_json TEXT NOT NULL,seniority TEXT NOT NULL DEFAULT 'junior',attendance_mode TEXT NOT NULL DEFAULT 'physical',available_from TEXT,available_until TEXT,max_minutes INTEGER CHECK(max_minutes > 0),PRIMARY KEY(event_id,user_id));
CREATE UNIQUE INDEX event_agenda_shifts_event_identity ON event_agenda_shifts(event_id,id);
CREATE UNIQUE INDEX event_agenda_rooms_event_identity ON event_agenda_rooms(event_id,id);
CREATE TABLE event_agenda_staffing_roles (
  id TEXT NOT NULL,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,name TEXT NOT NULL,
  show_on_agenda INTEGER NOT NULL DEFAULT 0 CHECK(show_on_agenda IN(0,1)),
  PRIMARY KEY(event_id,id),UNIQUE(event_id,name)
);
CREATE TABLE event_agenda_staffing_posts (
  id TEXT NOT NULL,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,name TEXT NOT NULL,room_id TEXT,
  PRIMARY KEY(event_id,id),UNIQUE(event_id,name),
  FOREIGN KEY(event_id,room_id) REFERENCES event_agenda_rooms(event_id,id)
);
CREATE TABLE event_agenda_staffing_requirements (
  id TEXT NOT NULL,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,shift_id TEXT NOT NULL,
  role_id TEXT NOT NULL,post_id TEXT,ideal_count INTEGER NOT NULL CHECK(ideal_count > 0),
  seniority TEXT NOT NULL,
  attendance_mode TEXT NOT NULL,
  PRIMARY KEY(event_id,id),UNIQUE(event_id,id,shift_id,role_id),
  FOREIGN KEY(event_id,shift_id) REFERENCES event_agenda_shifts(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,role_id) REFERENCES event_agenda_staffing_roles(event_id,id),
  FOREIGN KEY(event_id,post_id) REFERENCES event_agenda_staffing_posts(event_id,id)
);
CREATE UNIQUE INDEX event_agenda_staffing_requirement_scope ON event_agenda_staffing_requirements(event_id,shift_id,role_id,COALESCE(post_id,''));
CREATE TABLE event_agenda_staffing_positions (
  id TEXT NOT NULL,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,requirement_id TEXT NOT NULL,
  position_index INTEGER NOT NULL CHECK(position_index > 0),
  PRIMARY KEY(event_id,id),UNIQUE(event_id,requirement_id,position_index),
  FOREIGN KEY(event_id,requirement_id) REFERENCES event_agenda_staffing_requirements(event_id,id) ON DELETE CASCADE
);
CREATE TABLE event_agenda_assignments (
  position_id TEXT NOT NULL,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  shift_id TEXT NOT NULL,role TEXT NOT NULL,post_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id),pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN(0,1)),
  PRIMARY KEY(event_id,position_id),
  FOREIGN KEY(event_id,position_id) REFERENCES event_agenda_staffing_positions(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,shift_id) REFERENCES event_agenda_shifts(event_id,id),
  FOREIGN KEY(event_id,role) REFERENCES event_agenda_staffing_roles(event_id,id),
  FOREIGN KEY(event_id,post_id) REFERENCES event_agenda_staffing_posts(event_id,id)
);
CREATE TRIGGER event_agenda_assignment_position_binding_insert BEFORE INSERT ON event_agenda_assignments
WHEN NOT EXISTS(SELECT 1 FROM event_agenda_staffing_positions position JOIN event_agenda_staffing_requirements requirement ON requirement.id=position.requirement_id AND requirement.event_id=position.event_id
  WHERE position.id=NEW.position_id AND position.event_id=NEW.event_id AND requirement.shift_id=NEW.shift_id AND requirement.role_id=NEW.role AND requirement.post_id IS NEW.post_id)
BEGIN SELECT RAISE(ABORT,'AGENDA_ASSIGNMENT_POSITION_MISMATCH'); END;
CREATE TRIGGER event_agenda_assignment_position_binding_update BEFORE UPDATE ON event_agenda_assignments
WHEN NOT EXISTS(SELECT 1 FROM event_agenda_staffing_positions position JOIN event_agenda_staffing_requirements requirement ON requirement.id=position.requirement_id AND requirement.event_id=position.event_id
  WHERE position.id=NEW.position_id AND position.event_id=NEW.event_id AND requirement.shift_id=NEW.shift_id AND requirement.role_id=NEW.role AND requirement.post_id IS NEW.post_id)
BEGIN SELECT RAISE(ABORT,'AGENDA_ASSIGNMENT_POSITION_MISMATCH'); END;
CREATE INDEX event_agenda_assignments_person ON event_agenda_assignments(user_id,shift_id);
CREATE TABLE event_agenda_schedule_guards (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),valid INTEGER NOT NULL,CONSTRAINT agenda_schedule_valid CHECK(valid=1));
CREATE TABLE event_agenda_publications (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,UNIQUE(event_id,revision));
CREATE TABLE agenda_session_participations (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),attendance_mode TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(occurrence_id,user_id));
CREATE INDEX agenda_participation_capacity ON agenda_session_participations(occurrence_id,status,attendance_mode);
CREATE TABLE event_badge_credentials (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),user_id TEXT NOT NULL REFERENCES users(id),credential_hash TEXT NOT NULL UNIQUE,print_credential_json TEXT,revoked_at TEXT,created_at TEXT NOT NULL);
CREATE INDEX event_badge_users ON event_badge_credentials(event_id,user_id);
CREATE INDEX event_badge_manifest ON event_badge_credentials(event_id,id);
CREATE TABLE event_scan_attempts (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT REFERENCES event_agenda_occurrences(id),badge_id TEXT REFERENCES event_badge_credentials(id),sponsor_id TEXT REFERENCES sponsorships(id),user_id TEXT REFERENCES users(id),operator_user_id TEXT NOT NULL REFERENCES users(id),device_id TEXT NOT NULL,operation_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,outcome TEXT NOT NULL,reason TEXT NOT NULL,exception_reason TEXT,action TEXT NOT NULL,observed_at TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX event_scan_attempts_target ON event_scan_attempts(event_id,occurrence_id,observed_at,id);
CREATE TABLE event_attendance_observations (id TEXT PRIMARY KEY,attempt_id TEXT UNIQUE REFERENCES event_scan_attempts(id),event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),attendance_mode TEXT NOT NULL,observed_at TEXT NOT NULL);
CREATE INDEX event_attendance_target ON event_attendance_observations(event_id,occurrence_id,user_id);
CREATE TABLE event_sponsor_leads (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),sponsor_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),operator_user_id TEXT NOT NULL REFERENCES users(id),observed_at TEXT NOT NULL,UNIQUE(event_id,sponsor_id,user_id));
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))), 'role-admin', permission, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT 'agenda:scan' AS permission UNION ALL SELECT 'agenda:admit_exceptions' UNION ALL SELECT 'agenda:attendance_read' UNION ALL SELECT 'agenda:leads_capture' UNION ALL SELECT 'agenda:leads_export') AS candidate
WHERE NOT EXISTS(SELECT 1 FROM role_permissions existing WHERE existing.role_id='role-admin' AND existing.permission=candidate.permission);
CREATE TABLE event_session_admissions (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),operation_id TEXT NOT NULL UNIQUE,admitted_at TEXT NOT NULL,UNIQUE(occurrence_id,user_id));
CREATE INDEX event_session_admissions_capacity ON event_session_admissions(occurrence_id,user_id);

-- Extend scoped authorization to canonical event sponsorship IDs; retain all existing guards.
DROP TRIGGER validate_permission_grant_context_insert;
CREATE TRIGGER validate_permission_grant_context_insert
BEFORE INSERT ON permission_grants
FOR EACH ROW
WHEN (NEW.context_type IS NULL AND NEW.context_id IS NOT NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_id IS NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_type NOT IN ('event', 'group', 'organization', 'event_sponsor'))
  OR (NEW.context_type = 'event' AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.context_id))
  OR (NEW.context_type = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = NEW.context_id))
  OR (NEW.context_type = 'organization' AND NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.context_id))
  OR (NEW.context_type = 'event_sponsor' AND NOT EXISTS (SELECT 1 FROM sponsorships WHERE id = NEW.context_id AND sponsor_type = 'event' AND event_id IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'PERMISSION_GRANT_CONTEXT_INVALID');
END;

DROP TRIGGER validate_permission_grant_context_update;
CREATE TRIGGER validate_permission_grant_context_update
BEFORE UPDATE OF context_type, context_id ON permission_grants
FOR EACH ROW
WHEN (NEW.context_type IS NULL AND NEW.context_id IS NOT NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_id IS NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_type NOT IN ('event', 'group', 'organization', 'event_sponsor'))
  OR (NEW.context_type = 'event' AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.context_id))
  OR (NEW.context_type = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = NEW.context_id))
  OR (NEW.context_type = 'organization' AND NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.context_id))
  OR (NEW.context_type = 'event_sponsor' AND NOT EXISTS (SELECT 1 FROM sponsorships WHERE id = NEW.context_id AND sponsor_type = 'event' AND event_id IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'PERMISSION_GRANT_CONTEXT_INVALID');
END;

DROP TRIGGER validate_user_role_context_insert;
CREATE TRIGGER validate_user_role_context_insert
BEFORE INSERT ON user_roles
FOR EACH ROW
WHEN (NEW.context_type IS NULL AND NEW.context_id IS NOT NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_id IS NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_type NOT IN ('event', 'group', 'organization', 'event_sponsor'))
  OR (NEW.context_type = 'event' AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.context_id))
  OR (NEW.context_type = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = NEW.context_id))
  OR (NEW.context_type = 'organization' AND NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.context_id))
  OR (NEW.context_type = 'event_sponsor' AND NOT EXISTS (SELECT 1 FROM sponsorships WHERE id = NEW.context_id AND sponsor_type = 'event' AND event_id IS NOT NULL))
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

DROP TRIGGER validate_user_role_context_update;
CREATE TRIGGER validate_user_role_context_update
BEFORE UPDATE OF user_id, role_id, context_type, context_id, identity_id, member_id, revoked_at ON user_roles
FOR EACH ROW
WHEN (NEW.context_type IS NULL AND NEW.context_id IS NOT NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_id IS NULL)
  OR (NEW.context_type IS NOT NULL AND NEW.context_type NOT IN ('event', 'group', 'organization', 'event_sponsor'))
  OR (NEW.context_type = 'event' AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.context_id))
  OR (NEW.context_type = 'group' AND NOT EXISTS (SELECT 1 FROM groups WHERE id = NEW.context_id))
  OR (NEW.context_type = 'organization' AND NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.context_id))
  OR (NEW.context_type = 'event_sponsor' AND NOT EXISTS (SELECT 1 FROM sponsorships WHERE id = NEW.context_id AND sponsor_type = 'event' AND event_id IS NOT NULL))
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

CREATE TABLE event_offline_admission_grants (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT REFERENCES event_agenda_occurrences(id),event_day_id TEXT REFERENCES event_days(id),day_date TEXT NOT NULL,
 operator_user_id TEXT NOT NULL REFERENCES users(id),device_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>=0),
 published_revision INTEGER,issued_at TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,closed_at TEXT,
 activation_id TEXT,created_by TEXT NOT NULL REFERENCES users(id),CHECK(expires_at>issued_at)
);
CREATE INDEX event_offline_grants_capacity ON event_offline_admission_grants(occurrence_id,closed_at);
CREATE INDEX event_offline_grants_device ON event_offline_admission_grants(event_id,operator_user_id,device_id,closed_at);
CREATE TABLE event_offline_admission_entitlements (
 grant_id TEXT NOT NULL REFERENCES event_offline_admission_grants(id),user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(grant_id,user_id)
);
CREATE TABLE event_offline_admission_spends (
 operation_id TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES event_offline_admission_grants(id),slot INTEGER CHECK(slot>=0),
 user_id TEXT NOT NULL REFERENCES users(id),observed_at TEXT NOT NULL,accepted_at TEXT NOT NULL,UNIQUE(grant_id,slot),UNIQUE(grant_id,user_id)
);
CREATE INDEX event_offline_spends_grant ON event_offline_admission_spends(grant_id,slot);

CREATE TABLE event_entry_admissions(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),day_date TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),operation_id TEXT NOT NULL UNIQUE,admitted_at TEXT NOT NULL,UNIQUE(event_id,day_date,user_id));
CREATE INDEX event_entry_admissions_capacity ON event_entry_admissions(event_id,day_date,user_id);
-- Archive metadata belongs to the mutable draft.
-- Approved event_agenda_publications.snapshot_json freezes it at publication time.
CREATE TABLE event_agenda_session_history (
 occurrence_id TEXT PRIMARY KEY REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL
);
CREATE TABLE event_agenda_promotion_copy (
 occurrence_id TEXT PRIMARY KEY REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 copy_json TEXT NOT NULL CHECK(json_valid(copy_json)),
 updated_by TEXT NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL
);
CREATE TABLE event_agenda_promotion_downloads (
 occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id), format TEXT NOT NULL,
 download_count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(occurrence_id,user_id,format)
);
CREATE TABLE event_agenda_promotion_render_jobs (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),
 user_id TEXT NOT NULL REFERENCES users(id), revision INTEGER NOT NULL,format TEXT NOT NULL,origin TEXT NOT NULL,cache_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',
 attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT NOT NULL,processing_token TEXT,lease_expires_at TEXT,last_error TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(occurrence_id,user_id,revision,format)
);
CREATE INDEX event_agenda_promotion_render_due ON event_agenda_promotion_render_jobs(status,next_attempt_at,lease_expires_at);

-- Session participation approval and waitlist state.
ALTER TABLE agenda_session_participations ADD COLUMN approval_state TEXT NOT NULL DEFAULT 'none';
ALTER TABLE agenda_session_participations ADD COLUMN waitlisted_at TEXT;
CREATE TABLE agenda_session_holds (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),
 occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),
 attendance_mode TEXT NOT NULL CHECK(attendance_mode IN ('physical','remote')),
 expires_at TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),reason_code TEXT NOT NULL,
 revoked_at TEXT,created_at TEXT NOT NULL,
 CHECK(expires_at>created_at)
);
CREATE INDEX agenda_session_holds_capacity ON agenda_session_holds(occurrence_id,attendance_mode,revoked_at,expires_at);
CREATE TABLE agenda_calendar_subscriptions (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),user_id TEXT NOT NULL REFERENCES users(id),
 token_hash TEXT NOT NULL UNIQUE,include_tentative INTEGER NOT NULL DEFAULT 0 CHECK(include_tentative IN (0,1)),
 revoked_at TEXT,created_at TEXT NOT NULL
);
CREATE INDEX agenda_calendar_subscriptions_owner ON agenda_calendar_subscriptions(event_id,user_id,revoked_at);
CREATE TABLE agenda_calendar_preferences (
 event_id TEXT NOT NULL REFERENCES events(id),user_id TEXT NOT NULL REFERENCES users(id),
 reminder_enabled INTEGER NOT NULL DEFAULT 0 CHECK(reminder_enabled IN (0,1)),
 reminder_minutes INTEGER NOT NULL DEFAULT 10 CHECK(reminder_minutes BETWEEN 1 AND 1440),
 updated_at TEXT NOT NULL,PRIMARY KEY(event_id,user_id)
);
CREATE TABLE agenda_calendar_entries (
 event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),
 sequence INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL,status TEXT NOT NULL,
 title TEXT NOT NULL,start_at TEXT,end_at TEXT,location TEXT,updated_at TEXT NOT NULL,
 PRIMARY KEY(event_id,occurrence_id,user_id)
);
CREATE INDEX agenda_calendar_entries_owner ON agenda_calendar_entries(event_id,user_id,status,updated_at);
CREATE TABLE agenda_participation_jobs(event_id TEXT PRIMARY KEY REFERENCES events(id),requested_at TEXT NOT NULL,last_checked_at TEXT,cursor_updated_at TEXT,cursor_id TEXT);
CREATE TABLE agenda_session_reminders (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),
 sequence INTEGER NOT NULL,reminder_minutes INTEGER NOT NULL,day_date TEXT NOT NULL,start_at TEXT NOT NULL,due_at TEXT NOT NULL,
 recipient_email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL,UNIQUE(occurrence_id,user_id,sequence,reminder_minutes)
);
CREATE INDEX agenda_session_reminders_due ON agenda_session_reminders(status,due_at);
CREATE VIEW email_delivery_guard_states AS
 SELECT reminder.id,reminder.sequence AS version,
 CASE WHEN reminder.status='queued' AND reminder.due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND reminder.start_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND person.active=1 AND person.email=reminder.recipient_email AND preference.reminder_enabled=1 AND preference.reminder_minutes=reminder.reminder_minutes
 AND participation.status='reserved' AND entry.sequence=reminder.sequence AND entry.status='confirmed'
 AND json_extract(occurrence.value,'$.startAt')=reminder.start_at
 AND registration.status='registered'
 AND COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=registration.id AND day.day_date=reminder.day_date),
   CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=reminder.event_id AND day.day_date=reminder.day_date) THEN 'none' ELSE registration.attendance_type END)=CASE participation.attendance_mode WHEN 'physical' THEN 'in_person' ELSE 'virtual' END
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
 UNION ALL SELECT invitation.id,0 AS version,CASE WHEN invitation.revoked_at IS NULL AND person.active=1 THEN 1 ELSE 0 END AS deliverable FROM agenda_session_invitations invitation JOIN users person ON person.id=invitation.user_id;
ALTER TABLE agenda_session_participations ADD COLUMN attendance_day_date TEXT;
INSERT INTO scheduled_jobs(job_key,interval_seconds,next_run_at) VALUES('agenda_participation',60,strftime('%Y-%m-%dT%H:%M:%fZ','now')),('agenda_reminders',60,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
ALTER TABLE event_agenda_occurrences ADD COLUMN access_policy TEXT NOT NULL DEFAULT 'open' CHECK(access_policy IN ('open','invitation'));
ALTER TABLE event_agenda_occurrences ADD COLUMN booking_opens_at TEXT;
ALTER TABLE event_agenda_occurrences ADD COLUMN booking_closes_at TEXT;
CREATE TABLE agenda_session_delegations(occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,revoked_at TEXT,PRIMARY KEY(occurrence_id,user_id));
CREATE TABLE agenda_session_invitation_audit(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,reason_code TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE agenda_session_invitations(id TEXT NOT NULL UNIQUE,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),invited_by TEXT NOT NULL REFERENCES users(id),reason_code TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT,accepted_at TEXT,reply_context_json TEXT,reply_mode TEXT,reply_revision INTEGER NOT NULL DEFAULT 0,reply_sequence INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(occurrence_id,user_id));
ALTER TABLE agenda_session_participations ADD COLUMN saved INTEGER NOT NULL DEFAULT 0 CHECK(saved IN (0,1));
ALTER TABLE agenda_session_participations ADD COLUMN allocation_revision INTEGER NOT NULL DEFAULT 0;

CREATE INDEX agenda_session_participations_person_agenda ON agenda_session_participations(event_id,user_id,occurrence_id,status,saved);

ALTER TABLE event_agenda_rooms ADD COLUMN equipment_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(equipment_json));
ALTER TABLE event_agenda_occurrences ADD COLUMN required_equipment_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(required_equipment_json));
ALTER TABLE event_agenda_rooms ADD COLUMN available_periods_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(available_periods_json));

CREATE TABLE event_agenda_published_occurrences (
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 occurrence_id TEXT NOT NULL,
 room_json TEXT CHECK(room_json IS NULL OR json_valid(room_json)),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 PRIMARY KEY(event_id,revision,occurrence_id),
 FOREIGN KEY(event_id,revision) REFERENCES event_agenda_publications(event_id,revision) ON DELETE CASCADE
);

CREATE TABLE event_meeting_agenda_formats (
 series_id TEXT NOT NULL REFERENCES event_series(id),version INTEGER NOT NULL CHECK(version>0),name TEXT NOT NULL,items_json TEXT NOT NULL CHECK(json_valid(items_json)),created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 PRIMARY KEY(series_id,version)
);
CREATE TABLE event_meeting_agenda_state (
 series_id TEXT PRIMARY KEY REFERENCES event_series(id),format_version INTEGER NOT NULL DEFAULT 0 CHECK(format_version>=0),write_revision INTEGER NOT NULL DEFAULT 0 CHECK(write_revision>=0),updated_at TEXT NOT NULL
);
CREATE TABLE event_meeting_occurrence_agendas (
 occurrence_id TEXT PRIMARY KEY REFERENCES event_occurrences(id),series_id TEXT NOT NULL REFERENCES event_series(id),revision INTEGER NOT NULL CHECK(revision>0),format_version INTEGER NOT NULL CHECK(format_version>=0),name TEXT NOT NULL,items_json TEXT NOT NULL CHECK(json_valid(items_json)),exception INTEGER NOT NULL DEFAULT 0 CHECK(exception IN(0,1)),published_at TEXT,created_by TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL
);
CREATE INDEX event_meeting_agendas_series ON event_meeting_occurrence_agendas(series_id,published_at,exception,occurrence_id);
CREATE TABLE event_meeting_agenda_write_guards (
 id TEXT PRIMARY KEY,series_id TEXT NOT NULL REFERENCES event_series(id),occurrence_id TEXT,expected_revision INTEGER NOT NULL,expected_format_version INTEGER NOT NULL,expected_write_revision INTEGER NOT NULL,created_at TEXT NOT NULL,duration_valid INTEGER NOT NULL DEFAULT 1 CONSTRAINT meeting_agenda_duration_valid CHECK(duration_valid=1)
);
CREATE TRIGGER event_meeting_agenda_revision_guard BEFORE INSERT ON event_meeting_agenda_write_guards
BEGIN
 SELECT CASE WHEN COALESCE((SELECT write_revision FROM event_meeting_agenda_state WHERE series_id=NEW.series_id),0)<>NEW.expected_write_revision THEN RAISE(ABORT,'MEETING_AGENDA_REVISION_CHANGED') END;
 SELECT CASE WHEN COALESCE((SELECT format_version FROM event_meeting_agenda_state WHERE series_id=NEW.series_id),0)<>NEW.expected_format_version THEN RAISE(ABORT,'MEETING_AGENDA_REVISION_CHANGED') END;
 SELECT CASE WHEN NEW.occurrence_id IS NOT NULL AND COALESCE((SELECT revision FROM event_meeting_occurrence_agendas WHERE occurrence_id=NEW.occurrence_id),0)<>NEW.expected_revision THEN RAISE(ABORT,'MEETING_AGENDA_REVISION_CHANGED') END;
END;
CREATE TRIGGER event_meeting_agenda_mutability_guard BEFORE INSERT ON event_meeting_agenda_write_guards
WHEN NEW.occurrence_id IS NOT NULL
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM event_occurrences WHERE id=NEW.occurrence_id AND series_id=NEW.series_id AND status='scheduled' AND starts_at>NEW.created_at) THEN RAISE(ABORT,'MEETING_AGENDA_IMMUTABLE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM event_meeting_occurrence_agendas WHERE occurrence_id=NEW.occurrence_id AND published_at IS NOT NULL) THEN RAISE(ABORT,'MEETING_AGENDA_IMMUTABLE') END;
END;
CREATE TABLE meeting_agenda_speaker_intervals (
 event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL REFERENCES event_occurrences(id),item_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),start_at TEXT NOT NULL,end_at TEXT NOT NULL,room_id TEXT REFERENCES event_agenda_rooms(id),
 PRIMARY KEY(occurrence_id,item_id,user_id),CHECK(end_at>start_at)
);
CREATE INDEX meeting_agenda_speaker_event ON meeting_agenda_speaker_intervals(event_id,occurrence_id);
CREATE INDEX meeting_agenda_speaker_time ON meeting_agenda_speaker_intervals(user_id,start_at,end_at);
CREATE TRIGGER event_meeting_agenda_new_occurrence AFTER INSERT ON event_occurrences
WHEN EXISTS(SELECT 1 FROM event_meeting_agenda_state WHERE series_id=NEW.series_id AND format_version>0)
BEGIN
 INSERT INTO event_meeting_occurrence_agendas(occurrence_id,series_id,revision,format_version,name,items_json,exception,created_by,updated_at)
 SELECT NEW.id,NEW.series_id,1,format.version,format.name,format.items_json,0,format.created_by,NEW.updated_at
 FROM event_meeting_agenda_state state JOIN event_meeting_agenda_formats format ON format.series_id=state.series_id AND format.version=state.format_version
 WHERE state.series_id=NEW.series_id AND NEW.starts_at>NEW.created_at;
END;

CREATE TABLE event_agenda_occurrence_rooms(occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,room_id TEXT NOT NULL REFERENCES event_agenda_rooms(id),PRIMARY KEY(occurrence_id,room_id));
CREATE INDEX event_agenda_occurrence_rooms_room ON event_agenda_occurrence_rooms(room_id,occurrence_id);
ALTER TABLE event_session_admissions ADD COLUMN room_id TEXT REFERENCES event_agenda_rooms(id);
ALTER TABLE event_offline_admission_grants ADD COLUMN room_id TEXT REFERENCES event_agenda_rooms(id);
ALTER TABLE event_scan_attempts ADD COLUMN room_id TEXT REFERENCES event_agenda_rooms(id);
ALTER TABLE event_attendance_observations ADD COLUMN room_id TEXT REFERENCES event_agenda_rooms(id);
CREATE INDEX event_session_admissions_room_capacity ON event_session_admissions(occurrence_id,room_id);
CREATE INDEX event_offline_admission_grants_room_capacity ON event_offline_admission_grants(occurrence_id,room_id,closed_at);

-- Canonical session content and event placements.
CREATE TABLE event_agenda_contents(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'session',track TEXT,speaker_user_ids_json TEXT NOT NULL DEFAULT '[]',source_key TEXT,source_snapshot_json TEXT,source_review_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,proposal_id TEXT REFERENCES session_proposals(id),UNIQUE(event_id,source_key));
CREATE INDEX event_agenda_contents_event ON event_agenda_contents(event_id,title,id);
-- The accepted proposal a session content was placed from: the one link the sources list and the speaker acceptance read.
CREATE INDEX event_agenda_contents_proposal ON event_agenda_contents(proposal_id,event_id) WHERE proposal_id IS NOT NULL;
CREATE INDEX event_agenda_contents_track ON event_agenda_contents(event_id,track,id);
ALTER TABLE event_agenda_occurrences ADD COLUMN content_id TEXT REFERENCES event_agenda_contents(id);
CREATE INDEX event_agenda_occurrences_content ON event_agenda_occurrences(content_id,event_id);
CREATE TRIGGER event_agenda_occurrence_content_scope_insert BEFORE INSERT ON event_agenda_occurrences WHEN NEW.content_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM event_agenda_contents content WHERE content.id=NEW.content_id AND content.event_id=NEW.event_id) BEGIN SELECT RAISE(ABORT,'agenda_content_event_mismatch'); END;
CREATE TRIGGER event_agenda_occurrence_content_scope_update BEFORE UPDATE OF content_id,event_id ON event_agenda_occurrences WHEN NEW.content_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM event_agenda_contents content WHERE content.id=NEW.content_id AND content.event_id=NEW.event_id) BEGIN SELECT RAISE(ABORT,'agenda_content_event_mismatch'); END;
ALTER TABLE event_agenda_contents ADD COLUMN speaker_roles_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE event_agenda_occurrence_speakers ADD COLUMN role TEXT NOT NULL DEFAULT 'speaker';

ALTER TABLE event_agenda_shifts ADD COLUMN compatible_roles_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE event_agenda_shifts ADD COLUMN boundaries_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE event_agenda_assignments ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';

-- Private immutable capacity authority; never part of the public publication JSON.
ALTER TABLE event_agenda_occurrence_speakers ADD COLUMN attendance_mode TEXT NOT NULL DEFAULT 'physical';
ALTER TABLE event_agenda_occurrence_speakers ADD COLUMN room_id TEXT REFERENCES event_agenda_rooms(id);
CREATE TABLE event_agenda_operational_people(event_id TEXT NOT NULL REFERENCES events(id),revision INTEGER NOT NULL,occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),attendance_mode TEXT NOT NULL,room_id TEXT REFERENCES event_agenda_rooms(id),sources_json TEXT NOT NULL,PRIMARY KEY(event_id,revision,occurrence_id,user_id));
CREATE INDEX event_agenda_operational_people_capacity ON event_agenda_operational_people(occurrence_id,revision,attendance_mode,room_id,user_id);

ALTER TABLE event_offline_admission_grants ADD COLUMN private_access_required INTEGER NOT NULL DEFAULT 0;
CREATE TABLE event_offline_admission_access (
 grant_id TEXT NOT NULL REFERENCES event_offline_admission_grants(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 PRIMARY KEY(grant_id,user_id)
);

-- Private immutable physical event-day capacity; no attendee registration is fabricated.
CREATE TABLE event_agenda_operational_days(event_id TEXT NOT NULL REFERENCES events(id),revision INTEGER NOT NULL,day_date TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),sources_json TEXT NOT NULL,PRIMARY KEY(event_id,revision,day_date,user_id));
CREATE INDEX event_agenda_operational_days_capacity ON event_agenda_operational_days(event_id,day_date,revision,user_id);
CREATE TRIGGER trg_agenda_operational_days_capacity_revision AFTER UPDATE OF published_revision ON event_agenda_state WHEN NEW.published_revision IS NOT OLD.published_revision BEGIN UPDATE event_days SET capacity_revision=capacity_revision+1 WHERE event_id=NEW.event_id; END;

-- Canonical requests for the existing full-site build/deploy pipeline; no second asset/deployment path.
CREATE TABLE site_publication_requests (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 resource_type TEXT NOT NULL,
 resource_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=0),
 reason_code TEXT NOT NULL,
 document_effects_json TEXT NOT NULL DEFAULT '[]',
 document_effects_completed_at TEXT,
 deduplication_key TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'queued',
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 lease_token TEXT,
 lease_owner TEXT,
 lease_expires_at TEXT,
 next_attempt_at TEXT,
 last_error_code TEXT,
 last_error_at TEXT,
 source_sequence INTEGER CHECK(source_sequence>=sequence),
 snapshot_id TEXT,
 build_id TEXT,
 release_id TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX site_publication_requests_resource_sequence ON site_publication_requests(resource_type,resource_id,sequence DESC);
CREATE INDEX site_publication_requests_due ON site_publication_requests(status,next_attempt_at,lease_expires_at,sequence);
CREATE TABLE site_publication_delivery_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 desired_sequence INTEGER NOT NULL DEFAULT 0 CHECK(desired_sequence>=0),
 delivered_sequence INTEGER NOT NULL DEFAULT 0 CHECK(delivered_sequence>=0 AND delivered_sequence<=desired_sequence),
 snapshot_id TEXT,
 build_id TEXT,
 release_id TEXT,
 activation_receipt_id TEXT,
 activated_at TEXT,
 updated_at TEXT NOT NULL
);
INSERT INTO site_publication_delivery_state(id,updated_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE site_publication_activation_receipts (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL REFERENCES site_publication_requests(id),
 source_sequence INTEGER NOT NULL CHECK(source_sequence>0),
 snapshot_id TEXT NOT NULL,
 build_id TEXT NOT NULL,
 release_id TEXT NOT NULL,
 activated_at TEXT NOT NULL,
 recorded_at TEXT NOT NULL
);
CREATE INDEX site_publication_activation_sequence ON site_publication_activation_receipts(source_sequence DESC);
-- A deduplication key identifies one immutable logical request, never another resource or revision.
CREATE TRIGGER site_publication_request_deduplication_guard BEFORE INSERT ON site_publication_requests
WHEN EXISTS(SELECT 1 FROM site_publication_requests existing WHERE existing.deduplication_key=NEW.deduplication_key AND (existing.resource_type<>NEW.resource_type OR existing.resource_id<>NEW.resource_id OR existing.revision<>NEW.revision OR existing.reason_code<>NEW.reason_code OR existing.document_effects_json<>NEW.document_effects_json))
BEGIN SELECT RAISE(ABORT,'SITE_PUBLICATION_REQUEST_KEY_CONFLICT'); END;
CREATE TRIGGER site_publication_request_desired_sequence AFTER INSERT ON site_publication_requests
BEGIN INSERT INTO site_publication_delivery_state(id,desired_sequence,updated_at) VALUES(1,NEW.sequence,NEW.created_at) ON CONFLICT(id) DO UPDATE SET desired_sequence=MAX(site_publication_delivery_state.desired_sequence,excluded.desired_sequence),updated_at=excluded.updated_at; END;
-- Logical request identity is immutable while lease/status/build observations may evolve.
CREATE TRIGGER site_publication_request_identity_immutable BEFORE UPDATE OF sequence,id,resource_type,resource_id,revision,reason_code,deduplication_key,created_at,document_effects_json ON site_publication_requests
WHEN NEW.sequence<>OLD.sequence OR NEW.id<>OLD.id OR NEW.resource_type<>OLD.resource_type OR NEW.resource_id<>OLD.resource_id OR NEW.revision<>OLD.revision OR NEW.reason_code<>OLD.reason_code OR NEW.deduplication_key<>OLD.deduplication_key OR NEW.created_at<>OLD.created_at OR NEW.document_effects_json<>OLD.document_effects_json
BEGIN SELECT RAISE(ABORT,'SITE_PUBLICATION_REQUEST_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER site_publication_delivery_monotonic BEFORE UPDATE ON site_publication_delivery_state
WHEN NEW.desired_sequence<OLD.desired_sequence OR NEW.delivered_sequence<OLD.delivered_sequence
BEGIN SELECT RAISE(ABORT,'SITE_PUBLICATION_SEQUENCE_REGRESSION'); END;
CREATE TRIGGER site_publication_activation_immutable BEFORE UPDATE ON site_publication_activation_receipts
BEGIN SELECT RAISE(ABORT,'SITE_PUBLICATION_ACTIVATION_IMMUTABLE'); END;

-- Retain agenda:scan as an explicit legacy broad capability. No grants are
-- cloned and no revoked/expired/context-bound grant is broadened. Runtime
-- capability resolution accepts legacy authority only with token restrictions.
ALTER TABLE event_badge_credentials ADD COLUMN expires_at TEXT;
CREATE INDEX idx_event_badge_expiry ON event_badge_credentials(event_id,expires_at);
-- New independently assignable action permissions are canonical vocabulary;
-- existing admin agenda:scan retains historical authority through resolver.
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),'role-admin',candidate.permission,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT 'agenda:check' AS permission UNION ALL SELECT 'agenda:admit' UNION ALL SELECT 'agenda:attendance_record') candidate
WHERE NOT EXISTS(SELECT 1 FROM role_permissions existing WHERE existing.role_id='role-admin' AND existing.permission=candidate.permission);

-- Correction history protects original observation deletion. Personal identities
-- follow configured event retention/anonymization; IDs-only evidence and scoped
-- audit remain until an explicit audited evidence purge, never a separate TTL.
CREATE TABLE event_attendance_corrections (
 id TEXT PRIMARY KEY, observation_id TEXT NOT NULL REFERENCES event_attendance_observations(id),
 event_id TEXT NOT NULL REFERENCES events(id), actor_user_id TEXT NOT NULL REFERENCES users(id),
 operation_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision>0),
 kind TEXT NOT NULL, reason_code TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(observation_id,revision)
);
CREATE INDEX event_attendance_correction_history ON event_attendance_corrections(event_id,observation_id,revision);
CREATE TABLE event_attendance_correction_state (
 observation_id TEXT PRIMARY KEY REFERENCES event_attendance_observations(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0), voided INTEGER NOT NULL CHECK(voided IN(0,1))
);
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),'role-admin',candidate.permission,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT 'agenda:attendance_correct' AS permission) candidate
WHERE NOT EXISTS(SELECT 1 FROM role_permissions existing WHERE existing.role_id='role-admin' AND existing.permission=candidate.permission);

-- Distinct domain CAS guard cannot be confused with permission revocation.
CREATE TABLE event_attendance_correction_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL,CONSTRAINT attendance_correction_revision_valid CHECK(valid=1));

-- Day-centric physical allocation reads avoid registration-row subquery fanout.
CREATE INDEX registration_day_attendance_capacity_cover ON registration_day_attendance(event_day_id,attendance_type,registration_id);
-- Bounded day-level rights lookup; session-level indexes remain independent.
CREATE INDEX event_offline_grants_day_capacity_cover ON event_offline_admission_grants(event_id,day_date,closed_at,id,quantity) WHERE occurrence_id IS NULL;

ALTER TABLE event_agenda_occurrences ADD COLUMN public_anchor TEXT;
CREATE UNIQUE INDEX event_agenda_occurrences_public_anchor ON event_agenda_occurrences(event_id,public_anchor) WHERE public_anchor IS NOT NULL;
CREATE TABLE event_agenda_import_provenance (
 occurrence_id TEXT PRIMARY KEY REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,
 import_mode TEXT NOT NULL,
 source_format TEXT NOT NULL, source_version INTEGER NOT NULL, source_path TEXT NOT NULL,
 source_ref TEXT NOT NULL, source_anchor TEXT, source_digest TEXT NOT NULL,
 timing_json TEXT NOT NULL, media_json TEXT NOT NULL, people_json TEXT NOT NULL,
 imported_by TEXT REFERENCES users(id), imported_at TEXT NOT NULL
);
CREATE TRIGGER event_agenda_import_identity_guard BEFORE INSERT ON event_agenda_import_provenance
WHEN EXISTS (
 SELECT 1 FROM json_each(NEW.people_json) person
 WHERE json_extract(person.value,'$.actingIdentityId') IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM identities identity
 WHERE identity.id=json_extract(person.value,'$.actingIdentityId')
 AND identity.user_id=json_extract(person.value,'$.userId')
 AND identity.started_at IS NOT NULL AND identity.started_at<=json_extract(NEW.timing_json,'$.startAt')
 AND (identity.ended_at IS NULL OR identity.ended_at>json_extract(NEW.timing_json,'$.startAt'))
 AND (identity.blocked_at IS NULL OR identity.blocked_at>json_extract(NEW.timing_json,'$.startAt'))
 ))
BEGIN SELECT RAISE(ABORT,'AGENDA_TRANSFER_IDENTITY_INVALID'); END;

CREATE TABLE event_agenda_appearance_override_requests (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),
 user_id TEXT NOT NULL REFERENCES users(id),appearance_json TEXT NOT NULL,base_appearance_json TEXT,
 reason TEXT NOT NULL,evidence TEXT NOT NULL,requested_by TEXT NOT NULL REFERENCES users(id),requested_at TEXT NOT NULL
);
CREATE INDEX event_agenda_appearance_override_occurrence ON event_agenda_appearance_override_requests(event_id,occurrence_id,requested_at,id);
CREATE TABLE event_agenda_appearance_override_decisions (
 request_id TEXT PRIMARY KEY REFERENCES event_agenda_appearance_override_requests(id),decision TEXT NOT NULL,
 reason TEXT NOT NULL,reviewed_by TEXT NOT NULL REFERENCES users(id),reviewed_at TEXT NOT NULL,revision INTEGER NOT NULL
);
CREATE TRIGGER event_agenda_appearance_override_request_immutable BEFORE UPDATE ON event_agenda_appearance_override_requests BEGIN SELECT RAISE(ABORT,'Appearance override requests are immutable'); END;
CREATE TRIGGER event_agenda_appearance_override_decision_immutable BEFORE UPDATE ON event_agenda_appearance_override_decisions BEGIN SELECT RAISE(ABORT,'Appearance override decisions are immutable'); END;
CREATE TABLE event_agenda_appearance_override_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL,CONSTRAINT appearance_override_evidence_valid CHECK(valid=1));
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),'role-admin','agenda:appearance_approve',strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS(SELECT 1 FROM role_permissions WHERE role_id='role-admin' AND permission='agenda:appearance_approve');

-- event_attendance_observations.attempt_id is nullable: camera observations keep
-- their unique attempt reference, while imported evidence has its own provenance
-- rather than fabricated scan attempts.
CREATE TABLE event_attendance_import_reviews (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),
 operation_id TEXT NOT NULL UNIQUE,actor_user_id TEXT NOT NULL REFERENCES users(id),
 payload_hash TEXT NOT NULL,payload_json TEXT NOT NULL,reviewed_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,applied_at TEXT
);
CREATE TABLE event_attendance_imports (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),
 operation_id TEXT NOT NULL UNIQUE,review_id TEXT NOT NULL UNIQUE REFERENCES event_attendance_import_reviews(id),
 reviewer_user_id TEXT NOT NULL REFERENCES users(id),actor_user_id TEXT NOT NULL REFERENCES users(id),
 source TEXT NOT NULL,source_reference TEXT NOT NULL,row_count INTEGER NOT NULL,
 received_at TEXT NOT NULL
);
CREATE INDEX event_attendance_imports_event_received ON event_attendance_imports(event_id,received_at,id);
CREATE TABLE event_attendance_import_provenance (
 observation_id TEXT PRIMARY KEY REFERENCES event_attendance_observations(id),
 import_id TEXT NOT NULL REFERENCES event_attendance_imports(id),event_id TEXT NOT NULL REFERENCES events(id),
 source TEXT NOT NULL,source_reference TEXT NOT NULL,source_record_id TEXT NOT NULL,
 verification TEXT NOT NULL,
 UNIQUE(event_id,source,source_reference,source_record_id)
);
CREATE TABLE event_attendance_import_guards (
 id TEXT PRIMARY KEY,valid INTEGER NOT NULL CONSTRAINT attendance_import_review_valid CHECK(valid=1)
);
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),'role-admin','agenda:attendance_import',strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS(SELECT 1 FROM role_permissions WHERE role_id='role-admin' AND permission='agenda:attendance_import');

-- No automatic lease expiry can release an unresolved external provider write.
CREATE TABLE site_publication_pipeline_fence (
 id INTEGER PRIMARY KEY CHECK(id=1),
 attempt_id TEXT,
 lease_token TEXT,
 updated_at TEXT NOT NULL,
 CHECK((attempt_id IS NULL)=(lease_token IS NULL))
);
INSERT INTO site_publication_pipeline_fence(id,updated_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE site_publication_provider_attempts (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL REFERENCES site_publication_requests(id),
 source_sequence INTEGER NOT NULL CHECK(source_sequence>0),
 lease_token TEXT NOT NULL,
 provider_json TEXT NOT NULL,
 environment TEXT NOT NULL,
 public_origin TEXT NOT NULL,
 phase TEXT NOT NULL,
 build_id TEXT UNIQUE,
 version_id TEXT UNIQUE,
 snapshot_id TEXT,
 error_code TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX site_publication_provider_attempts_phase ON site_publication_provider_attempts(phase,updated_at,id);
CREATE TRIGGER site_publication_provider_attempt_identity BEFORE UPDATE OF id,request_id,source_sequence,lease_token,provider_json,environment,public_origin,created_at ON site_publication_provider_attempts
WHEN NEW.id<>OLD.id OR NEW.request_id<>OLD.request_id OR NEW.source_sequence<>OLD.source_sequence OR NEW.lease_token<>OLD.lease_token OR NEW.provider_json<>OLD.provider_json OR NEW.environment<>OLD.environment OR NEW.public_origin<>OLD.public_origin OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'PUBLICATION_ATTEMPT_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER site_publication_provider_build_identity BEFORE UPDATE OF build_id,version_id ON site_publication_provider_attempts
WHEN (OLD.build_id IS NOT NULL AND NEW.build_id IS NOT OLD.build_id) OR (OLD.version_id IS NOT NULL AND NEW.version_id IS NOT OLD.version_id)
BEGIN SELECT RAISE(ABORT,'PUBLICATION_PROVIDER_IDENTITY_IMMUTABLE'); END;
-- Native build evidence is append-only and contains no machine credentials or lease token.
CREATE TABLE site_publication_attempt_releases (
 attempt_id TEXT PRIMARY KEY REFERENCES site_publication_provider_attempts(id),
 version_id TEXT NOT NULL UNIQUE,
 source_sequence INTEGER NOT NULL CHECK(source_sequence>0),
 snapshot_id TEXT NOT NULL,
 integrity_digest TEXT NOT NULL,
 worker_bundle_sha256 TEXT NOT NULL,
 release_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TRIGGER site_publication_attempt_release_immutable BEFORE UPDATE ON site_publication_attempt_releases
BEGIN SELECT RAISE(ABORT,'PUBLICATION_RELEASE_IMMUTABLE'); END;
CREATE TABLE site_publication_attempt_activation (
 attempt_id TEXT PRIMARY KEY REFERENCES site_publication_provider_attempts(id),
 deployment_id TEXT UNIQUE,
 created_at TEXT NOT NULL,
 confirmed_at TEXT
);
CREATE TRIGGER site_publication_attempt_activation_identity BEFORE UPDATE OF attempt_id,deployment_id,created_at ON site_publication_attempt_activation
WHEN NEW.attempt_id<>OLD.attempt_id OR (OLD.deployment_id IS NOT NULL AND NEW.deployment_id IS NOT OLD.deployment_id) OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'PUBLICATION_ACTIVATION_INTENT_IMMUTABLE'); END;
CREATE TABLE site_publication_machine_evidence (
 id TEXT PRIMARY KEY,
 attempt_id TEXT NOT NULL REFERENCES site_publication_provider_attempts(id),
 identity_type TEXT NOT NULL,
 machine_build_id TEXT NOT NULL,
 action TEXT NOT NULL,
 evidence_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX site_publication_machine_evidence_attempt ON site_publication_machine_evidence(attempt_id,created_at,id);
CREATE TRIGGER site_publication_machine_evidence_immutable BEFORE UPDATE ON site_publication_machine_evidence
BEGIN SELECT RAISE(ABORT,'PUBLICATION_MACHINE_EVIDENCE_IMMUTABLE'); END;

-- The recurring job is explicitly dormant pending approved deployment ownership.
INSERT INTO scheduled_jobs(job_key,interval_seconds,next_run_at,paused_at,paused_reason)
VALUES('site_publication',60,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'Awaiting approved publication owner configuration');
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),'role-admin','site:publish',strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS(SELECT 1 FROM role_permissions WHERE role_id='role-admin' AND permission='site:publish');

-- Sponsor lead lists and provenance remain bounded under high-volume scanning.
CREATE INDEX event_sponsor_leads_capture_page ON event_sponsor_leads(event_id,sponsor_id,observed_at,id);
CREATE INDEX event_scan_attempts_lead_history ON event_scan_attempts(event_id,sponsor_id,user_id,created_at,id) WHERE action='lead' AND outcome='eligible';

-- Canonical vocabulary; live contacts still require an exact sponsor grant.
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),'role-admin','agenda:leads_view',strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS(SELECT 1 FROM role_permissions WHERE role_id='role-admin' AND permission='agenda:leads_view');

-- Whole-event/event-local-day reporting uses original observed time ranges.
-- Session reports retain their existing target-specific indexes.
CREATE INDEX event_attendance_event_observed ON event_attendance_observations(event_id,observed_at,id,user_id,occurrence_id,attendance_mode);
CREATE INDEX event_scan_attempts_event_observed ON event_scan_attempts(event_id,observed_at,id,user_id,occurrence_id);

-- Optional browser notifications; no provider secrets or plaintext subscriptions in D1.
CREATE TABLE agenda_push_devices (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),endpoint_hash TEXT NOT NULL UNIQUE,
 subscription_ciphertext TEXT NOT NULL,vapid_key_hash TEXT NOT NULL,expires_at TEXT,revoked_at TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX agenda_push_devices_owner ON agenda_push_devices(user_id,revoked_at,id);
CREATE TABLE agenda_push_event_preferences (
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,device_id TEXT NOT NULL REFERENCES agenda_push_devices(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),reminder_minutes INTEGER NOT NULL DEFAULT 15 CHECK(reminder_minutes BETWEEN 1 AND 1440),
 consented_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(event_id,device_id)
);
CREATE INDEX agenda_push_preferences_enabled ON agenda_push_event_preferences(event_id,enabled,device_id);
CREATE TABLE agenda_push_outbox (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),device_id TEXT NOT NULL REFERENCES agenda_push_devices(id),user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL,occurrence_id TEXT,day_date TEXT,reminder_minutes INTEGER,source_version INTEGER NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,
 destination TEXT NOT NULL,due_at TEXT NOT NULL,expires_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',
 attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,next_attempt_at TEXT NOT NULL,
 accepted_at TEXT,last_error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX agenda_push_outbox_due ON agenda_push_outbox(status,next_attempt_at,id);
CREATE INDEX agenda_push_outbox_device ON agenda_push_outbox(device_id,status,id);
CREATE INDEX agenda_push_outbox_event ON agenda_push_outbox(event_id,occurrence_id,user_id,status);

-- Preserve expired event contact purpose when existing end/profile policy changes.
-- This clock never purges raw evidence or the canonical account email.
CREATE TABLE event_contact_retention_state (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  closed_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL
);
CREATE TRIGGER event_contact_retention_end_change
BEFORE UPDATE OF ends_at ON events
WHEN OLD.ends_at IS NOT NULL AND EXISTS(SELECT 1 FROM retention_policies policy WHERE policy.event_id=OLD.id AND julianday(OLD.ends_at,'+'||policy.user_retention_days||' days')<=julianday('now'))
BEGIN
  INSERT INTO event_contact_retention_state(event_id,closed_at,deadline_at)
  SELECT OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ',OLD.ends_at,'+'||policy.user_retention_days||' days'),strftime('%Y-%m-%dT%H:%M:%fZ',OLD.ends_at,'+'||policy.user_retention_days||' days')
  FROM retention_policies policy WHERE policy.event_id=OLD.id ON CONFLICT(event_id) DO NOTHING;
END;
CREATE TRIGGER event_contact_retention_policy_change
BEFORE UPDATE ON retention_policies
WHEN EXISTS(SELECT 1 FROM events event WHERE event.id=OLD.event_id AND event.ends_at IS NOT NULL AND julianday(event.ends_at,'+'||OLD.user_retention_days||' days')<=julianday('now'))
BEGIN
  INSERT INTO event_contact_retention_state(event_id,closed_at,deadline_at)
  SELECT OLD.event_id,strftime('%Y-%m-%dT%H:%M:%fZ',event.ends_at,'+'||OLD.user_retention_days||' days'),strftime('%Y-%m-%dT%H:%M:%fZ',event.ends_at,'+'||OLD.user_retention_days||' days')
  FROM events event WHERE event.id=OLD.event_id ON CONFLICT(event_id) DO NOTHING;
END;
CREATE TRIGGER event_contact_retention_policy_delete
BEFORE DELETE ON retention_policies
WHEN EXISTS(SELECT 1 FROM events event WHERE event.id=OLD.event_id AND event.ends_at IS NOT NULL AND julianday(event.ends_at,'+'||OLD.user_retention_days||' days')<=julianday('now'))
BEGIN
  INSERT INTO event_contact_retention_state(event_id,closed_at,deadline_at)
  SELECT OLD.event_id,strftime('%Y-%m-%dT%H:%M:%fZ',event.ends_at,'+'||OLD.user_retention_days||' days'),strftime('%Y-%m-%dT%H:%M:%fZ',event.ends_at,'+'||OLD.user_retention_days||' days')
  FROM events event WHERE event.id=OLD.event_id ON CONFLICT(event_id) DO NOTHING;
END;

-- Correct known Hugo importer calendar dates using authored event bounds.
-- Preserve unknown Amsterdam end; the preceding retention triggers preserve expired purpose.
-- Source: content/events/2023/pqc-conference-amsterdam-nl/index.md
-- SHA256: f38c44c03622d5d9dc06b7d641e0628c816f7832450f37a4d7e3520b9ffeda8d
-- Original importer calendar dates: 2023-11-07 through 2023-11-08; calendar evidence remains authored.
UPDATE events
SET starts_at = '2023-11-07T07:30:00.000Z', ends_at = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE slug = 'pqc-conference-amsterdam-nl-2023'
  AND source_mode = 'hugo'
  AND timezone = 'Europe/Amsterdam'
  AND starts_at = '2023-11-07' AND ends_at = '2023-11-08';

-- Source: content/events/2025/pqc-conference-austin-us/index.md
-- SHA256: fa8b8bd508a53f2baa8625f0d3f0e9af93e5f0aacca0da79ef5ed04e001ffc19
-- Original importer calendar dates: 2025-01-15 through 2025-01-16; calendar evidence remains authored.
UPDATE events
SET starts_at = '2025-01-15T14:30:00.000Z', ends_at = '2025-01-17T00:00:00.000Z',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE slug = 'pqc-conference-austin-us-2025'
  AND source_mode = 'hugo'
  AND timezone = 'America/Chicago'
  AND starts_at = '2025-01-15' AND ends_at = '2025-01-16';

-- Source: content/events/2025/pqc-conference-kuala-lumpur-my/_index.md
-- SHA256: 57e182eadb0e1f620685143e3db4908a0809bd745ffbcbb9ca4e20ee277a0943
-- Original importer calendar dates: 2025-10-28 through 2025-10-30; calendar evidence remains authored.
UPDATE events
SET starts_at = '2025-10-28T00:30:00.000Z', ends_at = '2025-10-30T09:00:00.000Z',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE slug = 'pqc-conference-kuala-lumpur-my-2025'
  AND source_mode = 'hugo'
  AND timezone = 'Asia/Kuala_Lumpur'
  AND starts_at = '2025-10-28' AND ends_at = '2025-10-30';

-- Preserve historical event-calendar classification without inventing legacy context.
ALTER TABLE event_scan_attempts ADD COLUMN capture_day_date TEXT;
ALTER TABLE event_scan_attempts ADD COLUMN capture_time_zone TEXT;
ALTER TABLE event_scan_attempts ADD COLUMN capture_publication_revision INTEGER;
ALTER TABLE event_scan_attempts ADD COLUMN capture_context_source TEXT;
ALTER TABLE event_attendance_observations ADD COLUMN capture_day_date TEXT;
ALTER TABLE event_attendance_observations ADD COLUMN capture_time_zone TEXT;
ALTER TABLE event_attendance_observations ADD COLUMN capture_publication_revision INTEGER;
ALTER TABLE event_attendance_observations ADD COLUMN capture_context_source TEXT;
CREATE INDEX event_scan_attempts_capture_day ON event_scan_attempts(event_id,capture_day_date,occurrence_id,id);
CREATE INDEX event_attendance_observations_capture_day ON event_attendance_observations(event_id,capture_day_date,occurrence_id,id);
ALTER TABLE event_attendance_import_reviews ADD COLUMN capture_context_json TEXT;
ALTER TABLE event_attendance_import_reviews ADD COLUMN capture_context_hash TEXT;

-- Raw scanner evidence has a separate, explicit retention purpose. Contact
-- access expiry never authorizes removal of this evidence or global accounts.
CREATE TABLE event_evidence_retention_policies (
 event_id TEXT PRIMARY KEY REFERENCES events(id), revision INTEGER NOT NULL,
 evidence_until TEXT, purpose_code TEXT, legal_hold INTEGER NOT NULL DEFAULT 0,
 hold_reason_code TEXT, updated_by TEXT NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL
);
CREATE TABLE event_evidence_retention_state (
 event_id TEXT PRIMARY KEY REFERENCES events(id), generation INTEGER NOT NULL DEFAULT 0,
 active_run_id TEXT, capture_closed_at TEXT, purged_at TEXT
);
CREATE TABLE event_evidence_retention_policy_operations (
 operation_id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
 actor_user_id TEXT NOT NULL REFERENCES users(id), expected_revision INTEGER NOT NULL,
 resulting_revision INTEGER NOT NULL, request_json TEXT NOT NULL CHECK(json_valid(request_json)),
 created_at TEXT NOT NULL
);
CREATE INDEX event_evidence_retention_policy_history ON event_evidence_retention_policy_operations(event_id,resulting_revision);
CREATE TRIGGER event_evidence_retention_policy_operation_immutable BEFORE UPDATE ON event_evidence_retention_policy_operations
BEGIN SELECT RAISE(ABORT,'EVIDENCE_RETENTION_POLICY_OPERATION_IMMUTABLE'); END;

-- Enrollment precedes scanner preparation, including attendance/lead scanners
-- with no delegated admission quota. Stopping a camera does not close an epoch.
CREATE TABLE event_scanner_device_sessions (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
 operator_user_id TEXT NOT NULL REFERENCES users(id), device_id TEXT NOT NULL,
 enrollment_operation_id TEXT NOT NULL UNIQUE, opened_at TEXT NOT NULL,
 last_receipt_at TEXT, high_water_sequence INTEGER,
 closing_operation_id TEXT UNIQUE, closing_declared_at TEXT, closed_at TEXT
);
CREATE INDEX event_scanner_device_sessions_event_close ON event_scanner_device_sessions(event_id,closed_at,id);
CREATE INDEX event_scanner_device_sessions_owner ON event_scanner_device_sessions(event_id,operator_user_id,device_id);
ALTER TABLE event_offline_admission_grants ADD COLUMN scanner_epoch_id TEXT REFERENCES event_scanner_device_sessions(id);
CREATE INDEX event_offline_grants_scanner_epoch ON event_offline_admission_grants(scanner_epoch_id,closed_at);
CREATE TABLE event_scanner_upload_receipts (
 epoch_id TEXT NOT NULL REFERENCES event_scanner_device_sessions(id),
 sequence INTEGER NOT NULL CHECK(sequence>0), operation_id TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)),
 received_at TEXT NOT NULL, PRIMARY KEY(epoch_id,sequence)
);
-- Epoch closure is a domain conflict, distinct from revoked authorization.
CREATE TABLE event_scanner_upload_guards (
 id TEXT PRIMARY KEY, valid INTEGER NOT NULL CONSTRAINT scanner_upload_epoch_valid CHECK(valid=1)
);
CREATE TRIGGER event_scanner_upload_receipt_immutable BEFORE UPDATE ON event_scanner_upload_receipts
BEGIN SELECT RAISE(ABORT,'SCANNER_UPLOAD_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER event_scanner_upload_receipt_conflict BEFORE INSERT ON event_scanner_upload_receipts
WHEN EXISTS(SELECT 1 FROM event_scanner_upload_receipts receipt
 WHERE (receipt.epoch_id=NEW.epoch_id AND receipt.sequence=NEW.sequence) OR receipt.operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'SCANNER_RECEIPT_CONFLICT'); END;
CREATE TRIGGER event_scanner_device_session_identity BEFORE UPDATE OF id,event_id,operator_user_id,device_id,enrollment_operation_id,opened_at ON event_scanner_device_sessions
BEGIN SELECT RAISE(ABORT,'SCANNER_DEVICE_SESSION_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER event_scanner_device_session_closing_immutable BEFORE UPDATE ON event_scanner_device_sessions
WHEN OLD.high_water_sequence IS NOT NULL AND (
 NEW.high_water_sequence IS NOT OLD.high_water_sequence OR NEW.closing_operation_id IS NOT OLD.closing_operation_id
 OR NEW.closing_declared_at IS NOT OLD.closing_declared_at)
BEGIN SELECT RAISE(ABORT,'SCANNER_DEVICE_SESSION_CLOSING_IMMUTABLE'); END;
CREATE TRIGGER event_scanner_device_session_terminal BEFORE UPDATE ON event_scanner_device_sessions
WHEN OLD.closed_at IS NOT NULL AND NEW.closed_at IS NOT OLD.closed_at
BEGIN SELECT RAISE(ABORT,'SCANNER_DEVICE_SESSION_CLOSED'); END;
CREATE TRIGGER event_scanner_upload_receipt_open_epoch BEFORE INSERT ON event_scanner_upload_receipts
WHEN NOT EXISTS(SELECT 1 FROM event_scanner_device_sessions session
 WHERE session.id=NEW.epoch_id AND session.closed_at IS NULL
 AND (session.high_water_sequence IS NULL OR NEW.sequence<=session.high_water_sequence)
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_state retention
 WHERE retention.event_id=session.event_id AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'SCANNER_DEVICE_SESSION_CLOSED'); END;

-- Every identifying evidence chain advances the same reviewed source generation.
-- A terminal capture closure cannot be reopened by late offline writes, imports,
-- corrections or badge issuance. Reviewed destruction will add a run-bound
-- permit; no ordinary deletion can bypass an active retention fence.
CREATE TRIGGER evidence_capture_fence_event_scan_attempts_insert BEFORE INSERT ON event_scan_attempts
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_scan_attempts_insert AFTER INSERT ON event_scan_attempts
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_scan_attempts_update BEFORE UPDATE ON event_scan_attempts
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id OR retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_scan_attempts_update AFTER UPDATE ON event_scan_attempts
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id AND event_id IS NOT NEW.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_scan_attempts_delete BEFORE DELETE ON event_scan_attempts
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=OLD.event_id) AND permit.table_name='event_scan_attempts' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_scan_attempts_delete AFTER DELETE ON event_scan_attempts
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_observations_insert BEFORE INSERT ON event_attendance_observations
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_observations_insert AFTER INSERT ON event_attendance_observations
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_observations_update BEFORE UPDATE ON event_attendance_observations
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id OR retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_observations_update AFTER UPDATE ON event_attendance_observations
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id AND event_id IS NOT NEW.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_observations_delete BEFORE DELETE ON event_attendance_observations
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=OLD.event_id) AND permit.table_name='event_attendance_observations' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_observations_delete AFTER DELETE ON event_attendance_observations
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_corrections_insert BEFORE INSERT ON event_attendance_corrections
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_corrections_insert AFTER INSERT ON event_attendance_corrections
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_corrections_update BEFORE UPDATE ON event_attendance_corrections
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id OR retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_corrections_update AFTER UPDATE ON event_attendance_corrections
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id AND event_id IS NOT NEW.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_corrections_delete BEFORE DELETE ON event_attendance_corrections
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=OLD.event_id) AND permit.table_name='event_attendance_corrections' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_corrections_delete AFTER DELETE ON event_attendance_corrections
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_correction_state_insert BEFORE INSERT ON event_attendance_correction_state
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_attendance_observations WHERE id=NEW.observation_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_correction_state_insert AFTER INSERT ON event_attendance_correction_state
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES((SELECT event_id FROM event_attendance_observations WHERE id=NEW.observation_id),1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_correction_state_update BEFORE UPDATE ON event_attendance_correction_state
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_attendance_observations WHERE id=OLD.observation_id) OR retention.event_id=(SELECT event_id FROM event_attendance_observations WHERE id=NEW.observation_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_correction_state_update AFTER UPDATE ON event_attendance_correction_state
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES((SELECT event_id FROM event_attendance_observations WHERE id=NEW.observation_id),1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=(SELECT event_id FROM event_attendance_observations WHERE id=OLD.observation_id) AND event_id IS NOT (SELECT event_id FROM event_attendance_observations WHERE id=NEW.observation_id); END;
CREATE TRIGGER evidence_capture_fence_event_attendance_correction_state_delete BEFORE DELETE ON event_attendance_correction_state
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_attendance_observations WHERE id=OLD.observation_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=(SELECT event_id FROM event_attendance_observations WHERE id=OLD.observation_id)) AND permit.table_name='event_attendance_correction_state' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_correction_state_delete AFTER DELETE ON event_attendance_correction_state
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=(SELECT event_id FROM event_attendance_observations WHERE id=OLD.observation_id); END;
CREATE TRIGGER evidence_capture_fence_event_attendance_import_provenance_insert BEFORE INSERT ON event_attendance_import_provenance
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_import_provenance_insert AFTER INSERT ON event_attendance_import_provenance
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_import_provenance_update BEFORE UPDATE ON event_attendance_import_provenance
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id OR retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_import_provenance_update AFTER UPDATE ON event_attendance_import_provenance
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id AND event_id IS NOT NEW.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_import_provenance_delete BEFORE DELETE ON event_attendance_import_provenance
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=OLD.event_id) AND permit.table_name='event_attendance_import_provenance' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_import_provenance_delete AFTER DELETE ON event_attendance_import_provenance
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_imports_insert BEFORE INSERT ON event_attendance_imports
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_imports_insert AFTER INSERT ON event_attendance_imports
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_imports_update BEFORE UPDATE ON event_attendance_imports
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id OR retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_imports_update AFTER UPDATE ON event_attendance_imports
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id AND event_id IS NOT NEW.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_imports_delete BEFORE DELETE ON event_attendance_imports
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=OLD.event_id) AND permit.table_name='event_attendance_imports' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_imports_delete AFTER DELETE ON event_attendance_imports
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_import_reviews_insert BEFORE INSERT ON event_attendance_import_reviews
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_import_reviews_insert AFTER INSERT ON event_attendance_import_reviews
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_import_reviews_update BEFORE UPDATE ON event_attendance_import_reviews
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id OR retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_import_reviews_update AFTER UPDATE ON event_attendance_import_reviews
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id AND event_id IS NOT NEW.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_attendance_import_reviews_delete BEFORE DELETE ON event_attendance_import_reviews
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=OLD.event_id) AND permit.table_name='event_attendance_import_reviews' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_attendance_import_reviews_delete AFTER DELETE ON event_attendance_import_reviews
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_sponsor_leads_insert BEFORE INSERT ON event_sponsor_leads
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_sponsor_leads_insert AFTER INSERT ON event_sponsor_leads
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_sponsor_leads_update BEFORE UPDATE ON event_sponsor_leads
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id OR retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_sponsor_leads_update AFTER UPDATE ON event_sponsor_leads
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id AND event_id IS NOT NEW.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_sponsor_leads_delete BEFORE DELETE ON event_sponsor_leads
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=OLD.event_id) AND permit.table_name='event_sponsor_leads' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_sponsor_leads_delete AFTER DELETE ON event_sponsor_leads
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_offline_admission_grants_insert BEFORE INSERT ON event_offline_admission_grants
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_offline_admission_grants_insert AFTER INSERT ON event_offline_admission_grants
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_offline_admission_grants_update BEFORE UPDATE ON event_offline_admission_grants
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id OR retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_offline_admission_grants_update AFTER UPDATE ON event_offline_admission_grants
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id AND event_id IS NOT NEW.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_offline_admission_grants_delete BEFORE DELETE ON event_offline_admission_grants
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=OLD.event_id) AND permit.table_name='event_offline_admission_grants' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_offline_admission_grants_delete AFTER DELETE ON event_offline_admission_grants
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_offline_admission_entitlements_insert BEFORE INSERT ON event_offline_admission_entitlements
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_offline_admission_entitlements_insert AFTER INSERT ON event_offline_admission_entitlements
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES((SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id),1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_offline_admission_entitlements_update BEFORE UPDATE ON event_offline_admission_entitlements
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id) OR retention.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_offline_admission_entitlements_update AFTER UPDATE ON event_offline_admission_entitlements
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES((SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id),1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id) AND event_id IS NOT (SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id); END;
CREATE TRIGGER evidence_capture_fence_event_offline_admission_entitlements_delete BEFORE DELETE ON event_offline_admission_entitlements
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id)) AND permit.table_name='event_offline_admission_entitlements' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_offline_admission_entitlements_delete AFTER DELETE ON event_offline_admission_entitlements
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id); END;
CREATE TRIGGER evidence_capture_fence_event_offline_admission_access_insert BEFORE INSERT ON event_offline_admission_access
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_offline_admission_access_insert AFTER INSERT ON event_offline_admission_access
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES((SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id),1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_offline_admission_access_update BEFORE UPDATE ON event_offline_admission_access
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id) OR retention.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_offline_admission_access_update AFTER UPDATE ON event_offline_admission_access
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES((SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id),1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id) AND event_id IS NOT (SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id); END;
CREATE TRIGGER evidence_capture_fence_event_offline_admission_access_delete BEFORE DELETE ON event_offline_admission_access
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id)) AND permit.table_name='event_offline_admission_access' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_offline_admission_access_delete AFTER DELETE ON event_offline_admission_access
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id); END;
CREATE TRIGGER evidence_capture_fence_event_offline_admission_spends_insert BEFORE INSERT ON event_offline_admission_spends
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_offline_admission_spends_insert AFTER INSERT ON event_offline_admission_spends
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES((SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id),1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_offline_admission_spends_update BEFORE UPDATE ON event_offline_admission_spends
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id) OR retention.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_offline_admission_spends_update AFTER UPDATE ON event_offline_admission_spends
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES((SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id),1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id) AND event_id IS NOT (SELECT event_id FROM event_offline_admission_grants WHERE id=NEW.grant_id); END;
CREATE TRIGGER evidence_capture_fence_event_offline_admission_spends_delete BEFORE DELETE ON event_offline_admission_spends
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id)) AND permit.table_name='event_offline_admission_spends' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_offline_admission_spends_delete AFTER DELETE ON event_offline_admission_spends
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=(SELECT event_id FROM event_offline_admission_grants WHERE id=OLD.grant_id); END;
CREATE TRIGGER evidence_capture_fence_event_entry_admissions_insert BEFORE INSERT ON event_entry_admissions
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_entry_admissions_insert AFTER INSERT ON event_entry_admissions
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_entry_admissions_update BEFORE UPDATE ON event_entry_admissions
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id OR retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_entry_admissions_update AFTER UPDATE ON event_entry_admissions
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id AND event_id IS NOT NEW.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_entry_admissions_delete BEFORE DELETE ON event_entry_admissions
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=OLD.event_id) AND permit.table_name='event_entry_admissions' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_entry_admissions_delete AFTER DELETE ON event_entry_admissions
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_session_admissions_insert BEFORE INSERT ON event_session_admissions
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_session_admissions_insert AFTER INSERT ON event_session_admissions
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_session_admissions_update BEFORE UPDATE ON event_session_admissions
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id OR retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_session_admissions_update AFTER UPDATE ON event_session_admissions
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id AND event_id IS NOT NEW.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_session_admissions_delete BEFORE DELETE ON event_session_admissions
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=OLD.event_id) AND permit.table_name='event_session_admissions' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_session_admissions_delete AFTER DELETE ON event_session_admissions
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_badge_credentials_insert BEFORE INSERT ON event_badge_credentials
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_badge_credentials_insert AFTER INSERT ON event_badge_credentials
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_badge_credentials_update BEFORE UPDATE ON event_badge_credentials
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id OR retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_badge_credentials_update AFTER UPDATE ON event_badge_credentials
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id AND event_id IS NOT NEW.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_badge_credentials_delete BEFORE DELETE ON event_badge_credentials
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=OLD.event_id) AND permit.table_name='event_badge_credentials' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_badge_credentials_delete AFTER DELETE ON event_badge_credentials
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_scanner_device_sessions_insert BEFORE INSERT ON event_scanner_device_sessions
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_scanner_device_sessions_insert AFTER INSERT ON event_scanner_device_sessions
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_scanner_device_sessions_update BEFORE UPDATE ON event_scanner_device_sessions
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id OR retention.event_id=NEW.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_scanner_device_sessions_update AFTER UPDATE ON event_scanner_device_sessions
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES(NEW.event_id,1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id AND event_id IS NOT NEW.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_scanner_device_sessions_delete BEFORE DELETE ON event_scanner_device_sessions
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=OLD.event_id) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=OLD.event_id) AND permit.table_name='event_scanner_device_sessions' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_scanner_device_sessions_delete AFTER DELETE ON event_scanner_device_sessions
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=OLD.event_id; END;
CREATE TRIGGER evidence_capture_fence_event_scanner_upload_receipts_insert BEFORE INSERT ON event_scanner_upload_receipts
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_scanner_device_sessions WHERE id=NEW.epoch_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_scanner_upload_receipts_insert AFTER INSERT ON event_scanner_upload_receipts
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES((SELECT event_id FROM event_scanner_device_sessions WHERE id=NEW.epoch_id),1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; END;
CREATE TRIGGER evidence_capture_fence_event_scanner_upload_receipts_update BEFORE UPDATE ON event_scanner_upload_receipts
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_scanner_device_sessions WHERE id=OLD.epoch_id) OR retention.event_id=(SELECT event_id FROM event_scanner_device_sessions WHERE id=NEW.epoch_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_scanner_upload_receipts_update AFTER UPDATE ON event_scanner_upload_receipts
BEGIN INSERT INTO event_evidence_retention_state(event_id,generation) VALUES((SELECT event_id FROM event_scanner_device_sessions WHERE id=NEW.epoch_id),1) ON CONFLICT(event_id) DO UPDATE SET generation=generation+1; UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=(SELECT event_id FROM event_scanner_device_sessions WHERE id=OLD.epoch_id) AND event_id IS NOT (SELECT event_id FROM event_scanner_device_sessions WHERE id=NEW.epoch_id); END;
CREATE TRIGGER evidence_capture_fence_event_scanner_upload_receipts_delete BEFORE DELETE ON event_scanner_upload_receipts
WHEN EXISTS(SELECT 1 FROM event_evidence_retention_state retention WHERE (retention.event_id=(SELECT event_id FROM event_scanner_device_sessions WHERE id=OLD.epoch_id)) AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL)) AND NOT EXISTS(
 SELECT 1 FROM event_evidence_retention_delete_permits permit
 JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
 JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id AND guard_state.active_run_id=run.id
 WHERE (guard_state.event_id=(SELECT event_id FROM event_scanner_device_sessions WHERE id=OLD.epoch_id)) AND permit.table_name='event_scanner_upload_receipts' AND permit.row_id=OLD.rowid
 AND run.status='running' AND run.phase=permit.table_name
 AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_chunks consumed WHERE consumed.operation_id=permit.chunk_operation_id)
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER evidence_capture_generation_event_scanner_upload_receipts_delete AFTER DELETE ON event_scanner_upload_receipts
BEGIN UPDATE event_evidence_retention_state SET generation=generation+1 WHERE event_id=(SELECT event_id FROM event_scanner_device_sessions WHERE id=OLD.epoch_id); END;
CREATE TRIGGER event_evidence_capture_closure_terminal BEFORE UPDATE ON event_evidence_retention_state
WHEN OLD.capture_closed_at IS NOT NULL AND NEW.capture_closed_at IS NOT OLD.capture_closed_at
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
CREATE TRIGGER event_evidence_generation_monotonic BEFORE UPDATE ON event_evidence_retention_state
WHEN NEW.generation<OLD.generation
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_GENERATION_CHANGED'); END;

-- Only events created after enrollment enforcement gain complete device coverage.
-- Historical events intentionally receive no fabricated enrollment marker.
CREATE TABLE event_scanner_reconciliation_coverage (
 event_id TEXT PRIMARY KEY REFERENCES events(id), coverage_started_at TEXT NOT NULL
);
CREATE TRIGGER event_scanner_reconciliation_coverage_created AFTER INSERT ON events
BEGIN INSERT INTO event_scanner_reconciliation_coverage(event_id,coverage_started_at) VALUES(NEW.id,NEW.created_at); END;
CREATE INDEX event_scan_attempts_reconciliation ON event_scan_attempts(event_id,operation_id,operator_user_id,device_id);
CREATE INDEX event_offline_grants_reconciliation ON event_offline_admission_grants(event_id,closed_at);

-- Explicit reviewed raw evidence processing; no cutoff or destruction is inferred.
CREATE TABLE event_evidence_retention_reviews (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
 actor_user_id TEXT NOT NULL REFERENCES users(id), operation_id TEXT NOT NULL UNIQUE,
 review_hash TEXT NOT NULL, policy_revision INTEGER NOT NULL,
 source_generation INTEGER NOT NULL, publication_revision INTEGER,
 time_zone TEXT NOT NULL, counts_json TEXT NOT NULL CHECK(json_valid(counts_json)),
 reconciliation_json TEXT NOT NULL CHECK(json_valid(reconciliation_json)),
 reviewed_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX event_evidence_retention_reviews_event ON event_evidence_retention_reviews(event_id,reviewed_at,id);
CREATE INDEX event_evidence_retention_reviews_actor ON event_evidence_retention_reviews(actor_user_id);
CREATE TABLE event_evidence_retention_runs (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
 review_id TEXT NOT NULL UNIQUE REFERENCES event_evidence_retention_reviews(id),
 actor_user_id TEXT NOT NULL REFERENCES users(id), operation_id TEXT NOT NULL UNIQUE,
 policy_revision INTEGER NOT NULL, expected_generation INTEGER NOT NULL,
 publication_revision INTEGER, time_zone TEXT NOT NULL, status TEXT NOT NULL,
 phase TEXT NOT NULL, ordinal INTEGER NOT NULL DEFAULT 0,
 started_at TEXT NOT NULL, completed_at TEXT,
 reconciliation_json TEXT NOT NULL CHECK(json_valid(reconciliation_json))
);
CREATE INDEX event_evidence_retention_runs_event ON event_evidence_retention_runs(event_id,status,started_at,id);
CREATE INDEX event_evidence_retention_runs_actor ON event_evidence_retention_runs(actor_user_id);
CREATE TABLE event_evidence_retention_progress (
 run_id TEXT PRIMARY KEY REFERENCES event_evidence_retention_runs(id),
 cursor_key TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE event_evidence_retention_grains (
 run_id TEXT NOT NULL REFERENCES event_evidence_retention_runs(id),
 scope_key TEXT NOT NULL, summary_json TEXT NOT NULL CHECK(json_valid(summary_json)),
 PRIMARY KEY(run_id,scope_key)
);
CREATE TABLE event_evidence_retention_reasons (
 run_id TEXT NOT NULL REFERENCES event_evidence_retention_runs(id),
 scope_key TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL,
 reason TEXT NOT NULL, count INTEGER NOT NULL,
 PRIMARY KEY(run_id,scope_key,action,outcome,reason)
);
CREATE TABLE event_evidence_retention_sponsors (
 run_id TEXT NOT NULL REFERENCES event_evidence_retention_runs(id),
 sponsor_id TEXT NOT NULL, lead_count INTEGER NOT NULL,
 PRIMARY KEY(run_id,sponsor_id)
);
CREATE TABLE event_evidence_retention_chunks (
 run_id TEXT NOT NULL REFERENCES event_evidence_retention_runs(id),
 ordinal INTEGER NOT NULL, operation_id TEXT NOT NULL UNIQUE,
 actor_user_id TEXT NOT NULL REFERENCES users(id), phase TEXT NOT NULL,
 source_generation_before INTEGER NOT NULL, source_generation_after INTEGER NOT NULL,
 row_count INTEGER NOT NULL, committed_at TEXT NOT NULL,
 PRIMARY KEY(run_id,ordinal)
);
CREATE INDEX event_evidence_retention_chunks_actor ON event_evidence_retention_chunks(actor_user_id);
-- Identifying row cursors exist only inside a single guarded destructive batch.
-- They are removed before commit, and never copied into chunk receipts or audit.
CREATE TABLE event_evidence_retention_delete_permits (
 event_id TEXT NOT NULL REFERENCES events(id),
 run_id TEXT NOT NULL REFERENCES event_evidence_retention_runs(id),
 chunk_operation_id TEXT NOT NULL, table_name TEXT NOT NULL, row_id INTEGER NOT NULL,
 PRIMARY KEY(run_id,table_name,row_id)
);
CREATE INDEX event_evidence_retention_delete_permits_event ON event_evidence_retention_delete_permits(event_id);
CREATE TRIGGER event_evidence_retention_review_immutable BEFORE UPDATE ON event_evidence_retention_reviews
BEGIN SELECT RAISE(ABORT,'EVIDENCE_RETENTION_REVIEW_IMMUTABLE'); END;
CREATE TRIGGER event_evidence_retention_grain_immutable BEFORE UPDATE ON event_evidence_retention_grains
BEGIN SELECT RAISE(ABORT,'EVIDENCE_RETENTION_GRAIN_IMMUTABLE'); END;
CREATE TRIGGER event_evidence_retention_reason_immutable BEFORE UPDATE ON event_evidence_retention_reasons
BEGIN SELECT RAISE(ABORT,'EVIDENCE_RETENTION_REASON_IMMUTABLE'); END;
CREATE TRIGGER event_evidence_retention_sponsor_immutable BEFORE UPDATE ON event_evidence_retention_sponsors
BEGIN SELECT RAISE(ABORT,'EVIDENCE_RETENTION_SPONSOR_IMMUTABLE'); END;
CREATE TRIGGER event_evidence_retention_chunk_immutable BEFORE UPDATE ON event_evidence_retention_chunks
BEGIN SELECT RAISE(ABORT,'EVIDENCE_RETENTION_CHUNK_IMMUTABLE'); END;

-- Renewal review binding is normalized separately to avoid review/run FK cycles.
CREATE TABLE event_evidence_retention_review_runs (
 review_id TEXT PRIMARY KEY REFERENCES event_evidence_retention_reviews(id),
 run_id TEXT NOT NULL REFERENCES event_evidence_retention_runs(id)
);
CREATE INDEX event_evidence_retention_review_runs_run ON event_evidence_retention_review_runs(run_id);
CREATE TABLE event_evidence_retention_resumptions (
 operation_id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES event_evidence_retention_runs(id),
 review_id TEXT NOT NULL REFERENCES event_evidence_retention_reviews(id),
 actor_user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX event_evidence_retention_resumptions_run ON event_evidence_retention_resumptions(run_id,created_at);
CREATE INDEX event_evidence_retention_resumptions_review ON event_evidence_retention_resumptions(review_id);
CREATE INDEX event_evidence_retention_resumptions_actor ON event_evidence_retention_resumptions(actor_user_id);
CREATE TRIGGER event_evidence_retention_review_run_immutable BEFORE UPDATE ON event_evidence_retention_review_runs
BEGIN SELECT RAISE(ABORT,'EVIDENCE_RETENTION_REVIEW_RUN_IMMUTABLE'); END;
CREATE TRIGGER event_evidence_retention_resumption_immutable BEFORE UPDATE ON event_evidence_retention_resumptions
BEGIN SELECT RAISE(ABORT,'EVIDENCE_RETENTION_RESUMPTION_IMMUTABLE'); END;
CREATE TRIGGER event_evidence_retention_reconciliation_immutable BEFORE UPDATE OF reconciliation_json ON event_evidence_retention_runs
WHEN NEW.reconciliation_json IS NOT OLD.reconciliation_json
BEGIN SELECT RAISE(ABORT,'EVIDENCE_RETENTION_RECONCILIATION_IMMUTABLE'); END;

-- Direct session documents do not fabricate accepted proposals.
CREATE UNIQUE INDEX event_agenda_occurrences_event_identity ON event_agenda_occurrences(event_id,id);
CREATE TABLE session_presentation_versions (
  id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number>0),r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,file_size INTEGER NOT NULL CHECK(file_size>0),mime_type TEXT NOT NULL,source_key TEXT,source_digest TEXT NOT NULL,
  uploaded_by_user_id TEXT NOT NULL REFERENCES users(id),uploaded_at TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN(0,1)),deleted_at TEXT,
  UNIQUE(occurrence_id,version_number),
  FOREIGN KEY(event_id,occurrence_id) REFERENCES event_agenda_occurrences(event_id,id)
);
CREATE UNIQUE INDEX session_presentation_current ON session_presentation_versions(occurrence_id) WHERE is_current=1 AND deleted_at IS NULL;
CREATE UNIQUE INDEX session_presentation_source ON session_presentation_versions(occurrence_id,source_key,source_digest) WHERE source_key IS NOT NULL;
CREATE INDEX session_presentation_list ON session_presentation_versions(event_id,occurrence_id,deleted_at,version_number,id);
CREATE TABLE session_presentation_reviews (
  id TEXT PRIMARY KEY,version_id TEXT NOT NULL REFERENCES session_presentation_versions(id),
  reviewed_by_user_id TEXT NOT NULL REFERENCES users(id),reviewed_at TEXT NOT NULL,status TEXT NOT NULL,note TEXT
);
CREATE INDEX session_presentation_review_latest ON session_presentation_reviews(version_id,reviewed_at DESC,id DESC);
CREATE TRIGGER session_presentation_reviews_immutable BEFORE UPDATE ON session_presentation_reviews
BEGIN SELECT RAISE(ABORT,'SESSION_PRESENTATION_REVIEW_IMMUTABLE'); END;
CREATE TABLE session_presentation_write_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CONSTRAINT session_presentation_write_valid CHECK(valid=1));

-- An immutable document selection joins the existing activated build receipt.
-- R2 remains private; no independent document activation or approval workflow exists.
CREATE UNIQUE INDEX session_presentation_version_owner ON session_presentation_versions(event_id,occurrence_id,id);
CREATE TABLE site_publication_document_manifests (
 build_id TEXT NOT NULL,
 snapshot_id TEXT NOT NULL,
 event_id TEXT NOT NULL REFERENCES events(id),
 occurrence_id TEXT NOT NULL,
 material_id TEXT NOT NULL,
 version_id TEXT NOT NULL REFERENCES session_presentation_versions(id),
 digest TEXT NOT NULL,
 object_etag TEXT NOT NULL,
 grant_id TEXT,
 legacy_download_json TEXT,
 repair_aliases_json TEXT,
 PRIMARY KEY(build_id,event_id,occurrence_id,material_id),
 FOREIGN KEY(event_id,occurrence_id,version_id) REFERENCES session_presentation_versions(event_id,occurrence_id,id),
 FOREIGN KEY(event_id,occurrence_id) REFERENCES event_agenda_occurrences(event_id,id)
);
CREATE INDEX site_publication_document_lookup ON site_publication_document_manifests(build_id,occurrence_id,version_id,digest);
CREATE TRIGGER site_publication_document_manifest_immutable BEFORE UPDATE ON site_publication_document_manifests
BEGIN SELECT RAISE(ABORT,'PUBLICATION_DOCUMENT_MANIFEST_IMMUTABLE'); END;
CREATE TRIGGER site_publication_document_manifest_conflict BEFORE INSERT ON site_publication_document_manifests
WHEN EXISTS(SELECT 1 FROM site_publication_document_manifests old WHERE old.build_id=NEW.build_id AND old.event_id=NEW.event_id AND old.occurrence_id=NEW.occurrence_id AND old.material_id=NEW.material_id AND (old.snapshot_id<>NEW.snapshot_id OR old.version_id<>NEW.version_id OR old.digest<>NEW.digest OR old.object_etag<>NEW.object_etag OR old.grant_id IS NOT NEW.grant_id OR old.legacy_download_json IS NOT NEW.legacy_download_json OR old.repair_aliases_json IS NOT NEW.repair_aliases_json))
BEGIN SELECT RAISE(ABORT,'PUBLICATION_DOCUMENT_MANIFEST_CONFLICT'); END;

-- Recipient session calendar reply evidence; original receipts are append-only.
CREATE TABLE agenda_session_rsvp_receipts (
 id TEXT PRIMARY KEY, invitation_id TEXT NOT NULL, event_id TEXT NOT NULL REFERENCES events(id),
 occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id), user_id TEXT NOT NULL REFERENCES users(id),
 provider TEXT NOT NULL, source_message_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 decision_revision INTEGER NOT NULL, response_status TEXT NOT NULL, disposition TEXT NOT NULL, received_at TEXT NOT NULL,
 claimed_reply_at TEXT, invitation_sequence INTEGER, participation_status TEXT,
 created_at TEXT NOT NULL, UNIQUE(invitation_id,provider,source_message_id), UNIQUE(invitation_id,decision_revision)
);
CREATE INDEX agenda_session_rsvp_receipts_target ON agenda_session_rsvp_receipts(invitation_id,decision_revision);

-- Retain the original verified affiliation domain without claiming ownership of that domain.
ALTER TABLE identities ADD COLUMN verified_email_domain TEXT;
CREATE INDEX identities_verified_email_domain ON identities(verified_email_domain,organization_id);
CREATE TRIGGER identity_verified_email_domain_immutable BEFORE UPDATE OF verified_email_domain,organization_id,user_id,source ON identities
WHEN NEW.verified_email_domain IS NOT OLD.verified_email_domain
 OR (OLD.verified_email_domain IS NOT NULL AND (NEW.organization_id IS NOT OLD.organization_id OR NEW.user_id IS NOT OLD.user_id OR NEW.source IS NOT OLD.source))
BEGIN SELECT RAISE(ABORT,'IDENTITY_VERIFIED_EMAIL_DOMAIN_IMMUTABLE'); END;

-- Withdrawal preserves the original attendee acceptance and its evidence.
ALTER TABLE consent_acceptances ADD COLUMN withdrawn_at TEXT;
CREATE TRIGGER consent_acceptance_withdrawal_insert BEFORE INSERT ON consent_acceptances
WHEN NEW.withdrawn_at IS NOT NULL AND NOT (
 NEW.registration_id IS NOT NULL AND NEW.proposal_id IS NULL
 AND NEW.audience_type='attendee' AND NEW.term_key='sponsor-data-sharing'
 AND EXISTS(SELECT 1 FROM registrations registration WHERE registration.id=NEW.registration_id
  AND registration.event_id=NEW.event_id AND registration.user_id=NEW.user_id)
 AND length(NEW.withdrawn_at)=24
 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.withdrawn_at) IS NOT NULL
 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.withdrawn_at)=NEW.withdrawn_at
 AND julianday(NEW.accepted_at) IS NOT NULL
 AND julianday(NEW.withdrawn_at)>=julianday(NEW.accepted_at)
)
BEGIN SELECT RAISE(ABORT,'CONSENT_WITHDRAWAL_INVALID'); END;
CREATE TRIGGER consent_acceptance_withdrawal_update BEFORE UPDATE OF withdrawn_at ON consent_acceptances
WHEN (OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS NOT OLD.withdrawn_at)
 OR (NEW.withdrawn_at IS NOT NULL AND NOT (
 NEW.registration_id IS NOT NULL AND NEW.proposal_id IS NULL
 AND NEW.audience_type='attendee' AND NEW.term_key='sponsor-data-sharing'
 AND EXISTS(SELECT 1 FROM registrations registration WHERE registration.id=NEW.registration_id
  AND registration.event_id=NEW.event_id AND registration.user_id=NEW.user_id)
 AND length(NEW.withdrawn_at)=24
 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.withdrawn_at) IS NOT NULL
 AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.withdrawn_at)=NEW.withdrawn_at
 AND julianday(NEW.accepted_at) IS NOT NULL
 AND julianday(NEW.withdrawn_at)>=julianday(NEW.accepted_at)
))
BEGIN SELECT RAISE(ABORT,'CONSENT_WITHDRAWAL_INVALID'); END;
CREATE TRIGGER consent_acceptance_withdrawal_evidence BEFORE UPDATE ON consent_acceptances
WHEN (OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NOT NULL) AND (
 NEW.id IS NOT OLD.id OR NEW.registration_id IS NOT OLD.registration_id
 OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.event_id IS NOT OLD.event_id
 OR NEW.user_id IS NOT OLD.user_id OR NEW.audience_type IS NOT OLD.audience_type
 OR NEW.term_key IS NOT OLD.term_key OR NEW.term_version IS NOT OLD.term_version
 OR NEW.accepted_at IS NOT OLD.accepted_at OR NEW.ip_hash IS NOT OLD.ip_hash
 OR NEW.user_agent_hash IS NOT OLD.user_agent_hash
)
BEGIN SELECT RAISE(ABORT,'CONSENT_WITHDRAWAL_EVIDENCE_IMMUTABLE'); END;

-- Record only the scanner decision made for this attempt; existing evidence stays unknown.
ALTER TABLE event_scan_attempts ADD COLUMN admission_decision TEXT;

-- Canonical recording sources, private acquisition receipts and immutable owned versions.
CREATE UNIQUE INDEX event_series_event_identity ON event_series(event_id,id);

CREATE TABLE event_recording_meetings (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  native_series_id TEXT,
  native_occurrence_id TEXT,
  provider_type TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  provider_app_id TEXT NOT NULL,
  provider_meeting_id TEXT NOT NULL,
  title TEXT NOT NULL,
  linked_by_user_id TEXT NOT NULL REFERENCES users(id),
  linked_at TEXT NOT NULL,
  UNIQUE(event_id,id),
  CHECK((native_series_id IS NULL)=(native_occurrence_id IS NULL)),
  FOREIGN KEY(event_id,native_series_id) REFERENCES event_series(event_id,id),
  FOREIGN KEY(native_occurrence_id,native_series_id) REFERENCES event_occurrences(id,series_id)
);
CREATE UNIQUE INDEX event_recording_meetings_scope ON event_recording_meetings(event_id,provider_account_id,provider_app_id,provider_meeting_id,COALESCE(native_occurrence_id,''));
CREATE INDEX event_recording_meetings_catalog ON event_recording_meetings(event_id,linked_at,id);
CREATE TRIGGER event_recording_meeting_immutable BEFORE UPDATE ON event_recording_meetings
BEGIN SELECT RAISE(ABORT,'RECORDING_MEETING_IMMUTABLE'); END;

CREATE TABLE event_recording_sources (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  meeting_link_id TEXT NOT NULL,
  native_series_id TEXT,
  native_occurrence_id TEXT,
  provider_type TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  provider_app_id TEXT NOT NULL,
  provider_meeting_id TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  provider_recording_id TEXT NOT NULL,
  provider_status TEXT NOT NULL,
  provider_invoked_at TEXT NOT NULL,
  provider_started_at TEXT NOT NULL,
  provider_stopped_at TEXT,
  provider_file_size INTEGER NOT NULL CHECK(provider_file_size>=0),
  metadata_revision INTEGER NOT NULL DEFAULT 1 CHECK(metadata_revision>0),
  observed_at TEXT NOT NULL,
  disabled_at TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id,id),
  UNIQUE(provider_type,provider_account_id,provider_app_id,provider_recording_id),
  CHECK((native_series_id IS NULL)=(native_occurrence_id IS NULL)),
  FOREIGN KEY(event_id,meeting_link_id) REFERENCES event_recording_meetings(event_id,id),
  FOREIGN KEY(event_id,native_series_id) REFERENCES event_series(event_id,id),
  FOREIGN KEY(native_occurrence_id,native_series_id) REFERENCES event_occurrences(id,series_id)
);
CREATE INDEX event_recording_sources_catalog ON event_recording_sources(event_id,disabled_at,provider_invoked_at,id);
CREATE INDEX event_recording_sources_native ON event_recording_sources(native_series_id,native_occurrence_id,id);
CREATE INDEX event_recording_sources_author ON event_recording_sources(created_by_user_id,id);
CREATE TRIGGER event_recording_source_scope_immutable BEFORE UPDATE ON event_recording_sources
WHEN NEW.id IS NOT OLD.id OR NEW.event_id IS NOT OLD.event_id
 OR NEW.meeting_link_id IS NOT OLD.meeting_link_id
 OR NEW.native_series_id IS NOT OLD.native_series_id OR NEW.native_occurrence_id IS NOT OLD.native_occurrence_id
 OR NEW.provider_type IS NOT OLD.provider_type OR NEW.provider_account_id IS NOT OLD.provider_account_id
 OR NEW.provider_app_id IS NOT OLD.provider_app_id OR NEW.provider_meeting_id IS NOT OLD.provider_meeting_id
 OR NEW.provider_session_id IS NOT OLD.provider_session_id OR NEW.provider_recording_id IS NOT OLD.provider_recording_id
 OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'RECORDING_SOURCE_SCOPE_IMMUTABLE'); END;

CREATE TABLE event_recording_acquisitions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  source_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  expected_metadata_revision INTEGER NOT NULL CHECK(expected_metadata_revision>0),
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_attempt_at TEXT NOT NULL,
  processing_token TEXT,
  claimed_at TEXT,
  lease_expires_at TEXT,
  last_failure_kind TEXT,
  last_provider_status INTEGER,
  transfer_version_id TEXT,
  transfer_upload_id TEXT,
  transfer_part_bytes INTEGER CHECK(transfer_part_bytes IS NULL OR transfer_part_bytes>0),
  transfer_total_bytes INTEGER CHECK(transfer_total_bytes IS NULL OR transfer_total_bytes>0),
  transfer_source_etag TEXT,
  transfer_r2_key TEXT,
  verification_object_etag TEXT,
  verification_offset INTEGER NOT NULL DEFAULT 0 CHECK(verification_offset>=0),
  verification_checkpoint TEXT CHECK(verification_checkpoint IS NULL OR json_valid(verification_checkpoint)),
  verified_digest TEXT,
  verified_mime_type TEXT,
  completed_version_id TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id,operation_id),
  UNIQUE(event_id,source_id,id),
  CHECK((processing_token IS NULL)=(claimed_at IS NULL)),
  CHECK((processing_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK(lease_expires_at IS NULL OR lease_expires_at>claimed_at),
  CHECK((completed_version_id IS NULL)=(completed_at IS NULL)),
  CHECK((transfer_version_id IS NULL)=(transfer_upload_id IS NULL)),
  CHECK((transfer_upload_id IS NULL)=(transfer_part_bytes IS NULL)),
  CHECK((transfer_upload_id IS NULL)=(transfer_total_bytes IS NULL)),
  CHECK((transfer_upload_id IS NULL)=(transfer_source_etag IS NULL)),
  CHECK((transfer_upload_id IS NULL)=(transfer_r2_key IS NULL)),
  CHECK(verification_object_etag IS NULL OR transfer_r2_key IS NOT NULL),
  CHECK((transfer_total_bytes IS NULL AND verification_offset=0)
    OR verification_offset<=transfer_total_bytes),
  CHECK(verification_checkpoint IS NULL OR (verification_object_etag IS NOT NULL AND verification_offset>0)),
  CHECK(verification_offset=0 OR verification_checkpoint IS NOT NULL OR verified_digest IS NOT NULL),
  CHECK((verified_digest IS NULL)=(verified_mime_type IS NULL)),
  CHECK(verified_digest IS NULL OR (verification_offset=transfer_total_bytes
    AND verification_object_etag IS NOT NULL AND verification_checkpoint IS NULL)),
  FOREIGN KEY(event_id,source_id) REFERENCES event_recording_sources(event_id,id),
  FOREIGN KEY(event_id,source_id,completed_version_id) REFERENCES event_recording_versions(event_id,source_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX event_recording_acquisitions_due ON event_recording_acquisitions(status,next_attempt_at,created_at,id);
CREATE INDEX event_recording_acquisitions_lease ON event_recording_acquisitions(lease_expires_at,id) WHERE processing_token IS NOT NULL;
CREATE INDEX event_recording_acquisitions_source ON event_recording_acquisitions(event_id,source_id,created_at,id);
CREATE INDEX event_recording_acquisitions_actor ON event_recording_acquisitions(requested_by_user_id,id);
CREATE INDEX event_recording_acquisitions_version ON event_recording_acquisitions(event_id,source_id,completed_version_id);
CREATE TRIGGER event_recording_acquisition_request_immutable BEFORE UPDATE ON event_recording_acquisitions
WHEN NEW.id IS NOT OLD.id OR NEW.event_id IS NOT OLD.event_id OR NEW.source_id IS NOT OLD.source_id
 OR NEW.operation_id IS NOT OLD.operation_id OR NEW.payload_hash IS NOT OLD.payload_hash
 OR NEW.expected_metadata_revision IS NOT OLD.expected_metadata_revision
 OR NEW.requested_by_user_id IS NOT OLD.requested_by_user_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'RECORDING_ACQUISITION_REQUEST_IMMUTABLE'); END;
CREATE TRIGGER event_recording_acquisition_result_immutable BEFORE UPDATE ON event_recording_acquisitions
WHEN OLD.completed_version_id IS NOT NULL AND
 (NEW.completed_version_id IS NOT OLD.completed_version_id OR NEW.completed_at IS NOT OLD.completed_at)
BEGIN SELECT RAISE(ABORT,'RECORDING_ACQUISITION_RESULT_IMMUTABLE'); END;

CREATE TABLE event_recording_versions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  source_id TEXT NOT NULL,
  acquisition_id TEXT NOT NULL UNIQUE,
  version_number INTEGER NOT NULL CHECK(version_number>0),
  source_metadata_revision INTEGER NOT NULL CHECK(source_metadata_revision>0),
  r2_key TEXT NOT NULL UNIQUE,
  digest TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK(file_size>0),
  mime_type TEXT NOT NULL,
  object_etag TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(event_id,source_id,id),
  UNIQUE(event_id,id),
  UNIQUE(source_id,version_number),
  FOREIGN KEY(event_id,source_id) REFERENCES event_recording_sources(event_id,id),
  FOREIGN KEY(event_id,source_id,acquisition_id) REFERENCES event_recording_acquisitions(event_id,source_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX event_recording_versions_live_digest ON event_recording_versions(source_id,digest) WHERE deleted_at IS NULL;
CREATE INDEX event_recording_versions_catalog ON event_recording_versions(event_id,deleted_at,acquired_at,id);
CREATE TRIGGER event_recording_version_bytes_immutable BEFORE UPDATE ON event_recording_versions
WHEN NEW.id IS NOT OLD.id OR NEW.event_id IS NOT OLD.event_id OR NEW.source_id IS NOT OLD.source_id
 OR NEW.acquisition_id IS NOT OLD.acquisition_id OR NEW.version_number IS NOT OLD.version_number
 OR NEW.source_metadata_revision IS NOT OLD.source_metadata_revision OR NEW.r2_key IS NOT OLD.r2_key
 OR NEW.digest IS NOT OLD.digest OR NEW.file_size IS NOT OLD.file_size OR NEW.mime_type IS NOT OLD.mime_type
 OR NEW.object_etag IS NOT OLD.object_etag OR NEW.acquired_at IS NOT OLD.acquired_at
BEGIN SELECT RAISE(ABORT,'RECORDING_VERSION_BYTES_IMMUTABLE'); END;
CREATE TRIGGER event_recording_version_deletion_immutable BEFORE UPDATE OF deleted_at ON event_recording_versions
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT OLD.deleted_at
BEGIN SELECT RAISE(ABORT,'RECORDING_VERSION_DELETION_IMMUTABLE'); END;


-- Immutable multipart receipts belong to one exact owned acquisition and upload.
CREATE TABLE event_recording_parts (
  event_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  acquisition_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  part_number INTEGER NOT NULL CHECK(part_number>0),
  etag TEXT NOT NULL,
  byte_offset INTEGER NOT NULL CHECK(byte_offset>=0),
  byte_length INTEGER NOT NULL CHECK(byte_length>0),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(acquisition_id,upload_id,part_number),
  FOREIGN KEY(event_id,source_id,acquisition_id) REFERENCES event_recording_acquisitions(event_id,source_id,id)
);
CREATE INDEX event_recording_parts_owner ON event_recording_parts(event_id,source_id,acquisition_id,upload_id,part_number);
CREATE TRIGGER event_recording_part_immutable BEFORE UPDATE ON event_recording_parts
BEGIN SELECT RAISE(ABORT,'RECORDING_ACQUISITION_PART_IMMUTABLE'); END;

-- Recording selections use the existing publication build and grant authority.
-- Owned versions retain MIME and byte evidence; the manifest freezes selection only.
CREATE TABLE site_publication_recording_manifests (
  build_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  occurrence_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  object_etag TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  PRIMARY KEY(build_id,event_id,occurrence_id,material_id),
  FOREIGN KEY(event_id,version_id) REFERENCES event_recording_versions(event_id,id),
  FOREIGN KEY(event_id,occurrence_id) REFERENCES event_agenda_occurrences(event_id,id)
);
CREATE INDEX site_publication_recording_lookup ON site_publication_recording_manifests(build_id,occurrence_id,version_id,digest);
CREATE TRIGGER site_publication_recording_manifest_immutable BEFORE UPDATE ON site_publication_recording_manifests
BEGIN SELECT RAISE(ABORT,'PUBLICATION_RECORDING_MANIFEST_IMMUTABLE'); END;
CREATE TRIGGER site_publication_recording_manifest_conflict BEFORE INSERT ON site_publication_recording_manifests
WHEN EXISTS(SELECT 1 FROM site_publication_recording_manifests old WHERE old.build_id=NEW.build_id AND old.event_id=NEW.event_id AND old.occurrence_id=NEW.occurrence_id AND old.material_id=NEW.material_id AND (old.snapshot_id<>NEW.snapshot_id OR old.version_id<>NEW.version_id OR old.digest<>NEW.digest OR old.object_etag<>NEW.object_etag OR old.grant_id<>NEW.grant_id))
BEGIN SELECT RAISE(ABORT,'PUBLICATION_RECORDING_MANIFEST_CONFLICT'); END;


-- Revision conflicts have their own domain guard, independent of permission refusal.
CREATE TABLE event_agenda_revision_guards (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  expected_revision INTEGER NOT NULL CHECK(expected_revision>=0)
);
CREATE TRIGGER event_agenda_revision_guard_valid BEFORE INSERT ON event_agenda_revision_guards
WHEN NOT EXISTS(SELECT 1 FROM event_agenda_state WHERE event_id=NEW.event_id AND revision=NEW.expected_revision)
BEGIN SELECT RAISE(ABORT,'AGENDA_REVISION_CHANGED'); END;
CREATE TRIGGER event_agenda_revision_guard_cleanup AFTER INSERT ON event_agenda_revision_guards
BEGIN DELETE FROM event_agenda_revision_guards WHERE id=NEW.id; END;

-- Acquisition owns retry state; this scheduler only advances bounded due work.
INSERT INTO scheduled_jobs(job_key,interval_seconds,next_run_at)
VALUES('recording_acquisitions',60,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
-- ── Identities own organization and job title ────────────────────────────
-- A person's organization and job title live on their identities and nowhere
-- else. The free-text copies on users, registrations and proposal speaker
-- overrides are carried forward and removed, in this order:
--   1. mapping and review tables that keep what cannot become an identity;
--   2. an identity for every person: the organization their verified work
--      email domain belongs to, when the shared rule joins it automatically,
--      otherwise an individual identity;
--   3. proposal speaker organization/title overrides removed;
--   4. audit rows attributed to the identity their actor held, which only
--      works once step 2 has created the missing identities;
--   5. the legacy columns dropped.
-- What a profile wrote never decides an organization: names compare only to
-- tell whether an identity a person already holds represents their text
-- (exactly, on organizations.normalized_name; assets/shared/organization-name.ts).
-- No organization is created here. Every change made here is written to the
-- audit log as a system entry.

-- Step 1a. A job title held without an organization. The identities CHECK
-- keeps titles on organization identities, so a person who speaks for no
-- organization keeps theirs here, read through the same affiliation
-- projection as an identity's title.
CREATE TABLE individual_job_titles (
  user_id    TEXT NOT NULL PRIMARY KEY REFERENCES users(id),
  job_title  TEXT NOT NULL CHECK (length(trim(job_title)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Step 1b. An organization name or title that matched no identity. Nothing is
-- dropped: it stays for staff, grouped by the name as written (group_key is
-- its normalized spelling; a title-only row groups by its person), with the
-- person's work domain when they had one. A review closes when its person
-- joins an organization or says they are independent; staff may dismiss a
-- group. source_type names where the text came from (user_profile or
-- proposal_speaker) and source_id the row it came from; no CHECK freezes that
-- vocabulary.
CREATE TABLE affiliation_reviews (
  id                   TEXT NOT NULL PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id),
  organization_name    TEXT,
  normalized_name      TEXT,
  job_title            TEXT,
  email_domain         TEXT,
  group_key            TEXT NOT NULL,
  source_type          TEXT NOT NULL,
  source_id            TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  resolved_identity_id TEXT REFERENCES identities(id),
  resolved_by_user_id  TEXT REFERENCES users(id),
  resolved_at          TEXT,
  UNIQUE(source_type, source_id),
  CHECK (organization_name IS NOT NULL OR job_title IS NOT NULL),
  CHECK ((resolved_at IS NULL) = (resolved_by_user_id IS NULL)),
  CHECK (resolved_identity_id IS NULL OR resolved_at IS NOT NULL)
);
CREATE INDEX affiliation_reviews_queue ON affiliation_reviews(resolved_at, created_at, id);
CREATE INDEX affiliation_reviews_group ON affiliation_reviews(group_key, resolved_at);
CREATE INDEX affiliation_reviews_user ON affiliation_reviews(user_id, created_at, id);

-- Step 1c. A person's answer to the organization question the portal asks:
-- organization_id names an organization their verified address belongs to
-- that they said is not theirs, so it is neither offered nor joined
-- automatically again; NULL records that they are independent, which stops
-- the request for a work address.
CREATE TABLE affiliation_offer_dismissals (
  id              TEXT NOT NULL PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT REFERENCES organizations(id),
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX affiliation_offer_dismissals_organization
  ON affiliation_offer_dismissals(user_id, organization_id) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX affiliation_offer_dismissals_independent
  ON affiliation_offer_dismissals(user_id) WHERE organization_id IS NULL;
CREATE INDEX affiliation_offer_dismissals_by_organization
  ON affiliation_offer_dismissals(organization_id) WHERE organization_id IS NOT NULL;

-- Step 2a. The shared domain rule (assets/shared/organization-domain.ts), as
-- runtime applies it when an address is verified. Free, consumer, ISP and
-- disposable domains say nothing about an employer, so an address there is
-- always independent; so is one on a subdomain of such a provider. The
-- free-domain rows below are the Worker's vendored lists after local overrides
-- (functions/_lib/email-domains), and tests hold this text and its outcomes to
-- them. An address links through the most specific claim covering its host
-- (mail.example.com follows a claim on example.com); a domain a pending
-- membership application holds is no one's yet. Without a claim the runtime
-- links through the registrable domain, which needs the Public Suffix List;
-- this backfill keys such an address by its host instead, so a subdomain
-- address without a claim is left for review rather than linked. Everyone not
-- redacted or merged who holds no active organization identity takes part.
-- Their work domain is a claimed one first, then their primary address's,
-- then another verified address's.
CREATE TABLE affiliation_free_email_domains (domain TEXT NOT NULL PRIMARY KEY);
INSERT INTO affiliation_free_email_domains (domain) SELECT value FROM json_each('["0-mail.com","0-mailer.dynv6.net","000-webmail.myhome-server.de","000000000000000.theworkpc.com","000000000000000000.dynv6.net","000webmail.ddnss.de","000webmail.ddnss.org","000webmail.dyn-ip24.de","000webmail.dyn.ddnss.de","000webmail.dyn.home-webserver.de","000webmail.dyndns.ddnss.de","000webmail.dyndns1.de","000webmail.home-webserver.de","007.hzeg.eu.org","00jac.com","01022.hk","010530.xyz","01130.hk","020307.ccwu.cc","020307.xyz","027168.com","045692.xyz","062e.com","0815.ru","0815.su","0845.ru","092088.xyz","0box.eu","0cd.cn","0clickemail.com","0cpub2.tech","0n0ff.net","0nelce.com","0rg.fr","0sg.net","0v.ro","0w.ro","0wnd.net","0wnd.org","0x207.info","1-8.biz","1-mintue-mail.ddnsgeek.com","1-second-mail.site","1-tm.com","10-minute-mail.com","1000acres.co.uk","1000rebates.stream","10011.hzeg.eu.org","100811.xyz","10086.hzeg.eu.org","100likers.com","102.io.vn","103.ink","105kg.ru","10dk.email","10inbox.online","10mail.com","10mail.org","10mail.tk","10mail.xyz","10min.email","10minemail.com","10minmail.de","10minmail.org","10minut.com.pl","10minut.xyz","10minute.email","10minutemail.be","10minutemail.cf","10minutemail.co.uk","10minutemail.co.za","10minutemail.com","10minutemail.de","10minutemail.ga","10minutemail.gq","10minutemail.ml","10minutemail.net","10minutemail.nl","10minutemail.pro","10minutemail.us","10minutemailbox.com","10minutemails.in","10minutenemail.de","10minutenmail.xyz","10minutes.email","10minutesmail.com","10minutesmail.fr","10minutmail.pl","10timer.com","10x9.com","1111111111111.dynv6.net","11163.com","11166666.xyz","114514279.xyz","115yu.cc.cd","11mail.com","123-m.com","123.com","12312312312.cfd","123312.cc.cd","1234211.xyz","123456789.life","123box.net","123clone.com","123india.com","123mail.cl","123mail.org","123mails.org","123qwe.co.uk","126.com","12bclass.us","12friday.space","12hosting.net","12houremail.com","12minutemail.com","12minutemail.net","12storage.com","130723.xyz","13282298.xyz","1337.care","13512863687.store","139.com","140unichars.com","142code.me","147.cl","14club.org.uk","14n.co.uk","150mail.com","150ml.com","151668.xyz","15553.eu.cc","15555.eu.cc","15557.eu.cc","15963.fr.nf","15meg4free.com","15qm.com","163.com","164109038.xyz","16816889.xyz","16mail.com","179297.xyz","17tb.io.vn","1820mail.vip","188.com","189.cn","189.email","18ed0fl.dpdns.org","18lover.com","18t5b.shop","191117636.cfd","191mariobet.com","199411.store","1av2.lx1qzz.qzz.io","1blackmoon.com","1ce.us","1chuan.com","1clck2.com","1coolplace.com","1freeemail.com","1fsdfdsfsdf.tk","1funplace.com","1internetdrive.com","1m1.dpdns.org","1mail.ml","1mail.net","1me.net","1mum.com","1musicrow.com","1netdrive.com","1nom.org","1nsyncfan.com","1pad.de","1pice.io.vn","1s.fr","1sec.email","1sec.site","1secmail.com","1secmail.net","1secmail.org","1secmail.space","1secmail.website","1st-forms.com","1sworld.com","1t-mail.com","1to1mail.org","1trick.net","1u.sdfe.app","1under.com","1usemail.com","1vpn.net","1webave.com","1webhighway.com","1webmail.info","1win.life","1xp.fr","1zhuan.com","2-b.icu","2-mail.com","200192.indevs.in","20030310.com","2003066.xyz","20031227.de5.net","2012-2016.ru","20220108.xyz","20253025.xyz","20260501.ccwu.cc","20260503.ccwu.cc","202608221.xyz","2048unblocked.com","204901.xyz","206969.xyz","20email.eu","20email.it","20mail.eu","20mail.in","20mail.it","20minutemail.com","20minutemail.it","20minutesmail.com","20mm.eu","212.com","2120001.net","215.mico.de5.net","215.singledog.net","216222.xyz","21cn.com","21mail.top","2200freefonts.com","22345377.xyz","2333.live","234.ee","247chats.com","247web.net","24faw.com","24hinbox.com","24horas.com","24hourmail.com","24hourmail.net","24mail.top","25kcreditveo3.io.vn","25kg2gveo3.io.vn","25kmans.io.vn","25kmembers.io.vn","25kseller.io.vn","25kselll.io.vn","25kveo.io.vn","25kveo3.io.vn","25kvideo.io.vn","25u.com","264341.xyz","269966.xyz","2911.net","2932919455.dynv6.net","2980.com","2anom.com","2birs.ccwu.cc","2bmail.co.uk","2chmail.net","2d2i.com","2die4.com","2ether.net","2fdgdfgdfgdf.tk","2iij.net","2insp.com","2likemobile.site","2likemobile.tech","2likemobile.top","2likemobile.xyz","2mail.eu.cc","2mails.site","2odem.com","2prong.com","2trom.com","2wc.info","3000.it","300book.info","30mail.ir","30minutemail.com","30minutesmail.com","30wave.com","3126.com","3202.com","32132.ccwu.cc","321media.com","326645.indevs.in","326646.indevs.in","326646302.indevs.in","3333366.xyz","33mail.com","3435637.xyz","365boxmail.com","36duongtau.live","36ru.com","37.com","38yz.help","39393.eu.cc","39393.me","3a88.dev","3ammagazine.com","3bbb.cc.cd","3d-painting.com","3dkai.com","3dmail.com","3email.com","3fdn.com","3g.ua","3hr77ale.mailosaur.net","3jf.cn","3l6.com","3littlemiracles.com","3mail.ga","3trtretgfrfe.tk","3xl.net","3xu.studio","4-n.us","401010.xyz","4057.com","415dacjder.qzz.io","418.dk","423619.wherever.de5.net","42o.org","42web.io","444.net","45kg2gveo3.io.vn","45kselller.io.vn","45kveo.io.vn","45kveo3.io.vn","48dz.com","48hr.email","497000.xyz","499713376.xyz","4bbb.cc.cd","4bus.io.vn","4email.com","4email.net","4gfdsgfdgfd.tk","4heats.com","4k5.net","4mail.cf","4mail.ga","4mg.com","4newyork.com","4nextmail.com","4nmv.ru","4pu.com","4save.net","4tb.host","4warding.com","4warding.net","4warding.org","4x4man.com","50mail.com","50set.ru","51baidu.tech","51mail.shop","51www.us","521883.xyz","522885.xyz","52mails.com","55hosting.net","579199.xyz","5ghgfhfghfgh.tk","5gramos.com","5ixmonth.xyz","5july.org","5mail.cf","5mail.ga","5minutemail.net","5oz.ru","5semail.com","5tb.in","5x25.com","5xu.vn","5y.loseyourip.com","5yaochu.top","5ymail.com","60minutemail.com","628868.xyz","636364.xyz","66-77.cc","662602718.xyz","668fmail.com","66b1it.eu.org","67.niconico.ccwu.cc","672643.net","675hosting.com","675hosting.net","675hosting.org","6789.io.vn","67899vip.com","681mail.com","689345.xyz","6974.click","69flix.site","6gdfg.zone.id","6hjgjhgkilkj.tk","6ip.us","6mail.cf","6mail.ga","6mail.ml","6n9.net","6paq.com","6somok.ru","6th.pp.ua","6url.com","6ys.tech","709183.freeddns.org","719182.accesscam.org","729406.xyz","7362354.xyz","74.ru","74gmail.com","75hosting.com","75hosting.net","75hosting.org","778891.icu","78.edu.kg","78.school","78511939.xyz","792792.xyz","794613.accesscam.org","7days-printing.com","7mail.ga","7mail.ml","7novels.com","7tags.com","7xusq8vbim5d47.icu","80665.com","80fight.cn","8127ep.com","816qs.com","83.io.vn","862808.xyz","875888.xyz","88.am","8848.net","88cloud.cc","8d7kh.com","8mail.cf","8mail.ga","8mail.ml","8w3q0zls.mailosaur.net","911666.xyz","912684.abrdns.com","91tanhua.top","920325.xyz","931123.xyz","94587293.xyz","94an.com","950410.xyz","957jp.cc","971007.xyz","97rock.com","981027.xyz","98104.cn","99.com","992551.xyz","99cows.com","99experts.com","99mail.us","9l.sdfe.app","9mail.cf","9me.site","9mot.ru","9ox.net","9q.ro","a--i.top","a-bc.net","a-germandu.de","a.lacdn.cn","a0.engineer","a0.jesys.net","a45.in","a7996.com","aa55.tech","aa5zy64.com","aaago.cyou","aaamail.zzn.com","aabkmail.com","aachendate.de","aaconservation.org","aahzz.com","aakingcompany.shop","aakk.link","aakkmail.com","aamail.net","aaoo.me","aapt.net.au","aaqwe.ru","aaqwe.store","aard.org.uk","aaronkwok.net","aasdarq.eu.cc","aasdasd.eu.cc","aatrox.org","ab1.store","abacuswe.us","abaib.bond","abajb.bond","abakiss.com","abalb.bond","abamb.bond","abanb.bond","abapb.bond","abasb.bond","abatido.com","abaub.bond","abaxb.bond","abayb.bond","abazb.bond","abbeyroadlondon.co.uk","abc179312.shop","abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijk.com","abcflash.net","abcmail.email","abdulnour.com","abematv.net","aberllefenni.co.uk","aberystwyth.com","abevw.com","abilityaccesslegal.org","abilitywe.us","abo-free.fr.nf","aboodbab.com","abouse.space","about.com","abovewe.us","abowned.com","absolutewe.us","abundantwe.us","abusemail.de","abuser.eu","abusultann.com","abusultansmarty.co.uk","abusultanvip.com","abusultanvipo2.co.uk","abv.bg","abwesend.de","abyis.com","abyssmail.com","ac-malin.fr.nf","ac20mail.in","academiccommunity.com","academycougars.com","academywe.us","acaic.bond","acanok.com","acc1s.com","acc1s.net","accclone.com","acceleratewe.us","accentwe.us","acceptwe.us","acceso.or.cr","access4less.net","accessgcc.com","accis.net","acclaimwe.us","accora.io.vn","accordwe.us","accountant.com","accountscenter.support","accreditedwe.us","acdag.indevs.in","acdcfan.com","ace-of-base.com","ace.wherever.de5.net","acedby.com","acg-news.com","acgdb.eu.org","acgn.click","acgnnews.com","achievementwe.us","achievewe.us","acidservices.xyz","acmemail.net","acninc.net","acornwe.us","acqq.dev","acreadingroom.co.uk","acrossgracealley.com","acrylicwe.us","actarus.infos.st","activatewe.us","activist.com","activitywe.us","acucre.com","acuitywe.us","acumenwe.us","ad-managment.run.place","adadad.uk","adaid.bond","adam.com.au","adaptivewe.us","adaptwe.us","adarsa.me","adawd.bond","add3000.pp.ua","addadsasd.icu","addcom.de","addictingtrailers.com","addmails.com","address.com","addrin.uk","adelphia.net","adeptwe.us","adexec.com","adfarrow.com","adfskj.com","adios.email","adios.net","adiq.eu","aditus.info","admiralwe.us","adn3t.com","ado888.biz","adobeccepdm.com","adoniswe.us","adoption.com","ados.cc.cd","ados.fr","adpugh.org","adrenalinefreak.com","adresse.infos.st","adroh.com","ads24h.top","adsd.org","adsensekorea.com","adsl.no","adthost.top","adubiz.info","adult-work.info","adv-dep-eng.jo3.org","advalvas.be","advantagewe.us","advantageyoungpeople.com","advantimo.com","advarm.com","adventurewe.us","adventwe.us","advisorwe.us","advitise.com","advocatewe.us","adwaterandstir.com","aeace.bond","aeale.bond","aeame.bond","aeape.bond","aeare.bond","aeaue.bond","aeaxe.bond","aebz.makeup","aecmedya.com","aeerso.space","aegde.com","aegia.net","aegiscorp.net","aegiswe.us","aeiou.pt","aelo.es","aemail4u.com","aeneasmail.com","aeonpsi.com","aerionx25k.io.vn","aeronyx.cfd","aesel.me","aetheron.cfd","afalf.bond","afarek.com","afarf.bond","afeeyah.store","affecting.org","affiliate-nebenjob.info","affiliatedwe.us","affilikingz.de","affinitywe.us","affluentwe.us","affordablewe.us","afgpuk.co.uk","afia.pro","afreeinternet.com","africamail.com","africamel.net","afrobacon.com","afse-gh.top","aftely.eu.cc","aftercorporation.com","afterhourswe.us","afternea.sbs","afw.fr.nf","ag.us.to","ag77brc.ddnsfree.com","agabg.bond","agallagher.id","agedmail.com","agencysq.store","agendawe.us","agenpremium.store","agentloop.sbs","agger.ro","agilewe.us","agiuse.com","agmbowie.com","agoodmail.com","agorawe.us","agri4life.io.vn","agtx.net","agylzuv.top","ahaa.dk","ahavaexperience.com","aheadwe.us","ahem.email","ahk.jp","ahmadfamily.net","ahmadizhar.net","ahmedkhlef.com","ahvin.com","ai100999.com","aiaccount.click","aiapes.publicvm.com","aibase.bond","aichi.com","aiclit.asia","aidesign.work.gd","aidesigner.2bd.net","aifmusic.top","aifreeuk.com","aifreeuk.info","aifreeuk.net","aifreeuk.store","aigcdog.com","aigts.top","aihubtools.space","aihuohua.online","aikunkun.com","ailicke.com","aim.com","aineapi.com","aiphotoeditor.io","aiphotoenhancer.me","air2token.com","aircourriel.com","aircraftmail.com","airforce.net","airforceemail.com","airhemp.com","airmail.cc","airmail.uron.de5.net","airmailbox.website","airpost.net","airsworld.net","airychen.com","aisub.store","aisubpro.click","aisubstore.click","aisupply.click","aiuu.tech","aiworldx.com","aixnv.com","aizhongzhuan.cc","aj135.33mail.com","ajacied.com","ajaxapp.net","ajinimoto.me","ak02fca.loseyourip.com","ak1314.eu.cc","ak47.hu","ak6lay.shop","akapost.com","akbip.com","akerd.com","akfoin.us.ci","akgq701.com","akhl.autos","akirapowered.com","akixpres.com","akjaey.space","akmail.in","aknet.kg","akolay.tech","akugu.com","akunlama.com","akunlemah.biz.id","al-qaeda.us","al1ya.app","alarafoundation.com","albawaba.com","albill.com","albionwe.us","alchemywe.us","aleh.de","alex12345.33mail.com","alex4all.com","alexandria.cc","alfaceti.com","algeria.com","alhilal.net","alhsalumni.org","aliasvault.net","aliaswe.us","alibaba.com","aliban.org","alice.it","alienware13.com","aligamel.com","alightmotion.cloud","alightmotion.id","alightmotion.top","alightmotion.website","aligroup.uk","alilot.com","alin.cc.cd","alin.eu.cc","alina-schiesser.ch","alisaol.com","alisongamel.com","alisree.com","alivance.com","alive.cz","alivewe.us","aliyun.com","all-cats.ru","allaccesswe.us","allamericanwe.us","allaroundwe.us","alldirectbuy.com","allegiancewe.us","allegrowe.us","allemojikeyboard.com","allergist.com","allez.io.vn","allfreemail.net","allgoodwe.us","alliancewe.us","allinonewe.us","allmail.net","allofthem.net","alloutwe.us","allowed.org","alloymail.com","alloywe.us","allprowe.us","allracing.com","allreview4u.com","allsaintsfan.com","allseasonswe.us","allservice.fun","allstarwe.us","allthegoodnamesaretaken.org","allumhall.co.uk","allurewe.us","allwebemails.com","almatips.com","almiswelfare.org","almondwe.us","alosp.com","alpenjodel.de","alph.wtf","alpha-web.net","alphafrau.de","alphaomegawe.us","alphatronic25k.io.vn","alphax.fr.nf","alpinewe.us","alreval.com","alskens.dk","altairwe.us","altavista.com","altavista.net","altavista.se","alternativagratis.com","altitudewe.us","altmails.com","altrans.fr.nf","altuswe.us","aluimport.com","alumni.com","alumnidirector.com","alvaxio.com","alves.fr.nf","alvilag.hu","alwayss.uno","ama-trade.de","ama-trans.de","amadeuswe.us","amail.club","amail.com","amail1.com","amail4.me","amazinggift.life","amazingly.online","amazon-aws.org","amazonses.com","amberwe.us","ambes.org","ambiancewe.us","ambitiouswe.us","ameady.com","ameeppoossaa.dedyn.io","amelabs.com","amele.com","america.hm","americanawe.us","americancivichub.com","americasbestwe.us","americaswe.us","ameritech.net","amex409.monster","amicuswe.us","amilegit.com","aminating.com","aminavin.com","amiri.net","amiriindustries.com","amiyah.cloud","amiyiy.xyz","amnetsal.com","amorki.pl","amplewe.us","amplifiedwe.us","amplifywe.us","ampsylike.com","amrer.net","amuro.net","amuromail.com","anajakstore.site","analogwe.us","analysiswe.us","analyticalwe.us","analyticswe.us","analyticwe.us","ananzi.co.za","anappfor.com","anappthat.com","anarac.com","anawebs.com","anbinh.io.vn","andalanglobal.app","andreihusanu.ro","andrewclaude.eu","andrewclaude.fr","andrewclaude.org","andrewclaude.store","andrewcluh.top","androl.cfd","andthen.us","andylau.net","anfmail.com","angelfire.com","angelic.com","angelina.syrf109475.top","angiiidayyy.click","anhiqojkaq1.abrdns.com","anhvip9999.com","anie.io.vn","animail.net","animalhouse.com","animalwoman.net","animateany.com","animatimg.com","animesos.com","animoby.com","aniross.com","anit.ro","anjungcafe.com","ankiclub.space","anlubi.com","ann.qzz.io","annd.us","annnekkk.com","annsmail.com","ano-mail.net","ano2.co.uk","anogz.com","anon-mail.de","anonbox.net","anonmail.top","anonmails.de","anonymail.dk","anonymbox.com","anonymized.org","anonymous.to","anonymousness.com","anote.com","another.com","anotherdomaincyka.tk","anotherwin95.com","anquandx.com","ansibleemail.com","anthony-junkmail.com","anti-social.com","anti.io.vn","antireg.com","antireg.ru","antisocial.com","antispam.de","antispam.fr.nf","antispam24.de","antispammail.de","antongijsen.com","antttool.us","antwerpen.com","anversa.com.co","anvjobvnu.top","any.pink","anyalias.com","anymoment.com","anypng.com","anytimenow.com","anywebmail.com","aobl.hair","aoeuhtns.com","aohl.io.vn","aojatd.uron.de5.net","aokkad.com","aokkap.my.id","aokkas.com","aol.co.uk","aol.com","aol.de","aol.fr","aon.at","aoyh.hair","ap535fu.ddnsfree.com","apdtax.com","ape-tech.run.place","apedesigns.jo3.org","apedesigns.linkpc.net","apes-ai.linkpc.net","apex.io.vn","apexmail.com","apexnovaser.com","apexone.top","apfelkorps.de","aphlog.com","api-v1.cc.cd","api.qwen3-30b-a3b.xyz","apimi.icu","apiroot.vps.cd","apkfor.co","apkmd.com","aplix.id","apmail.com","apocaw.com","apollo.lv","aport.ru","aport2000.ru","app.longlivethepeople.dpdns.org","appbott.com","appc.se","appinventor.nl","appixie.com","apple.edu.pl","appmail.uk","appraiser.net","appremiums.pro","approvers.net","apps.dj","appsdjheru.site","appzily.com","aprinastore.web.id","aprte.com","aqilakomputer.com","aqim.skin","aquaguide.ru","aquaqua.top","aquas.live","ar26710.cc.cd","arabia.com","arabtop.net","arapgege.app","arapps.me","arcadein.com","arcadium.lat","arcentra.cfd","archaeologist.com","arcor.de","arcotronics.bg","arcticmail.com","ardsp.shop","arduino.hk","arenahiveai.com","ares.edu.pl","ares.io.vn","argentina.com","ariaz.jetzt","aristotle.org","arkoo.site","arksy12.eu.cc","army.net","armyspy.com","arnet.com.ar","aron.us","arrabyte.com","arrb.autos","arroisijewellery.com","art-en-ligne.pro","art2mart.com","arthiq.life","artleoncommunications.com","artlover.com","artlover.com.au","artman-conception.com","artsdigi.store","artsdigital.store","arur01.tk","arurgitu.gq","arvato-community.de","arxxwalls.com","as-if.com","asahi-net.or.jp","asajv2ray.site","asaption.com","aschenbrandt.net","asciibinder.net","asd903102.online","asdascas.dpdns.org","asdasd.nl","asdasd.ru","asdcxijkj.eu.cc","asean-mail.com","asedeeqaweds.dedyn.io","asgzs.top","asheville.com","ashleyandrew.com","ashnkarsh.life","asia-hq.jo3.org","asia-links.com","asia-mail.com","asiafind.com","asiafootball.org.uk","asianavenue.com","asiancityweb.com","asiansonly.net","asianwired.net","asiapoint.net","asimarif.com","asistx.net","ask-mail.com","asleepity.com","asorent.com","aspireviastudios.org","ass.pp.ua","assala.com","assamesemail.com","assurmail.net","astonut.tk","astralis.cn","astroboymail.com","astroempires.info","astrolover.com","astrosfan.com","astrosfan.net","asu.mx","asu.su","asurad.com","asurfer.com","at.hm","at0mik.org","atelierdelune.shop","atheist.com","athenachu.net","atina.cl","atkshop.shop","atkshopp.space","atl.lv","atlas.cz","atlas4381.me","atlasimple.com","atlaswebmail.com","atmc.net","atmemail.top","atnet.top","atnetcloud.space","atnextmail.com","atomauto.vn","atombomb.online","atozasia.com","atrus.ru","att.net","attglobal.net","attnetwork.com","attymail.com","atxc.space","au.com","au.ru","au1688x.us","aubady.com","auctioneer.net","augmentationtechnology.com","augrisai.cc.cd","aumails.us","auone-net.jp","auralith.cfd","aureliandata.space","ausgefallen.info","ausi.com","aussiemail.com.au","austin.rr.com","australia.edu","australiamail.com","austrosearch.net","auth2fa.com","auti.st","autoescuelanerja.com","autofixmax.com","autograf.pl","automisly.org","automizelymail.info","automizly.net","autommo.net","autorambler.ru","autorobotica.com","autosouvenir39.ru","autotwollow.com","autowb.com","autoxugiare.com","autre.fr.nf","autu11n.lol","available-home.com","avalentra.cfd","averdov.com","avh.hu","avia-tonic.fr","avls.pt","avq69cb.loseyourip.com","avtolev.com","awa.pics","awatum.de","awdrt.org","awesome47.com","awesomesaucemail.org","awgarstone.com","awiki.org","awoiiwowma11001.indevs.in","aws-mail-2.dynv6.net","aws-mail-free-1017.dynv6.net","aws-mail-free-102.dynv6.net","aws-mail-free-1056.dynv6.net","aws-mail-free-1304.dynv6.net","aws-mail-free-1705.dynv6.net","aws-mail-free-1842.dynv6.net","aws-mail-free-1884.dynv6.net","aws-mail-free-2156.dynv6.net","aws-mail-free-2236.dynv6.net","aws-mail-free-2290.dynv6.net","aws-mail-free-2383.dynv6.net","aws-mail-free-2409.dynv6.net","aws-mail-free-2454.dynv6.net","aws-mail-free-2524.dynv6.net","aws-mail-free-2704.dynv6.net","aws-mail-free-2737.dynv6.net","aws-mail-free-2775.dynv6.net","aws-mail-free-2795.dynv6.net","aws-mail-free-2845.dynv6.net","aws-mail-free-2892.dynv6.net","aws-mail-free-2906.dynv6.net","aws-mail-free-2923.dynv6.net","aws-mail-free-3038.dynv6.net","aws-mail-free-3335.dynv6.net","aws-mail-free-3381.dynv6.net","aws-mail-free-3620.dynv6.net","aws-mail-free-3711.dynv6.net","aws-mail-free-3796.dynv6.net","aws-mail-free-385.dynv6.net","aws-mail-free-4014.dynv6.net","aws-mail-free-4017.dynv6.net","aws-mail-free-4131.dynv6.net","aws-mail-free-4206.dynv6.net","aws-mail-free-4257.dynv6.net","aws-mail-free-4289.dynv6.net","aws-mail-free-4531.dynv6.net","aws-mail-free-4550.dynv6.net","aws-mail-free-4573.dynv6.net","aws-mail-free-4711.dynv6.net","aws-mail-free-4726.dynv6.net","aws-mail-free-4761.dynv6.net","aws-mail-free-4816.dynv6.net","aws-mail-free-4885.dynv6.net","aws-mail-free-4920.dynv6.net","aws-mail-free-493.dynv6.net","aws-mail-free-4937.dynv6.net","aws-mail-free-5119.dynv6.net","aws-mail-free-518.dynv6.net","aws-mail-free-5241.dynv6.net","aws-mail-free-5380.dynv6.net","aws-mail-free-5392.dynv6.net","aws-mail-free-5537.dynv6.net","aws-mail-free-5670.dynv6.net","aws-mail-free-5781.dynv6.net","aws-mail-free-5786.dynv6.net","aws-mail-free-5969.dynv6.net","aws-mail-free-6032.dynv6.net","aws-mail-free-6033.dynv6.net","aws-mail-free-6080.dynv6.net","aws-mail-free-6120.dynv6.net","aws-mail-free-6253.dynv6.net","aws-mail-free-6255.dynv6.net","aws-mail-free-6306.dynv6.net","aws-mail-free-6398.dynv6.net","aws-mail-free-6552.dynv6.net","aws-mail-free-659.dynv6.net","aws-mail-free-6604.dynv6.net","aws-mail-free-6690.dynv6.net","aws-mail-free-6691.dynv6.net","aws-mail-free-6762.dynv6.net","aws-mail-free-6826.dynv6.net","aws-mail-free-7145.dynv6.net","aws-mail-free-7149.dynv6.net","aws-mail-free-7153.dynv6.net","aws-mail-free-7194.dynv6.net","aws-mail-free-7358.dynv6.net","aws-mail-free-7477.dynv6.net","aws-mail-free-764.dynv6.net","aws-mail-free-7654.dynv6.net","aws-mail-free-7838.dynv6.net","aws-mail-free-7849.dynv6.net","aws-mail-free-788.dynv6.net","aws-mail-free-7897.dynv6.net","aws-mail-free-8085.dynv6.net","aws-mail-free-8091.dynv6.net","aws-mail-free-8205.dynv6.net","aws-mail-free-8225.dynv6.net","aws-mail-free-8467.dynv6.net","aws-mail-free-8475.dynv6.net","aws-mail-free-8741.dynv6.net","aws-mail-free-9015.dynv6.net","aws-mail-free-916.dynv6.net","aws-mail-free-9161.dynv6.net","aws-mail-free-9283.dynv6.net","aws-mail-free-9409.dynv6.net","aws-mail-free-9533.dynv6.net","aws-mail-free-9596.dynv6.net","aws-mail-free-9697.dynv6.net","aws-mail-free-9703.dynv6.net","aws-mail-free-9789.dynv6.net","aws-mail.accesscam.org","aws-mailer.dynv6.net","awsl.uk","awsom.net","awsoo.com","ax05.cn","axarcaterers.com","axax.asia","axgrad.io","axin05.icu","axionintellex.shop","axiz.org","axon7zte.com","axoskate.com","axrx.hair","axsup.net","ayag.cloud","ayakamail.cf","ayload.bond","ayna.com","ayumas.store","az18nep.camdvr.org","azame.pw","azazazatashkent.tk","azcomputerworks.com","azeqsd.fr.nf","azet.sk","azimiweb.com","azly.autos","azmeil.tk","azulejoslowcost.es","azuretechtalk.net","azurien.cfd","azzancoffee.com","b0h748o.kozow.com","b1of96u.com","b1tvjn3.loseyourip.com","b20nn6.cn","b2bx.net","b2cmail.de","b3j72kr.theworkpc.com","b7s.ru","babyeat.food","babyfun.fun","bachelorboy.com","bachelorgal.com","back67283.eu.cc","back7654.eu.cc","backilnge.com","backpackers.com","backstreet-boys.com","backstreetboysclub.com","backup0x00.de5.net","bacteroidmail.com","badgerhole.com","badgerland.eu","badoop.com","badopsec.lol","badpotato.tk","baechecker.com","bagherpour.com","bahlill.cfd","baicai1145.online","baicai1145.shop","baidoxe.com","baileybridge.org","baipiaodashen.cloud-ip.cc","baiyucraft.sbs","baizoto.shop","bakalos.dpdns.org","bakultelo.com","balaket.com","balawo.com","baldmama.de","baldpapa.de","ballyfinance.com","banana.linkpc.net","bananaspace.shop","banancaocap.com","banclone.pro","bandtoo.com","bangban.uk","bangdieukhien.net","bangkok.com","bangkok2000.com","banhang14.com","banit.club","banit.me","bank-opros1.ru","bankinnepal.com","bannertown.net","banri.xyz","baptistmail.com","baptized.com","baqx.autos","bar-ton.store","barcelona.com","bareed.ws","barnrestaurant.pro","barooko.com","barry.dpdns.org","barryogorman.com","bartdevos.be","bartender.net","baseballmail.com","baselogicroute.com","basepathgrid.com","baserda.net","bashyrcn.yachts","basketballmail.com","basketrise.com","basscode.org","batdongsanhatinh.org","bathdf.co.uk","batiinsaat.net","batuta.net","baudoinconsulting.com","bauwerke-online.com","baybabes.com","baybumutan.shop","bazaaboom.com","bb28.dev","bbbbyyzz.info","bbfz.makeup","bbhost.us","bbiq.jp","bbitf.com","bbitj.com","bbitq.com","bbmail.store","bbmailku.com","bbnett.no","bbox.fr","bboy.zzn.com","bboys.fr.nf","bbroot.com","bbtec.net","bbwg.one","bbxb.fashion","bbyb.fashion","bcaoo.com","bcast.ws","bcb.ro","bcbc.cc.cd","bccto.me","bcm.edu.pl","bcmail.pro","bcooq.com","bcvibes.com","bda.io.vn","bdgstr.com","bdm.ovh","bdmuzic.pw","bdo.io.vn","bdq8.pw","bdshar.com","beaconmessenger.com","beamcosmic.com","bearsarefuzzy.com","beastmail.space","beatbok.online","beautifulblessingsbeyondborders.org","bebed.cyou","bebel.cyou","beben.cyou","bebez.cyou","beddly.com","beeebank.com","beefmilk.com","beelsil.com","beenhad.com","beep.ru","beer.com","beethoven.com","beganment.com","begemail.com","begfax1.loseyourip.com","behatifoundation.org","bekasi.me","belamail.org","belettersmail.com","belgianairways.com","belicapcut.app","belice.com","belizehome.com","bell.net","bellair.net","belljonestax.com","bellsouth.net","beluckygame.com","benipaula.org","benphim.com","benphim.net","benshelf.com","bepureme.com","beribase.ru","beribaza.ru","berirabotay.ru","berkahfb.com","berkahjayashope.com","berlin.com","berlin.de","berlinexpo.de","berwie.com","bespokehaircare.co.uk","best-hosting.biz","best-john-boats.com","best-temp-mail.com","best-vpn.xyz","bestchoiceusedcar.com","bestlistbase.com","bestmail.us","bestoption25.club","bestparadize.com","bestrui.qzz.io","bestsoundeffects.com","besttempmail.com","beta.edu.pl","betacinder.com","betatensor.com","betr.co","betriebsdirektor.de","bettergolf.net","betteryoutime.com","beyondreasonabledoubt.co.uk","bezill.com","bflcafe.com","bgtmail.com","bgx.ro","bgyiacczy.top","bhana.xyz","bhap.me","bharatmail.com","bheps.com","bhuxp.org","bidourlnks.com","big1.us","bigassweb.com","bigblue.net.au","bigboab.com","bigfoot.com","bigfoot.de","bigger.com","biggerbadder.com","biglobe.ne.jp","bigmail.lol","bigmailbox.com","bigmir.net","bigonla.com","bigpond.au","bigpond.com","bigpond.com.au","bigpond.net","bigpond.net.au","bigprofessor.so","bigramp.com","bigstring.com","bigwhoop.co.za","bij.pl","bikemechanics.com","bikeracer.com","bikeracers.net","bikerider.com","bilingva-ca.store","billsfan.com","billsfan.net","bimla.net","bin-ich.com","bin-wieder-da.de","binafex.com","binancepools.cloud","binbx.net","binech.com","binich.com","binka.me","binkmail.com","binnary.com","binsh.kro.kr","bio-muesli.info","bio-muesli.net","biojuris.com","bione.co","biopost.my.uy","bipochub.com","birdlover.com","birdowner.net","birh.hair","birminghamlife.org.uk","bishwanathuk.cc","bisons.com","bitmah.com","bitmail.com","bitmens.com","bitpage.net","bitproy.com","bitrealm.in","bittnex.com","bitwhites.top","bitymails.us","biubiuwholeworld.cn","biweia615.icu","biyug.com","biz.ezweb.ne.jp","biz.st","bizhosting.com","bizimalem-support.de","bizisstance.com","bj41.help","bjorwi.rest","bjvc.top","bk.ru","blackburnmail.com","blackgoldagency.ru","blackmarket.to","blackplanet.com","blader.com","bladesmail.net","blakeagency.buzz","blazemail.com","bleib-bei-mir.de","blenched.com","blendlog.com","blenro.com","bletilla.cc","bletsoetownclosecharity.bio","blip.ch","blip.ovh","blnkt.net","blobapps.com","block-this-for-gambling.cloud-ip.cc","block521.com","blockfilter.com","blog3.cc.cd","blogger.nyc.mn","blogmyway.org","blogos.net","blogspam.ro","blogtricks.de","blondemorkin.com","blondmail.com","blpz.hair","bltiwd.com","bluebottle.com","bluedumpling.info","bluegrassluck.com","bluehyppo.com","bluemail.ch","bluemail.dk","bluesfan.com","bluewerks.com","bluewin.ch","blueyonder.co.uk","bluezone.no","blushmail.com","blutig.me","bmlsports.net","bmoar.com","bncinema.com","bnote.com","bnrlner.shop","bnyhr.us","boardermail.com","boatmail.us","boatracers.com","bobgf.ru","bobgf.store","bobmail.info","bobmurchison.com","bocas.tech","bodhi.lawlita.com","boerakemail.com","bofthew.com","bogchi.com","bokgumail.kr","bol.com.br","bolacha.email","bolando.com","bollywoodz.com","boltonfans.com","bombdiggity.com","bomnet.net","bonbon.net","bonobo.email","boofx.com","bookgame.org","bookthemmore.com","boom.com","boom.publicvm.com","boom114.ccwu.cc","boommail.online","boosthub.live","boostme.es","bootmail.com","bootssl.com","bootybay.de","boranora.com","bored.lol","borged.com","borged.net","borged.org","bornnaked.com","bosakun.com","bosakun.online","boscharena.dev","boshi-gdh.club","bostonoffice.com","bot.cd","bot.nu","botasky.eu.cc","botgetlink.com","botgetlink.net","botnet.my.id","boukshilf.com","boun.cr","bounce.net","bounces.amazon.com","bouncr.com","bowlfuel.com","box-mail.ru","box-mail.store","box.az","box.ua","boxbg.com","boxem.ru","boxem.store","boxemail.com","boxfi.uk","boxformail.in","boxfrog.com","boximail.com","boxlet.ru","boxlet.store","boxmach.com","boxmail.lol","boxmail1.com","boxmus.com","boxomail.live","boxtemp.com.br","boyaga.com","boyzoneclub.com","bpotogo.com","bptfp.net","bradfordfans.com","bradingtowntrust.co.uk","brajraj.org","brand-app.biz","brandallday.net","brandme.my.uy","brashbeat.online","brasilia.net","brasx.org","brazbuzii.online","brazilmail.com","brazilmail.com.br","breadtimes.press","breaite.com","breakthru.com","breathe.com","brefmail.com","brennendesreich.de","bresnan.net","brevionix.cfd","brevitron.cfd","brew-master.com","brew-meister.com","brfree.com.br","bridgetonmainstreet.org","briefalpha.org","briefemail.com","briggsmarcus.com","bright.net","brightfuturescharity.org.uk","bristolstatehousefoundation.org","britneyclub.com","brittonsign.com","brivian.link","brixozu.com","broadbandninja.com","broadcast.net","broadpark.no","brodipek.xyz","brokenion.com","brokenvalve.com","brothershaircut.com","brownjasen.ccwu.cc","browzensew.ca","browzensew.com","browzensew.icu","browzensew.info","browzensw.com","browzensw.info","browzensw.net","browzensw.store","brusseler.com","bsb.cc.cd","bscse.okcx.edu.rs","bsdmail.com","bsfh.beer","bskyx.fun","bsnow.net","bspamfree.org","bspooky.com","bst-72.com","btb-notes.com","btc.email","btcmail.pw","btcmod.com","btconnect.co.uk","btconnect.com","btinternet.com","btizet.pl","btopenworld.co.uk","btsblock.com","btthyto.org","btzca8.nsmjj.cc.cd","buccalmassage.ru","budaya-tionghoa.com","budayationghoa.com","buddyfly.top","buerotiger.de","buffemail.com","buffymail.com","bugfoo.com","bugmenever.com","bugmenot.com","buhf95r.ddnsfree.com","bukanimers.com","bukatv8.com","bukhariansiddur.com","bulapolo.site","bullbaby.com","bullsfan.com","bullsgame.com","buloan.com","bulrushpress.com","bultoc.com","bum.net","bumail.site","bumerang.ro","bumpymail.com","bunchofidiots.com","bund.us","bundes-li.ga","bung.holio.day","bunmail.one","bunnyhub.space","bunsenhoneydew.com","burangir.com","burnermail.bond","burnermail.cyou","burnthespam.info","burry.eu.org","burstmail.info","buryfans.com","busd-mmjd3.wiki","business-degree.live","business-man.com","businessbackend.com","businessman.net","businesssuccessislifesuccess.com","buspad.org","bussaco.com","bussinesa.app","bussitussi.com","busta-rhymes.com","busyaz.tech","butteiumien.io.vn","buxianliang.fun","buy-blog.com","buyapp.foo","buyersusa.com","buymoreplays.com","buyordie.info","buyreview.us","buyusdomain.com","buyusedlibrarybooks.org","buzzcluby.com","buzzcut.ws","bvimailbox.com","bwm.de5.net","bwmyga.com","bx52ff4a.shop","byagu.com","byconf.com","byebyemail.com","byespm.com","byiepsxqu.top","byjkprh.top","byom.de","bytedigi.com","bytonf.com","bznrehk.giize.com","bzpc.makeup","bzvrxf8.ooguy.com","c-eric.fr.nf","c-newstv.ru","c-pkk.icu","c-tta.top","c.dickdns.org","c.lgp888.xyz","c14.mobi","c1ph3r.xyz","c2.hu","c28.mobi","c2i.net","c3.hu","c3tovdch.mailosaur.net","c4.com","c4.fr","c4pro.uk","c51vsgq.com","caainpt.com","cabacabana.com","cabiste.fr.nf","cable.comcast.com","cableone.net","cachedot.net","cade.org.uk","caere.it","cafesui.com","caftee.com","caigq.qzz.io","cairomail.com","caiway.nl","caldrexa.cfd","calehq.com","calendar-server.bounces.google.com","calendro.fr.nf","calidifontain.be","california.edu.pl","californiafitnessdeals.com","californiamail.com","calima.asso.st","calirona.com","callnetuk.com","callsign.net","calmriver.info","caltanet.it","calvarystreetisa.org","cam4you.cc","camellia.indevs.in","cameltok.com","camera47.net","cameraity.com","camidge.com","camping-grill.info","canada-11.com","canada.com","canadianmail.com","cancer-treatment.xyz","candassociates.com","candymail.de","cane.pw","canfga.org","cangcud.com","cangcutku.pro","canoemail.com","cantozil.com","canvaspace.shop","canvect.com","canwetalk.com","caowo.online","capct.id","capcud.shop","capcut.digital","capcut.sbs","capcut.space","capcut.team","capcut02.shop","capcutku.io","capcutmeflo.shop","capcutmm.shop","capcutpro.click","capcutpro.dev","capcvt.es","capitalistdilemma.com","caprasolver.xyz","caps7.com","captus.cyou","caqcut.top","car101.pro","caramail.com","carbtc.net","care-breath.com","care2.com","careerbuildermail.com","caregradeguard.com","carioca.net","carpin.org","cars2.club","carsencyclopedia.com","cartelera.org","cartestraina.ro","casablancaresort.com","caseedu.tk","casema.nl","cash4u.com","cashette.com","cashflow35.co","cashflow35.com","casino.com","casterview.xyz","casualdx.com","catcat.uk","catcha.com","catchamail.com","catchmail.io","catfie.app","catgroup.uk","catholic.org","catlover.com","catsredeem.com","catterickgarrisonfootballcentre.uk","cauju.com","cauterize.top","cavi.mx","caye.org.uk","cazlg.com","cbair.com","cbasosbr.top","cbdol.mx","cbes.net","cboc.hair","cbsbada.com","cbty.ru","cbty.store","cbvl.co.uk","cc17.name.ng","cc18.name.ng","cc3.name.ng","cc6.name.ng","cc8c1bd6.abrdns.com","ccategoryk.com","ccimran.buzz","cckuy.com","ccm8klz.camdvr.org","ccmail.uk","ccqu.top","ccsuncare.com","cctc.fashion","cctoolz.com","cctruyen.com","ccwc.fashion","ccxiao.cn","cczc.fashion","cd2.com","cdfaq.com","cdlpvt3.mywire.org","cdnmia.com","cdnripple.com","cdpa.cc","cdxugmy.top","cecizie.web.id","ceed.se","cegil.id","cek.pm","celineclub.com","cellurl.com","celtic.com","cengrop.com","center-mail.de","centermail.at","centermail.com","centermail.de","centermail.info","centermail.net","centoper.it","centralpets.com","centrum.cz","centrum.sk","centurytel.net","cerisun.com","certexx.fr.nf","certificenter.com","certifiedmail.com","certve.com","cetpass.com","cfl.rr.com","cfo2go.ro","cg0gcab.mywire.org","cgac.es","cggup.com","cghost.s-a-d.de","ch.ma","chacuo.net","chahcyrans.com","chaichuang.com","chaineor.com","chaiyomail.com","chalupaurybnicku.cz","chamconnho.com","chammy.info","chance2mail.com","chanceforfuture.org","chandrasekar.net","chansd.com","chantellegribbon.com","chaocosen.com","chapsmail.com","charityrcao.org.uk","charl.us","charmedmail.com","charter.net","chasefreedomactivate.com","chat.ru","chatclaude.top","chatgpt.qwen3-30b-a3b.xyz","chatgptmail.shop","chatgptuk.pp.ua","chatgtporg.eu.cc","chatich.com","chattown.com","chatworkstation.com","chaublog.com","chauhanweb.com","chauhuy.click","chauhuy.io.vn","chauhuy.online","chauhuy.site","chautuyen.click","chautuyen.io.vn","chautuyen.online","cheaphub.net","cheapmori.store","cheatmail.de","chechnya.conf.work","check.com","check1check.com","cheerful.com","chef.net","chefalicious.com","chek.com","chello.nl","chello.no","cheminsdevie.ink","chemist.com","chenbot.email","chenbufan.top","chengsu.dpdns.org","chequemail.com","chessgameland.com","chessgamingworld.com","chestcloudx.com","chewydonut.com","cheyenneweb.com","chez.com","chibakenma.ml","chickenkiller.com","chickmail.com","chielo.com","childrenth.com","childsavetrust.org","chilkat.com","chillart.org","chilloliandfii.space","china.com","china.net.vg","chinamail.com","chinamkm.com","chingchongme.site","chirk.com","chithinh.com","chitthi.in","chocaholic.com.au","choco.la","chogmail.com","choicemail1.com","choichay.com","choigi.com","chol.com","chollian.net","chomolokko.shop","choner.cn","choner.shop","chong-mail.com","chong-mail.net","chong-mail.org","chongqilai.cc","chophim.com","chosenx.com","chotgo.com","chromentis.cfd","chsi.christmas","chuan.info","chumpstakingdumps.com","chundage.help","chupanhcuoidep.com","churchestate.org.uk","churchhousemanaton.co.uk","churchinsouthampton.org.uk","churchusa.com","cia-agent.com","cia.hu","ciaoweb.it","cicciociccio.com","cigar-auctions.com","cihai.eu.cc","cihaifhqo.eu.cc","cihuy.net","cimario.com","cinci.rr.com","cincinow.net","cipcup.site","citayam.com","citdaca.com","citiz.net","citlink.net","citmo.net","citromail.hu","city-of-bath.org","city-of-birmingham.com","city-of-brighton.org","city-of-cambridge.com","city-of-coventry.com","city-of-edinburgh.com","city-of-lichfield.com","city-of-lincoln.com","city-of-liverpool.com","city-of-manchester.com","city-of-nottingham.com","city-of-oxford.com","city-of-swansea.com","city-of-westminster.com","city-of-westminster.net","city-of-york.net","cityofcardiff.net","cityoflondon.org","civikli.com","civx.org","cj4fj2a.camdvr.org","cjdeyuiw.eu.cc","cjgq.skin","ckaazaza.tk","cketrust.org","ckiso.com","ckvn.edu.vn","cl-cl.org","cl0ne.net","claimab.com","clandest.in","claramail.com","classesmail.com","classicalfan.com","classicmail.co.za","classio.click","claudd.com","claverfield.org","cleaninbox.dynv6.net","clear.net.nz","clearbeam.pro","clearhabitpath.com","clearwatermail.info","clearwire.net","clerk.com","clfapqg.theworkpc.com","click-email.com","clickcore99.click","clickdeal.co","cliffhanger.com","clipmail.eu","clixser.com","clllsy.cc.cd","clockemail.com","clone21.io.vn","cloneemail.com","clonehv.com","clonekhoe.com","clonemailsieure.com","clonemoi.tk","clonenpa.com","clonere.net","clonetrust.com","close2you.net","cloud-mail.top","cloud-temp.com","cloudflare.gay","cloudgen.world","cloudgue.site","cloudsign.in","cloudtempmail.net","cloudwhitespace.cc.cd","cloudwhitezone.cc.cd","cloudyourfast.net","clousy.site","clout.wiki","clowmail.com","clrmail.com","club106.org.uk","club4x4.net","clubalfa.com","clubbers.net","clubducati.com","clubhonda.net","clubmember.org","clubnetnoir.com","clubvdo.net","cluemail.com","clx0vq5.kozow.com","clyvantis.cfd","cmail.blog","cmail.club","cmail.com","cmail.net","cmail.org","cmbl.top","cmcc.indevs.in","cmdkl.com","cmhvzylmfc.com","cmpmail.com","cn-gfw.ccwu.cc","cnamed.com","cndps.com","cnebw.eu.cc","cneemail.com","cnew.ir","cnieux.com","cnmsg.net","cnnsimail.com","cnoilpress.com","cnsds.de","cntv.cn","co.cc","coasah.com","cobal.infos.st","cobarekyo1.ml","cock.li","cocoro.uk","cocovpn.com","code-gmail.com","codeandscotch.com","codec.ro","codeguard.net","codei.site","coder.hu","coderdir.com","codestar.site","codesuc.top","codexrip.vip","coding.ccwu.cc","codinggo.cn","codivide.com","codoteam.com","codywon.top","codzy.net","coffeeazzan.com","coffeejadore.com","coffeetimer24.com","coftens.asia","cogil.id","cogsapb.ddnsfree.com","coid.biz","coieo.com","coin-host.net","coinlink.club","cok.org.uk","colabeta.com","colaname.com","coldemail.info","coldmail.com","collectiblesuperstore.com","collector.org","collegeclub.com","collegemail.com","colleges.com","collegewh.edu.pl","colorcastmail.com","columbus.rr.com","columbusrr.com","columnist.com","colurmish.com","comcast.net","cometclear.com","cometlumen.com","comfythings.com","comic.com","commufa.jp","communityconnect.com","compareshippingrates.org","completegolfswing.com","comporium.net","comprendemail.com","compressjpg.io","comproa.org","compuserve.com","computer-freak.com","computer4u.com","computermail.net","comwest.de","comyze.org","comzx.com","concu.net","conexcol.com","conf.work","confmin.com","congacone312.shop","congnguyen.io.vn","conk.com","connect4free.net","connectbox.com","connected.linkpc.net","connectifyhub.sbs","connho.com","connho.net","consultant.com","consumerriot.com","contaco.org","contact.infos.st","contactbox.work","contactpage.online","contbay.com","contractor.net","contrasto.cu.cc","convergenceindia.co.in","coocuuu.food","cood.food","cooh-2.site","cookie007.fr.nf","cookiemonster.com","cool.br","coolandwacky.us","coole-files.de","coolgoose.ca","coolgoose.com","coolimpool.org","cooljump.org","coolkiwi.com","coollist.com","coolmail.com","coolmail.net","coolsend.com","coolsite.net","cooooool.com","cooperation.net","cooperationtogo.net","copacabana.com","copper.net","copyhome.win","copytosh.com","coralhost.my","corbyrise.com","coreclip.com","corhash.net","cornells.com","cornerpub.com","cornwallaerospaceeducationtrust.org","corporatedirtbag.com","correo.terra.com.gt","corridor.bond","cortinet.com","cosdas.com","cosmorph.com","cosoinan.com","coswz.com","cosycritters.co.uk","cotas.net","cotasen.com","cotigz.com","counsellor.com","countrylover.com","courriel.fr.nf","courrieltemporaire.com","cousinment.com","covisuki.icu","cox.com","cox.net","coxinet.net","coza.ro","cozilla.pw","cpc.cx","cqwbn.com","cracker.hu","crankhole.com","crapmail.org","crastination.de","craventry.cfd","crazedanddazed.com","crazespaces.pw","crazymailing.com","crazysexycool.com","crczrsxls.top","cream.pink","creative.publicvm.com","credit-loans.xyz","crepeau12.com","cresvyn.cfd","creteanu.com","crgjw3a.giize.com","cringemonster.com","cristianemail.com","critterpost.com","croeso.com","crogra.org","cross-law.ga","cross-law.gq","cross.edu.pl","crosshairs.com","crossmailjet.com","crossroadsmail.com","crosswinds.net","crunchcompass.com","cruncoau.asia","crusthost.com","crwmail.com","cry4helponline.com","crybio.com","cryptoavalonsolhub.cloud","cryptogmail.com","cs.com","cs.email","csapi.dpdns.org","csh.ro","csinibaba.hu","cslua.com","cspaus.com","cszbl.com","ctmailing.us","ctos.ch","cttnoot.us","cu.cc","cuahangvppn.shop","cuaks.fun","cubene.com","cubiclink.com","cucadas.com","cuemail.com","cuendita.com","cuirushi.org","cumnnm.us.ci","cunan.store","cuoly.com","cuongaquarium.com","cupbest.com","curio-city.com","curlhph.tk","currentmail.com","curryworld.de","cursor13402.xyz","cuscuscuspen.life","cust.in","cute-girl.com","cuteandcuddly.com","cutefrogs.xyz","cutevi.us","cutey.com","cutout.club","cutradition.com","cutsup.com","cutuvye.org","cuvox.de","cuvrs.info","cwetg.co.uk","cwsgear.com","cww.de","cx.lsa1230.dpdns.org","cxbl.top","cxioms.help","cxwet.com","cyber-africa.net","cyber-innovation.club","cyber-matrix.com","cyber-phone.eu","cyber-wizard.com","cyber4all.com","cyberbabies.com","cybercafemaui.com","cyberdude.com","cyberforeplay.net","cybergal.com","cybergrrl.com","cyberinbox.com","cyberionexus.shop","cyberleports.com","cybermail.net","cybernet.it","cyberservices.com","cyberspace-asia.com","cybertemp.cfd","cybertemp.xyz","cybertrains.org","cycinst.com","cyclefanz.com","cyclelove.cc","cyjd.top","cykr.beer","cylab.org","cyln.beer","cynetcity.com","cypi.fr","czx.one","d.729406.xyz","d1yun.com","d3p.dk","d4ngerssquy.info","d8tiya6.camdvr.org","daabox.com","dab.ro","dabeixin.com","dabsol.net","dacoolest.com","dadacasa.com","dadaolibai.eu.cc","daemonixgames.com","daemsteam.com","daerdy.com","daha.com","dahewushi.eu.cc","daibb.us","daibond.info","daily-email.com","dailynove.com","dailynutria.com","dailypioneer.com","daimuedu.com","daintly.com","dakaka.org","dalanshu.org","dallasmail.com","damai.webcam","dammexe.net","damnthespam.com","damowang.eu.cc","damphen.org","dandikmail.com","dandysworldgame.org","dangerous-minds.com","dann.mywire.org","dansegulvet.com","dantriviet.shop","dao.pp.ua","daodao.app","daouse.com","dapdigital.site","dapurx.me","dardr.com","darkemail.school","darkharvestfilms.com","darkserver.ru","daryxfox.net","dasdasdascyka.tk","dasf.bid","dash-pads.com","data54.com","dataarca.com","datadudi.com","datapinacle.com","datarca.com","datazo.ca","datchuban.top","datdonshopee.site","datenschutz.ru","datgemini.io.vn","datprovn.io.vn","datprovnn.io.vn","datum2.com","daugr.com","daum.net","dautubds.io.vn","davegracey.com","davidkoh.net","davidlcreative.com","davidtrix.biz","dawin.com","dawnsonmail.com","dawnwick.org","dawsoncountygunclub.org","dawsonmail.com","dawushihe.eu.cc","dawushihehe.eu.cc","dayizhan.top","daymail.life","daymailonline.com","dayrep.com","dazedandconfused.com","dbea.autos","dbmail.one","dboso.com","dboxmail.com","dbunker.com","dbwot.com","dbzmail.com","dcctb.com","dcemail.com","dcpa.net","dcyo.skin","dd2car.com","ddat0511.click","ddcrew.com","ddfd.fashion","ddker.com","ddsdg34.abrdns.com","de-a.org","dea-21olympic.com","deadaddress.com","deadchildren.org","deadfake.cf","deadfake.ga","deadfake.ml","deadfake.tk","deadlymob.org","deadspam.com","deagot.com","deajeng.store","deal-maker.com","dealja.com","deallabs.org","dealrek.com","deapad.com","dearriba.com","death-star.com","debitur.cam","decep.com","decodewp.com","decornido.com","dede.infos.st","deekayen.us","deenur.com","deepconverts.com","deepmails.org","deepmaster.fun","deepneko.xyz","deepyinc.com","deertees.com","defomail.com","degap.fr.nf","degar.xyz","degradedfun.net","dehaopay.com","deinbox.com","deisgn-ai.work.gd","delaeb.com","delayload.com","delayload.net","delhikabulletin.com","delikkt.de","deliveryman.com","delivrmail.com","delorex.com","deltajohnsons.com","deluxmail.com","delvionis.cfd","demen.ml","deneg.net","dengekibunko.ga","dengekibunko.gq","dengekibunko.ml","denipl.com","denipl.net","dentaguardmouthguard.com","deornaumail.com","depdocla.net","depechemode.com","der-kombi.de","derkombi.de","derluxuswagen.de","deseretmail.com","desertmail.com","desertsundesigns.com","desfrenes.fr.nf","deshnetarchadacalculator.one","designhta.work.gd","desilota.com","desiys.com","deskpilot.com","desmond.eu.cc","desoz.com","despam.it","despammed.com","destin.com","det.indevs.in","detik.com","deutschland-net.com","dev-null.cf","dev-null.ga","dev-null.gq","dev-null.ml","dev17.tech","devbike.com","developermail.com","developtool.app","devh24.online","devlug.com","devmant.com","devnullmail.com","devotedcouples.com","devpoet.com","devsonline.studio","devthien.io.vn","deyom.com","dezigner.ru","dfghjertyh.dynv6.net","dfwatson.com","dfyuih.eu.cc","dgdf.cc","dghdfjfd.eu.cc","dh372.top","dharmatel.net","dheiwuy.eu.cc","dhkt.skin","dhm.ro","dhnow.com","dhoahn.eu.cc","dhy.cc","di-ve.com","dialogus.com","diapaulpainting.com","diarshop.com","dichvuxe24h.com","dicopto.com","diddyricky.com","diddyricky.fr","diddyricky.info","diddyricky.store","die-besten-bilder.de","die-genossen.de","die-optimisten.de","die-optimisten.net","diemailbox.de","diemhenvn.com","digdig.org","digi-value.fr","digial.jo3.org","digibeast.my","digibeast.store","digibel.be","digimaster.bond","digimaster.eu.cc","diginey.com","digital-filestore.de","digital-message.com","digitaldesign.run.place","digitalesbusiness.info","digitalmail.info","digitalmariachis.com","digitalsanctuary.com","digitecy.live","dildoe.cfd","dildosfromspace.com","dim-coin.com","dimalk.com","dingbone.com","dinlaan.site","dino.icu","diolang.com","dion.ne.jp","diplom-voronesh.ru","diplomats.com","dipremin.com","directbox.com","directmail24.net","dirtracer.com","dis.hopto.org","disaq.com","disbox.net","disbox.org","discard.cf","discard.email","discard.ga","discard.gq","discard.ml","discard.tk","discardmail.com","discardmail.de","disciples.com","discofan.com","discos4.com","discoverymail.com","dishcatfish.com","disign-concept.eu","disign-revelation.com","disinfo.net","disney.ne.jp","dispatch.nothing688.de5.net","dispo.in","dispomail.eu","disposable-e.ml","disposable-email.ml","disposable.cf","disposable.com","disposable.ga","disposable.ml","disposable.site","disposableaddress.com","disposableemailaddresses.com","disposableinbox.com","disposablemails.com","dispose.it","disposeamail.com","disposely.xyz","disposemail.com","disposemymail.com","disposly.com","dispostable.com","divad.ga","divahd.com","divermail.com","divismail.ru","diwaq.com","dixz.net","diyongjin.net","dizigg.com","djiv.xyz","djwekih.eu.cc","dkz.opik.net","dldweb.info","dlemail.ru","dlwv.makeup","dm.w3internet.co.uk","dmail.one","dmailman.com","dmailp.cc.cd","dmarc.ro","dmcelements.org","dmts.fr.nf","dmxs8.com","dnainternet.net","dnbp.hair","dndent.com","dnkah.eu.cc","dns.army","dns.navy","dnsclick.com","dnses.ro","dnslog.tech","dnsmadeeasy.com","doanart.com","doantotnghiep.com","dob.jp","docash.app","docbao7.com","doclist.bounces.google.com","docmail.cz","docomo.ne.jp","docs.google.com","docse.site","doctor.com","dodgeit.com","dodgemail.de","dodgit.com","dodgit.org","dodo.com.au","dodsi.com","dog.com","dogai.qzz.io","dogclothing.org","dogit.com","dogking.dpdns.org","doglover.com","dogmail.co.uk","dogmrp.com","dogsnob.net","dohoanganh.site","doiea.com","doityourself.com","doj.one","dollicons.com","dolofan.com","dolphinnet.net","domain.com","domforfb1.tk","domforfb18.tk","domforfb19.tk","domforfb2.tk","domforfb23.tk","domforfb27.tk","domforfb29.tk","domforfb3.tk","domforfb4.tk","domforfb5.tk","domforfb6.tk","domforfb7.tk","domforfb8.tk","domforfb9.tk","domozmail.com","don.edu.pl","dona.one","dona.pw","dona.rip","doneasy.com","donebyngle.com","donemail.my.id","donemail.ru","dongqing365.com","donjuan.com","donkicode.top","dontgotmail.com","dontmesswithtexas.com","dontreg.com","dontsendmespam.de","dontsleep404.com","donumart.com","donusumekatil.com","doobb.com","doojazz.com","doquier.tk","doramail.com","doreact.com","dorothyfoundation.org","dosbee.com","dostmail.com","doszo.qzz.io","dotapodemail.com","dotcom.fr","dotman.de","dotmsg.com","dotool8.top","dotos.dev","dotslashrage.com","dott.it","dotvu.net","dotzi.net","doublemail.de","douchelounge.com","doudizhu.top","doulas.org","download-privat.de","downloadigpost.com","downloadvideoig.app","dozvon-spb.ru","dp76.com","dpfrufiwo.top","dplanet.ch","dpmstore.id.vn","dpmurt.my","dpptd.com","dprasu.sbs","dr.com","dr69.site","dragoncon.net","dramamixio.icu","draughtier.com","drdrb.com","drdrb.net","dreamadventure.org","dreamclarify.org","dreameg.com","dreamgreen.fr.nf","dreamwiz.com","dred.ru","drevo.si","drewzen.com","driftz.net","drimex.cfd","dripzgaming.com","drivetagdev.com","drivz.net","drmail.in","droggo.engineer","dronetz.com","droolingfanboy.de","dropcake.de","dropeso.com","dropinboxes.com","dropjar.com","droplar.com","dropmail.click","dropmail.me","dropoffs.org","dropons.com","dropsin.net","dropzone.com","drotposta.hu","drovantis.cfd","drovenix.cfd","drowblock.com","drugsellers.com","druzik.pp.ua","dsbe.makeup","dschat.asia","dsfsfdsfds.shop","dsgvo.party","dsgvo.ru","dshfjdafd.cloud","dshznonline.cc","dsiay.com","dsitip.com","dslab.icu","dspwebservices.com","dswe-56f.xyz","dti.ne.jp","dtvpn.dpdns.org","duam.net","dubaimail.com","dublin.com","dublin.ie","dubokutv.com","duck.com","duck2.club","duckyoursick.com","ducpham.id.vn","dudmail.com","dugmail.com","duidir.com","duk33.com","dukedish.com","dukunmodern.id","dulich360.com","dulich84.com","dulichdatlanh.com","dulichdatlanh.vn","dulieu.io.vn","dumalu.com","dumbass.nl","dump-email.info","dumpandjunk.com","dumpmail.com","dumpmail.de","dumpyemail.com","dunamispfm.org","dunkos.xyz","dunlopdriver.com","dunloprider.com","duno.com","duoley.com","durandinterstellar.com","duskmail.com","dusrui.com","dustinry.com","dustmail.net","dutchmail.com","duvips.com","duya25446.top","duyquyen.site","dv2.host","dvaren.online","dvdpit.com","dwarfmining.com","dwiworka.pro","dwp.net","dwse.edu.pl","dwseal.com","dx.jesys.net","dyceroprojects.com","dyclsr.xyz","dyebkj.eu.cc","dyera.studio","dyfgiavcrw.eu.cc","dygo.com","dygovil.com","dymarent.cfd","dynamitemail.com","dynarix.cfd","dysu.ccwu.cc","dz17.net","dz62.help","dzntn.io.vn","dztyhd.cn","e-apollo.lv","e-mail.com","e-mail.com.tr","e-mail.de","e-mail.dk","e-mail.org","e-mail.ru","e-mail.ua","e-mailanywhere.com","e-mails.ru","e-marketstore.ru","e-pool.co.uk","e-pool.uk","e-postkasten.de","e-record.com","e-tapaal.com","e-tomarigi.com","e-zmail.co.in","e.729406.xyz","e.loves-beer.com","e3z.de","e4ward.com","e6hoohs.camdvr.org","eacademia.uk","ealea.fr.nf","eanok.com","earthalliance.com","earthcam.net","earthdome.com","earthling.net","earthlink.net","earthonline.net","earthrockies.xyz","eartin.net","ease.es","eastcoast.co.za","eastcombe.org","eastmail.com","easy-trash-mail.com","easy.to","easygbd.com","easyhomefit.com","easymailer.live","easymails.cc","easynetwork.info","easypost.com","easytrashmail.com","eatmea2z.club","eay.jp","ebar.site","ebbob.com","ebeschlussbuch.de","ebflyai.com","ebnett.no","eby9h2m.giize.com","ec.rr.com","ecallheandi.com","ecardmail.com","ecbsolutions.net","echina.com","eckpcin.giize.com","ecolo-online.fr","ecompare.com","ecoverseworld.com","ecstor.com","edankeunwe.site","edfc.skin","edgepodlab.com","edgetopgrid.com","edgex.ru","edinburgh-airporthotels.com","edmail.com","edmondventures.com","ednatx.com","edny.net","edshol.net","edtnmail.com","edu-qin.ccwu.cc","edu.jstyo.com","edu.ql2.de5.net","edu.risai.store","edu.yongpeng.us.ci","educacao.te.pt","education.nyc.mn","edudingy.cfd","eduip.eu.org","edumail.edu.pl","edumail.edu.rs","edumaili.com","edumaili.edu.pl","edumaill.edu.pl","edupolska.edu.pl","edv.to","ee1.pl","ee2.pl","eedl.skin","eeedv.de","eelmail.com","eelraodo.com","eemail.eu.cc","een4dnt.ooguy.com","eewmaop.com","efdsdsdw.cloud-ip.cc","effobe.com","efxs.ca","eg.hamroemail.com","egg5233.com","egg5233.one","eggbanjos.org","eggso.click","eggsuwz.ooguy.com","eggur.com","egirl.help","egni.beer","egvoo.com","egzones.com","ehmail.com","einmalmail.de","einrot.com","einrot.de","eintagsmail.de","einzieg.site","eircom.net","eiveg.com","ekdag.com.tr","ekot.xyz","elafans.com","eldobhato-level.hu","elearningjournal.org","electro.mn","electrochillplanet.com","electrolabx.com","elerso.com","eligou.store","elisanet.fi","elitemail.org","elitepixels.store","elitevipatlantamodels.com","elixora.cfd","eljawir.com","elji.autos","elki-mkzn.ru","elobits.com","elondonteam.work.gd","elpisproject.org","elsitio.com","elumetra.cfd","elvis.com","elvisfan.com","elygifts.com","em.rc0101.site","emaii.io.vn","email-68.com","email-fake.cf","email-fake.com","email-fake.ga","email-fake.gq","email-fake.ml","email-fake.tk","email-free.online","email-jetable.fr","email-lab.com","email-london.co.uk","email-temp.com","email.biz","email.cbes.net","email.com","email.cz","email.edu.pl","email.ee","email.it","email.net","email.nothing688.ccwu.cc","email.nu","email.org","email.ro","email.ru","email.si","email.su","email.ua","email1.pro","email10p.org","email2me.net","email4u.info","email60.com","email84.com","emailabox.pro","emailacc.com","emailaccount.com","emailage.cf","emailage.ga","emailage.gq","emailage.ml","emailage.tk","emailaoa.pro","emailasia1.com","emailasso.net","emailate.com","emailawb.pro","emailax.pro","emailbbox.pro","emailbin.net","emailboxer.one","emailcbox.pro","emailchoice.com","emailcoffeehouse.com","emailcorner.net","emailcu.icu","emaildark.fr.nf","emaildbox.pro","emaildienst.de","emaildrop.io","emailem.com","emailengine.net","emailengine.org","emailer.hubspot.com","emailfake.com","emailfake.ml","emailforyou.info","emailforyou.net","emailfoxi.pro","emailfreedom.ml","emailgen.uk","emailgenerator.de","emailgo.de","emailgratisan.fun","emailgroups.net","emailhook.site","emailias.com","emailigo.de","emailinbo.live","emailinfive.com","emailisvalid.com","emailit.com","emailjps.com","emailkp.com","emaillime.com","emailluu.asia","emailmiser.com","emailmuaqat.shop","emailna.co","emailnator.com","emailnax.com","emailnow.net","emailnow.one","emailnox.live","emailo.pro","emailondeck.com","emailpinoy.com","emailplanet.com","emailplay.org","emailplus.org","emailportal.info","emailproxsy.com","emailracc.com","emailresort.com","emailrod.com","emails.ga","emails.incisivemedia.com","emails.ru","emailsecurer.com","emailsensei.com","emailsingularity.net","emailspam.cf","emailspam.ga","emailspam.gq","emailspam.ml","emailspam.tk","emailsy.info","emailtech.info","emailtemporanea.com","emailtemporanea.net","emailtemporar.ro","emailtemporario.com.br","emailthe.net","emailtik.com","emailtmp.com","emailto.de","emailuae.com","emailure.net","emailuser.net","emailvb.pro","emailviet.com","emailwarden.com","emailwww.pro","emailx.net","emailxfer.com","emaily.pro","emailz.cf","emailz.ga","emailz.gq","emailz.ml","emalupe.com","ematic.com","emaxasp.com","embarqmail.com","embege.xyz","embekhoe.com","emeil.in","emeil.ir","emeraldwebmail.com","emergencymail.site","emergentvillage.org","emil.com","emkei.cf","emkei.ga","emkei.gq","emkei.ml","emkei.tk","eml.cc","eml.pp.ua","emlhot.com","emlhub.com","emlpro.com","emltmp.com","emnet.ne.jp","emobile.ne.jp","emocan.name.tr","empireanime.ga","empva.io.vn","empva1.com","empva1.io.vn","empva11.com","empva11.io.vn","emstjzh.com","emz.net","emziegz.com","enajsndasd.eu.cc","enayu.com","end-war.com","end.tw","endingimpunity.com","endob.com","enel.net","enfq.autos","engineer.com","england.com","england.edu","englandmail.com","englishcriketclub.org.uk","enitempmail.xyz","enotj.com","enowgntg.site","enspinner.com","enterto.com","envy17.com","eoffice.top","eonet.ne.jp","eoopy.com","eosada.com","eoslux.com","eoutrbl.com","ep77.com","epaco9t.loseyourip.com","epage.ru","epatra.com","epb.ro","epbox.ru","epbox.store","epetsoft.com","ephemail.net","ephemeral.email","epix.net","epost.de","epost.no","eposta.buzz","eposta.hu","eposta.work","epostal.ru","epostal.store","epsteinisland.click","epurcf.org","eqgq.hair","eqiluxspam.ga","eqqu.com","equivara.cfd","erahods.com","eramail.co.za","ereplyzy.com","eresmas.com","ericjohnson.ml","eriga.lv","eripo.net","ernestturcotte.us","ero-tube.org","erth.nl","esadverse.com","esbano-ru.ru","esc.la","escapehatchapp.com","esemay.com","esgeneri.com","eshimod.com","esiix.com","esprity.com","estate-invest.fr","esterace.com","estranet.it","estrowebservices.com","esyline.com","etempmail.net","etenx.com","eth2btc.info","ether123.net","ethereum1.top","ethersports.org","ethersportz.info","ethos.st","etickethelpdesk.net","etics.us","etlgr.com","etoast.com","etotvibor.ru","etquakemultimedia.com","etrademail.com","etramay.com","etranquil.com","etranquil.net","etranquil.org","etubemail.com","etzg.de5.net","euaqa.com","eudoramail.com","euleina.com","eulercraft.com","euroallsports.org.uk","eurokool.com","euromail.hu","europamel.net","europe.com","europemail.com","euroseek.com","eurosport.com","euucn.com","evairo.fun","evairo.web.id","evanfox.info","eve.dpdns.org","eveav.com","every1.net","everyday.com.kh","everymail.net","everyone.net","everytg.ml","evilcomputer.com","evilgodshop.uk","evjy.skin","evnft.com","evomiserver.com","evontra.cfd","evopo.com","evusd.com","evvgo.com","evyush.com","ewebrus.com","ewma.hair","ewma.skin","exahut.com","examcentral.co.uk","examnotes.net","examstudy.xyz","exbts.com","excite.co.jp","excite.com","excite.it","exclusiveking.club","exclussi.com","exdonuts.com","execs.com","exelica.com","exemail.com.au","exespay.com","exg6.exghost.com","exhaycle.com","exile.my.id","existiert.net","exitbit.com","exitstageleft.net","exkucn.ccwu.cc","exmab.com","expiredtoaster.org","explodemail.com","expltain.com","express.net.ua","expressasia.com","extemer.com","extenda.net","extended.com","extracurricularsociety.com","extraku.com","extraku.net","extraku.shop","extremail.ru","extrset.com","exweme.com","exzork.sbs","ey-hungry.top","eycfhb.com","eyee.eu.cc","eyepaste.com","eynlong.com","eyou.com","ez.lv","ezai.chat","ezcybersearch.com","ezehe.com","ezfill.com","ezimb.com","ezmail.egine.com","ezmail.ru","ezonemail.com","ezrs.com","ezsj.hair","ezsmurf.top","ezstest.com","ezua.com","ezweb.ne.jp","ezztt.com","f-m.fm","f1b.email","f1b.vn","f1fans.net","f2b.click","f2b.email","f2b.info","f2b.site","f2b.tech","f2b.tokyo","f2b.vn","f2c.email","f2c.host","f2c.me","f2c.mobi","f2c.press","f2d.click","f2d.info","f2d.life","f2d.pro","f2e.click","f2e.email","f2e.pro","f2e.pw","f2e.world","f2f.email","f2f.pw","f3p.io.vn","f4k.es","f4wxmpu.kozow.com","f5p0y90.ooguy.com","f5url.com","f5v7u9a.ddnsfree.com","f6z6ica.camdvr.org","fabaos.com","facebook-email.cf","facebook-email.ga","facebook-email.ml","facebook.com","facebookmail.com","facebookmail.gq","facebookmail.ml","facemac.website","fackme.gq","factoryuk.org.uk","fadingemail.com","fadsfdsfaa.indevs.in","faecesmail.me","fafa.beer","fag.wf","fahr-zur-hoelle.org","failbone.com","faithkills.com","faizasoft.com","fake-box.com","fake-email.pp.ua","fake-mail.cf","fake-mail.ga","fake-mail.ml","fakedemail.com","fakeinbox.cf","fakeinbox.com","fakeinbox.ga","fakeinbox.info","fakeinbox.ml","fakeinbox.tk","fakeinformation.com","fakemail.fr","fakemail.io","fakemail.net","fakemailgenerator.com","fakemailz.com","falconryadventurecentreofeducation.com","fallinhay.com","falseaddress.com","famamail.com","fammix.com","fan.com","fanchatu.com","fanclub.pm","fandoe.com","fangoh.com","fangxiaobai.us.ci","fangxiaobai1.us.ci","fanicle.com","fansonlymail.com","fansworldwide.de","fantasticmail.com","fantastu.com","fantasy139.icu","fantasymail.de","fantatua.com","fanymail.com","fanzher.com","farah.rip","farang.net","faresfactory.com","farifluset.mailexpire.com","farouter.tech","faroweb.com","farrse.co.uk","fasl4kas3.site","fasssd.ru","fasssd.store","fast-email.com","fast-email.info","fast-mail.fr","fast-mail.org","fastacura.com","fastchevy.com","fastchrysler.com","fastem.com","fastemail.us","fastemailer.com","fastermail.com","fasternet.biz","fastest.cc","fastestflex.com","fastimap.com","fastinbox.one","fastkawasaki.com","fastmail.ca","fastmail.cn","fastmail.co.uk","fastmail.com","fastmail.com.au","fastmail.edu.pl","fastmail.es","fastmail.fm","fastmail.im","fastmail.in","fastmail.jp","fastmail.mx","fastmail.net","fastmail.nl","fastmail.se","fastmail.to","fastmail.tw","fastmail.us","fastmailbox.net","fastmazda.com","fastmessaging.com","fastmitsubishi.com","fastnissan.com","fastnodo.click","fastsearcher.com","fastservice.com","fastsubaru.com","fastsuzuki.com","fasttoyota.com","fastyamaha.com","fatcock.net","fatebd.com","fatflap.com","fathersrightsne.org","fax.ru","faxico.com","faxzu.com","faybetsy.com","fazka.ovh","fazs.skin","fbb.cool","fbb.id.vn","fbb.io.vn","fbb.kim","fbb.linkpc.net","fbb.lu","fbb.vn","fbfbs.lol","fbhotro.com","fbi-agent.com","fbi.hu","fbi.one","fbins001mail.com","fbins607.com","fbkjlnry.top","fblgsl.cam","fbma.tk","fboxmail.com","fbviamail.com","fcetpkqwm.top","fddns.ml","fdfdsfds.com","fdfggh-df5.cc","fdger88.cc","fdhsui.eu.cc","fdmail.top","fdpbnzx.cn","fdsgsd.org","fdsregre.shop","fdvctte.info","fea.st","featcore.com","fedayroi.online","federalcontractors.com","feelmyheartwithsong.com","fegoamail.com","feinripptraeger.de","feiyujingxuan.top","felicitymail.com","femailtor.com","femenino.com","fenfax.com","fengzheng.qzz.io","fentaoba.com","fenzhuai.top","fer-gabon.org","feralrex.com","ferd.live","ferdomnermail.com","feriwor.com","fermaxxi.ru","ferngrove.org","feroxid.com","fetchmail.co.uk","fettabernett.de","fettometern.com","fewzc.makeup","fexbox.org","fexbox.ru","fexpost.com","fextemp.com","feyenoorder.com","ffanet.com","ffpp.store","ffps.fun","fft.edu.do","ffyf.fashion","fgmail.cyou","fgtygcop.store","fhoau.eu.cc","fhpfhp.fr.nf","fhwui.eu.cc","fhwyuoia.eu.cc","fiallaspares.com","fiberia.com","fibmail.com","ficken.de","fictionsite.com","fidhost.com","fifafotball.org.uk","fightallspam.com","fighthunger.co.uk","fightingzebras.org","figjs.com","figshot.com","figurescoin.com","fiifke.de","fikus.work.gd","filbert4u.com","filberts4u.com","file2drive.com","filetodrive.com","filipinolinks.com","film-blog.biz","filmla.org","filzmail.com","finacenter.com","financemail.net","financier.com","findemail.info","findids.net","findize.com","findmail.com","findmeghana.org","findu.pl","finebody.com","finews.biz","fingso.com","finsmine.info","fir.hk","fira.my","fire-brigade.com","fireboxmail.lol","firemail.cc","firemail.com.br","firemailbox.club","fireman.net","firerocket.site","firstaidtrainingschool.co.uk","firstlawyer.org","fisdom.vip","fisedo.com","fishburne.org","fishfuse.com","fitbloomlab.com","fitnesrezink.ru","fitzola.com","fivemail.de","fivermail.com","fixmail.tk","fizmail.com","fj7v67f.camdvr.org","fjic.hair","fjic.skin","fkainc.com","fknm8.mobi","flaimenet.ir","flakeian.com","flameoflovedegree.com","flashbox.5july.org","flashemail.site","flashmail.com","flashmail.net","flatimostore.cloud","flavourity.com","flayeraaron.eu.cc","flayerhu.eu.cc","fleckens.hu","flemail.ru","flews.app","flexvio.com","fliegender.fish","flipcode.com","flobo.fr.nf","flock84.uk","florevia.cfd","flosek.com","flowconnect.beer","flowmail.site","flownue.com","flowu.com","flu.cc","fluidsoft.us","fluix.qzz.io","flurred.com","fly-ts.de","flyhubs.top","flyinggeek.net","flymail.tk","flyovertrees.com","flyspam.com","flywaverun.com","flyzy.net","fmail.co.uk","fmailbox.com","fmgirl.com","fmguy.com","fmuss.com","fnbmail.co.za","fncp.ru","fncp.store","fngd.hair","fnmail.com","fog.one","folderolmail.ru","folkfan.com","fommie.com","fommie.online","fommie.store","fondaror.xyz","foobarbot.net","foodmail.com","footard.com","footballgamesbd.site","footballmail.com","foothills.net","foothilltoy.site","for-president.com","for4u.net","forapps.space","forbmmend.com","force9.co.uk","fordemy.com","foreastate.com","forecastertests.com","foreskin.cf","foreskin.ga","foreskin.gq","foreskin.ml","foreskin.tk","forexnews.bg","forexru.com","forexzig.com","forfree.at","forge45k.io.vn","forgetmail.com","forgetmenotstudio.org.uk","forliion.com","formodapk.com","fornow.eu","forpresident.com","forregmail.asia","forregmail.xyz","forspam.net","fortuncity.com","fortunecity.com","forum.dk","forum.nyc.mn","forward.cat","fosil.pro","foxja.com","foxmail.com","foxnew.info","foxtrotter.info","fpgrabber.com","fpklm.com","fpt-student-support.store","fqys.hair","fr.cr","fr33mail.info","fragolina2.tk","france.edu.pl","francemel.fr","frankhealeyfoundation.org","frapmail.com","frappina.tk","frederictonlawyer.com","free-email.cf","free-email.ga","free-online.net","free-org.com","free-temp-mail.eu.org","free-temp.net","free.com.pe","free.fr","freeaccess.nl","freeaccount.com","freeandsingle.com","freebabysittercam.com","freeblackbootytube.com","freecat.net","freechal.com","freecustom.email","freedom.usa.com","freedom4you.info","freedomcentremereside.org","freedomlover.com","freedompop.us","freedrops.org","freefattymovies.com","freegates.be","freeghana.com","freegrok.cc.cd","freehotmail.net","freeimagehosts.org","freeimghost.org","freeinbox.email","freelance-france.eu","freeler.nl","freeletter.me","freemail.c3.hu","freemail.com.au","freemail.com.pk","freemail.de","freemail.et","freemail.gr","freemail.hu","freemail.it","freemail.lt","freemail.ms","freemail.ne.jp","freemail.nl","freemail.org.mk","freemails.cf","freemails.ga","freemails.ml","freemails.pp.ua","freemeil.ga","freemeil.gq","freemeil.ml","freeml.net","freemyops.com","freenet.de","freenet.kg","freeola.com","freeola.net","freeplumpervideos.com","freerubli.ru","freeschoolgirlvids.com","freeserve.co.uk","freesistercam.com","freesourcecodes.com","freestart.hu","freesurf.fr","freesurf.nl","freeteenbums.com","freetimer.online","freeuk.com","freeuk.net","freeukisp.co.uk","freeweb.org","freewebemail.com","freeyellow.com","freezone.co.uk","fresnomail.com","freudenkinder.de","freundin.ru","friday12.store","friendlymail.co.uk","friends-cafe.com","friendsfan.com","friendsofbram.com","frisurf.no","frive.site","frm.ovh","from-africa.com","from-america.com","from-argentina.com","from-asia.com","from-australia.com","from-belgium.com","from-brazil.com","from-canada.com","from-china.net","from-england.com","from-europe.com","from-france.net","from-germany.net","from-holland.com","from-israel.com","from-italy.net","from-japan.net","from-korea.com","from-mexico.com","from-outerspace.com","from-russia.com","from-spain.net","fromalabama.com","fromalaska.com","fromarizona.com","fromarkansas.com","fromcalifornia.com","fromcolorado.com","fromconnecticut.com","fromdelaware.com","fromflorida.net","fromgeorgia.com","fromhawaii.net","fromidaho.com","fromillinois.com","fromindiana.com","fromiowa.com","fromjupiter.com","fromkansas.com","fromkentucky.com","fromlouisiana.com","frommaine.net","frommaryland.com","frommassachusetts.com","frommiami.com","frommichigan.com","fromminnesota.com","frommississippi.com","frommissouri.com","frommontana.com","fromnebraska.com","fromnevada.com","fromnewhampshire.com","fromnewjersey.com","fromnewmexico.com","fromnewyork.net","fromnorthcarolina.com","fromnorthdakota.com","fromohio.com","fromoklahoma.com","fromoregon.net","frompennsylvania.com","fromrhodeisland.com","fromru.com","fromsouthcarolina.com","fromsouthdakota.com","fromtennessee.com","fromtexas.com","fromthestates.com","fromutah.com","fromvermont.com","fromvirginia.com","fromwashington.com","fromwashingtondc.com","fromwestvirginia.com","fromwisconsin.com","fromwyoming.com","front.ru","front14.org","frontier.com","frontiernet.net","frostbyte.uk.net","frostmail.fr.nf","frostypeak.info","fruitservice.xyz","frwdmail.com","frza.me","fsercure.online","fsitip.com","fsmail.net","fsotl.icu","ftc-i.net","fthcapital.com","ftlz.hair","ftml.net","ftp.sh","ftpinc.ca","ftrh.skin","fuckedupload.com","fuckingduh.com","fucklinuxdo.com","fuckme69.club","fuckneo.org","fucknloveme.top","fuckxxme.top","fudgerub.com","fudier.com","fuirio.com","fuk996.icu","fukaru.com","fukurou.ch","fullangle.org","fullmail.com","fulvie.com","fulwark.com","fumemail.com","fun4k.com","fun64.com","fundapk.com","fundproceed.com","funkfan.com","funnycodesnippets.com","funnyfail.app","funnylolcap.com","funnylolcap.fr","funnylolcap.org","funnylolcap.store","funnymail.abrdns.com","funnymail.de","funteka.com","fuorissimo.com","furnitureprovider.com","furzauflunge.de","fuse.net","fusioninbox.com","fut.es","futcost.online","futcost.ru","futuramind.com","fuvk.ru","fuvk.store","fuwa.be","fuwa.li","fuwamofu.com","fuwari.be","fux0ringduh.com","fviadropinbox.com","fviainboxes.com","fviamail.com","fviamail.work","fvz7wvh.ddnsfree.com","fwnb.com","fxavaj.com","fxnxs.com","fxos.hair","fxsmails.com","fxt.ink","fxtubes.com","fxxf.beer","fxzig.com","fyawmtu.camdvr.org","fycloud.online","fyeiwh.eu.cc","fyii.de","fynix.sbs","fyronex.cfd","fznb.hair","g-mail.biz.id","g-mail.kr","g0pg02x.theworkpc.com","g14l71lb.com","g1xmail.top","g2xmail.top","g3xmail.top","g4hdrop.us","g947lzu.kozow.com","gacharevenue.cc","gafy.net","gagcalculator.me","gage.ga","gailiuzi.icu","gakhum.com","galaxim.fr.nf","galaxy.tv","galaxy5.com","galaxyhit.com","galebird.cc.cd","gally.jp","gam1fy.com","gamadaiz.shop","gamail.top","gamapa.asia","gamebcs.com","gamebox.net","gamegeek.com","gamegregious.com","gamen.me","gamening.com","gamepec.com","gamerai.shop","gamerai.space","gamerai.website","gamershubcloud.com","gamesense.eu.cc","gamespotmail.com","gamgling.com","gamno.config.work","gandobaba.bond","ganlin.shop","garap.id","garasikita.pw","garbage.com","garbagecollector.org","garbagemail.org","gardener.com","gardenscape.ca","gardu.codes","garizo.com","garliclife.com","garod1.xyz","garrymccooey.com","gashoainam.io.vn","gassmail.com","gasuda.com","gav0.com","gavrom.com","gawab.com","gaxetovemail.com","gaybrighton.co.uk","gaza.net","gazeta.pl","gazibooks.com","gbcmail.win","gblw.site","gbmail.top","gbui.autos","gcervera.com","gcfv.skin","gci.net","gcmail.top","gcpfas.shop","gcphanter.skin","gcpmakerds.cyou","gcpowner.online","gcpripon.space","gcpriponteam.xyz","gcptoday.xyz","gdcrm.store","gddp2018.edu.vn","gdfgergrer.online","gdmail.top","gdmo.autos","gdqoe.net","gdxs.cc.cd","gear3.pro","gebrauchtwarencenter.com","gedmail.win","geecities.com","geek.com","geek.hu","geekforex.com","geeklife.com","geeksun.us.ci","geew.ru","gehensiemirnichtaufdensack.de","geldwaschmaschine.de","gelitik.in","gemapan.com","gemipro1.store","gemmarosefoundation.co.uk","gemniultra.me","gencmail.com","gendeng.indevs.in","genderfuck.net","general-hospital.com","generator.email","generator1email.com","gentleinfopath.com","gentlemansclub.de","genzmaile.com","genzotp.com","genztrang.com","geocities.com","geography.net","geologist.com","geometrics.icu","geopia.com","georgefletcher.org.uk","georgeheddon.co.uk","germanymail.com","geronra.com","gerv.app","geschent.biz","get-mail.cf","get-mail.ga","get-mail.ml","get-mail.tk","get.pp.ua","get1mail.com","get2mail.fr","getai-hub.com","getairmail.cf","getairmail.com","getairmail.ga","getairmail.gq","getairmail.ml","getairmail.tk","getasail.com","getbloomdata.com","getbox89.xyz","geteit.com","getemail.space","getfun.men","getgptcode.com","getmail.my.id","getmail.no","getmail1.com","getmailfree.cc","getmails.eu","getmails.top","getmule.com","getnada.cc","getnada.com","getnada.net","getnowtoday.cf","getol.pro","getonemail.com","getonemail.net","getotp.fun","getover.de","getsimpleemail.com","gett.icu","gewalusitest1.cloud-ip.cc","gexik.com","gghjnvgfyjhk.top","ggmal.ml","ggoop69.kozow.com","ggrainn.com","ggt55.ggff.net","ggu6ctm.ooguy.com","ggvendas.store","ggvk.ru","ggvk.store","ggxg.fashion","ggxhunter.com","ghanamail.com","ghfnhcf.xyz","ghk55.us","gholar.com","ghostmail.com","ghosttexter.de","ghvv.click","gi-mel.web.id","giacmosuaviet.info","giaiphapmuasam.com","giantmail.de","giare.fun","gifto12.com","giga4u.de","gigileung.org","gilberta.syrf109475.top","gimbmail.com","gimme-cooki.es","gimpmail.com","gimuemoa.fr.nf","ginzi.be","ginzi.co.uk","ginzi.es","ginzi.net","ginzy.co.uk","ginzy.eu","giodaingan.com","gioidev.news","giratex.com","girl4god.com","girlfriend.ru","girlmail.win","girlsindetention.com","girlsundertheinfluence.com","gishpuppy.com","gislinghamsilverband.com","github-com-disposable-email-domains.loseyourip.com","giue.hair","giveh2o.info","givehit.com","givememail.club","givemetoken.xin","givepeaceachance.com","givmail.com","gixenmixen.com","gixpos.com","gkd2323c.in","gkyd3vu.loseyourip.com","gladogmi.fr.nf","glasswhitehub.com","glaventra.cfd","glaviu.icu","glay.org","glcspp.top","glendale.net","gli.dpdns.org","glitch.sx","global-1.huggingface.qzz.io","globalbizflow.com","globalfree.it","globalpagan.com","globalsite.com.br","globaltouron.com","glorylandconnections.com","gls-info.help","glubex.com","glucosegrin.com","gmaail.icu","gmaiil.top","gmail-xsniper.com","gmail-xsniper.site","gmail-xsniper.space","gmail.2kkkk.cn","gmail.com","gmail.com.br","gmail.h5ma.cn","gmail.or.at","gmail.ru","gmail2.gq","gmailedu.us","gmailinsta.com","gmaill.click","gmaill.vn","gmaillive.cloud","gmaillk.com","gmailold.com","gmailot.com","gmailxsn.com","gmailxsn.site","gmailxsn.space","gmailxyz.bond","gmali.online","gmatch.org","gmeenramy.com","gmel.biz.id","gmel.my.id","gmells.com","gmial.com","gmneel.eu.cc","gmx-ist-cool.de","gmx-topmail.de","gmx.at","gmx.ca","gmx.ch","gmx.co.uk","gmx.com","gmx.de","gmx.es","gmx.fr","gmx.hk","gmx.ie","gmx.li","gmx.net","gmx.pt","gmx.sg","gmx.tw","gmx.us","gmx1mail.top","gmxmail.top","gmxmail.win","gnctr-calgary.com","gng.edu.pl","gni8.com","gnwzqaz.shop","go.com","go.ro","go.ru","go2farm.io.vn","go2net.com","go2usa.info","go2vpn.net","goalmillion.online","goatmail.uk","gob.re","gocollege.com","gocubs.com","godfare.com","godulygmail.com","goemailgo.com","goeschman.com","gofree.co.uk","gohivezone.com","gokublue.me","gol.com","golano2.co.uk","gold.edu.pl","goldenmagpies.com","goldenmail.ru","goldinbox.net","goldivis.work.gd","goldmail.ru","goldtoolbox.com","golemico.com","goleudy.org.uk","golfemail.com","golfilla.info","golfmail.be","goliszek.net","gomail.in","gomomy.sbs","gonavy.net","gongjua.com","gonida.co.uk","gonida.com","gonida.uk","gonrr.net","gonw3bb.camdvr.org","goodjzy.art","goodnewsmail.com","goodstick.com","googl.win","googlegroups.com","googlemail.com","goomail.club","goonby.com","gooner.cat","goplay.com","goplaygame.ru","gorillaswithdirtyarmpits.com","gorontalo.net","goround.info","gosarlar.com","gospelfan.com","gossipglove.uk","gosuslugi-spravka.ru","gothere.biz","gothere.uk.com","gotmail.com","gotmail.net","gotmail.org","gotomy.com","gotrak.org","gotti.otherinbox.com","goulink.com","gowcp.com","gowikibooks.com","gowikicampus.com","gowikicars.com","gowikifilms.com","gowikigames.com","gowikimusic.com","gowikinetwork.com","gowikitravel.com","gowikitv.com","gportal.hu","gpt-mail-free-1200.dynv6.net","gpt-mail-free-140.dynv6.net","gpt-mail-free-1427.dynv6.net","gpt-mail-free-1550.dynv6.net","gpt-mail-free-161.dynv6.net","gpt-mail-free-1694.dynv6.net","gpt-mail-free-1721.dynv6.net","gpt-mail-free-1980.dynv6.net","gpt-mail-free-1998.dynv6.net","gpt-mail-free-2019.dynv6.net","gpt-mail-free-2049.dynv6.net","gpt-mail-free-2109.dynv6.net","gpt-mail-free-2141.dynv6.net","gpt-mail-free-2307.dynv6.net","gpt-mail-free-2310.dynv6.net","gpt-mail-free-2375.dynv6.net","gpt-mail-free-248.dynv6.net","gpt-mail-free-2491.dynv6.net","gpt-mail-free-3.dynv6.net","gpt-mail-free-3074.dynv6.net","gpt-mail-free-3093.dynv6.net","gpt-mail-free-3127.dynv6.net","gpt-mail-free-3291.dynv6.net","gpt-mail-free-3330.dynv6.net","gpt-mail-free-3348.dynv6.net","gpt-mail-free-3476.dynv6.net","gpt-mail-free-3527.dynv6.net","gpt-mail-free-366.dynv6.net","gpt-mail-free-3792.dynv6.net","gpt-mail-free-3927.dynv6.net","gpt-mail-free-4111.dynv6.net","gpt-mail-free-4547.dynv6.net","gpt-mail-free-4771.dynv6.net","gpt-mail-free-4775.dynv6.net","gpt-mail-free-4788.dynv6.net","gpt-mail-free-4821.dynv6.net","gpt-mail-free-4900.dynv6.net","gpt-mail-free-5018.dynv6.net","gpt-mail-free-5182.dynv6.net","gpt-mail-free-5211.dynv6.net","gpt-mail-free-5226.dynv6.net","gpt-mail-free-5241.dynv6.net","gpt-mail-free-5261.dynv6.net","gpt-mail-free-5386.dynv6.net","gpt-mail-free-5406.dynv6.net","gpt-mail-free-551.dynv6.net","gpt-mail-free-5539.dynv6.net","gpt-mail-free-561.dynv6.net","gpt-mail-free-5659.dynv6.net","gpt-mail-free-574.dynv6.net","gpt-mail-free-5902.dynv6.net","gpt-mail-free-6067.dynv6.net","gpt-mail-free-610.dynv6.net","gpt-mail-free-6221.dynv6.net","gpt-mail-free-6289.dynv6.net","gpt-mail-free-6320.dynv6.net","gpt-mail-free-6342.dynv6.net","gpt-mail-free-6397.dynv6.net","gpt-mail-free-6419.dynv6.net","gpt-mail-free-6603.dynv6.net","gpt-mail-free-6664.dynv6.net","gpt-mail-free-6691.dynv6.net","gpt-mail-free-6779.dynv6.net","gpt-mail-free-6812.dynv6.net","gpt-mail-free-6925.dynv6.net","gpt-mail-free-6962.dynv6.net","gpt-mail-free-7208.dynv6.net","gpt-mail-free-7298.dynv6.net","gpt-mail-free-7493.dynv6.net","gpt-mail-free-7548.dynv6.net","gpt-mail-free-7572.dynv6.net","gpt-mail-free-7582.dynv6.net","gpt-mail-free-7689.dynv6.net","gpt-mail-free-7939.dynv6.net","gpt-mail-free-8015.dynv6.net","gpt-mail-free-8049.dynv6.net","gpt-mail-free-8591.dynv6.net","gpt-mail-free-86.dynv6.net","gpt-mail-free-861.dynv6.net","gpt-mail-free-8611.dynv6.net","gpt-mail-free-8671.dynv6.net","gpt-mail-free-8773.dynv6.net","gpt-mail-free-8786.dynv6.net","gpt-mail-free-8791.dynv6.net","gpt-mail-free-882.dynv6.net","gpt-mail-free-8886.dynv6.net","gpt-mail-free-8933.dynv6.net","gpt-mail-free-8944.dynv6.net","gpt-mail-free-902.dynv6.net","gpt-mail-free-9243.dynv6.net","gpt-mail-free-9307.dynv6.net","gpt-mail-free-9446.dynv6.net","gpt-mail-free-9502.dynv6.net","gpt-mail-free-9515.dynv6.net","gpt-mail-free-9584.dynv6.net","gpt-mail-free-9609.dynv6.net","gpt-mail-free-9620.dynv6.net","gpt-mail-free-9695.dynv6.net","gpt-mail-free-9825.dynv6.net","gpt-mail-free-9935.dynv6.net","gpt-mail.myftp.org","gpt20260701.top","gptmail.cc.cd","gptmail.us.ci","gptmail.webredirect.org","gptworkone.dev","gpxmail.win","gqov.top","grabafilafoundation.org","gracetvglobal.com","graduate.org","graffiti.net","gramszu.net","grandmamail.com","grandmasmail.com","graphic-designer.com","graphicanal.site","graphicbulk.site","graphicdany.site","graphicedge.click","graphicedge.io.vn","graphicedge.site","graphicedge.tokyo","graphicenda.site","graphiclean.click","graphiclean.io.vn","graphiclean.site","graphiclean.tokyo","graphiclens.site","graphiclever.site","graphicmen.site","grapplers.com","grassdev.com","gratisweb.com","gravexia.cfd","gravityengine.cc","great-host.in","greencafe24.com","greendike.com","greenhousemail.com","greenmail.net","greensloth.com","greenvin.io.vn","greggamel.com","greggamel.net","gregorsky.zone","gregorygamel.com","gregorygamel.net","grendel.qzz.io","grewq.makeup","grimstroke.me","grish.de","gristod.my","griuc.schule","grn.cc","groklan.com","groupbuff.com","groupmail.com","grqccqbwg.top","grr.la","grtd.beer","grthost.top","gruene-no-thanks.xyz","grugrug.ru","grungecafe.com","gruz-m.ru","gs-arc.org","gsoleyfoyle.org.uk","gsredcross.org","gsrv.co.uk","gsttony.shop","gsxstring.ga","gthyjuytr.dynv6.net","gtmc.net","gts.cc.cd","gua.net","guanshuyun.com","gudanglowongan.com","guddu.live","gudri.com","guerillamail.biz","guerillamail.com","guerillamail.de","guerillamail.info","guerillamail.net","guerillamail.org","guerillamailblock.com","guerrillamail.biz","guerrillamail.com","guerrillamail.de","guerrillamail.info","guerrillamail.net","guerrillamail.org","guerrillamailblock.com","guessmail.com","gufacoding.com","gufum.com","guima2.asia","guju.net","gukox.org","guozivpn.cc.cd","gustr.com","guy.com","guy2.com","guyanafriends.com","guysmail.com","guzukll.camdvr.org","gxemail.men","gxmail.top","gxybkq6.theworkpc.com","gyan-netra.com","gykf.hair","gyknife.com","gynzi.co.uk","gynzi.es","gyorsposta.com","gyorsposta.hu","gzb.ro","gzeos.com","h-mail.us","h0tmaii.com","h2beta.com","h8s.org","ha92.store","hab-verschlafen.de","haben-wir.com","habenwir.com","habitnestguide.com","habitue.net","habmalnefrage.de","hacccc.com","hackermail.com","hackermail.net","hackersquad.tk","hacknapp.com","hackthatbit.ch","hahawrong.com","haibabon.com","haibaipei.ccwu.cc","haida-edu.cn","hailmail.net","hailu.publicvm.com","hairdresser.net","hairs24.ru","halamaridfcfs.site","halashao1.dpdns.org","halashao3.us.ci","halcroft.org","haleloya.site","halionex.cfd","haloforge.info","haloforge.online","haltospam.com","hamham.uk","hamptonroads.com","hanafos.com","hananet.net","handbag.com","handleit.com","handrik.com","handsofhelpinc.org","hang-ten.com","hanghai232.shop","hangxomcuatoilatotoro.ml","hanha.kozow.com","hanmail.net","hanmail2.net","hanmir.com","hanoinet.io.vn","happemail.com","happiseektest.com","happy-new-year.top","happy2023year.com","happy9toy.com","happycounsel.com","happydomik.ru","happyheadshed.org","happyhome.eu.cc","happyhorsespace.shop","happypuppy.com","haqimi.cc.cd","harakirimail.com","hardcorefreak.com","hardwork.icu","haren.uk","haribu.com","harpix.org.uk","hartbot.de","hasanmail.ml","hastana.com","hat-geld.de","hatespam.org","hathitrannhien.edu.vn","haugnett.no","havaim.com","havefundarling.xyz","havertz.tk","hawaii.rr.com","hawaiiantel.net","hawrong.com","haxaim.com","haydoo.com","hayys.app","hazelnut4u.com","hazelnuts4u.com","hazmat.help","hazmatshipping.org","hbehs.com","hcap.ai","hccmail.win","hccpcar.com","hcypku.cloud","hdcroom.us","hdiscord.xyz","headstrong.de","healingheartmission.org","healthforwomen.info","healxo.org","heartthrob.com","heathenhammer.com","heathenhero.com","hebase.com","hecat.es","heerschap.com","heesun.net","hehe.com","heheee.com","heirfoundation.com","heisei.be","hello.hu","hello.net.au","hello.to","hellodns.site","hellodream.mobi","helloricky.com","hellosravan.in","helpinghandtaxcenter.org","helpjobs.ru","helpthechildren.uk","helter-skelter.com","heocondeisng.cc","herclan.com","herediano.com","herilev.top","herlan.co.uk","herono1.com","heros3.com","herp.in","herpderp.nl","herr-der-mails.de","hertz.ltd","hesoyam.shop","hethongtudong.store","hetnet.nl","hetzez.com","hey.com","hey.to","heycmm.cn","heyzalo.vn","hezll.com","hfogzua.top","hgu717.ninja","hh7f.com","hhan.top","hhdevel.com","hhe.org.uk","hhyru.us","hi-ho.ne.jp","hi2.in","hi5.si","hiddentragedy.com","hideam.com","hidebox.org","hidebusiness.xyz","hidemail.de","hidemail.pro","hidemail.us","hidesit.net","hidesmail.net","hidevak.com","hidingmail.net","hidmail.org","hidzz.com","hiemail.net","hieu.in","hieuclone.net","highapes.run.place","highbros.org","higher-tech.linkpc.net","highmilton.com","highquality.com","highstar.shop","hightech.jo3.org","highveldmail.co.za","higogoya.com","higuruma.site","hihi.lol","hikuhu.com","hilarious.com","hillaxiant.xyz","hilmipremindo.com","hilostar.com","hiltonvr.com","him6.com","himacreative.id","himail.infos.st","himail.online","hiphopfan.com","hiredify.com","hispavista.com","histartool.com","hitbase.net","hitbtcpool.cloud","hitel.net","hitmail.com","hitthe.net","hiverun.io","hjdkker-kdet.click","hkg.net","hkstarphoto.com","hkuv.skin","hkvtop.us","hldrive.com","hlkes.com","hmail.us","hmamail.com","hmh.ro","hnfw-ngd.top","hnfw-ngd.wiki","hoanggiaanh.com","hoanglong.tech","hochsitze.com","hockeymail.com","hohohim.com","hoichvu.ddnsfree.com","hokyflix.site","hola.org","holio.day","holl.ga","hollywoodkids.com","holmes.de5.net","home-email.com","home.de","home.nl","home.no.net","home.ro","home.se","homecut.pro","homehappy.eu.cc","homelocator.com","homemail.com","homestartbromley.org.uk","homestead.com","homewiseleaf.com","homewrt.xx.kg","homvela.com","honduras.com","honesthirianinda.net","honeypie.store","honeys.be","hongkong.com","hongsemeixi.us.ci","honor-8.com","hook2ad.com","hookmono.click","hookup.net","hooooooo.store","hoopsmail.com","hopemail.biz","hopesx.com","horizonspost.com","hormails.com","hornhorizon.com","hornyalwary.top","horrormail.com","horsgit.com","host1s.com","hostcalls.com","hostguru.top","hosthalting.lol","hosthalting.site","hosthalting.store","hostingmail.me","hostlaba.com","hostpapa.dynv6.net","hot-mail.cf","hot-mail.ga","hot-mail.gq","hot-mail.ml","hot-mail.tk","hot-shot.com","hot.ee","hotbot.com","hotboyckdh.shop","hotboyckdh1122.shop","hotboyckdhn55.shop","hotbrev.com","hotelpiesi.pro","hotelplazer.com","hotelplazer.fr","hotelplazer.org","hotelplazer.store","hotfire.net","hotletter.com","hotlinkimg.com","hotmai.com","hotmail-us.top","hotmail.be","hotmail.ca","hotmail.ch","hotmail.co","hotmail.co.il","hotmail.co.in","hotmail.co.jp","hotmail.co.kr","hotmail.co.nz","hotmail.co.th","hotmail.co.uk","hotmail.co.za","hotmail.com","hotmail.com.au","hotmail.com.br","hotmail.com.tr","hotmail.cz","hotmail.de","hotmail.dk","hotmail.es","hotmail.fi","hotmail.fr","hotmail.gr","hotmail.hu","hotmail.it","hotmail.jp","hotmail.kg","hotmail.kz","hotmail.my","hotmail.nl","hotmail.no","hotmail.ph","hotmail.ru","hotmail.se","hotmail.sg","hotmailproduct.com","hotmailtrusted.com","hotmeil.net","hotmial.com","hotpop.com","hotpop3.com","hotprice.co","hotrokh.com","hotsmial.click","hotsoup.be","hottchurch.org.uk","hottmat.com","hotvoice.com","housat.com","housemail.com","housereformas.es","howardgiving.org","hpari.com","hpc.tw","hpj4l28.loseyourip.com","hqfi.hair","hqid.homes","hqpdf.com","hripleh.us.ci","hrisland.com","hs.vc","hsmw.net","hsuchi.net","ht.cx","hta.2bd.net","hta.publicvm.com","hthlm.com","htmail.store","http.nyc.mn","httpsgreenwichmeantime.in","hu2.ru","huage.me","hualabtech.com","huangao.xyz","huangniu8.com","hubaiclass.org","hubglee.com","hubhost.store","hudfcaf.nsmjj.cc.cd","hudisk.com","hudska.dpdns.org","hudzer.com","hughes.net","huizk.com","hukkmu.tk","hulapla.de","hulisang.edu.kg","hulkteam.cyou","huluwaaaron.eu.cc","humaility.com","humanoid.net","humn.ws.gy","hungpackage.com","hungtpt.site","hunnur.com","hunsa.com","huolala.de5.net","huongdanfb.com","huongvemientrung.store","huoyumars.cc.cd","hurting.com","hush.com","hushmail.cf","hushmail.com","huskion.net","husng-kang.top","hutathuww.org","hutdot.com","hutudns.com","huychau.click","huychau.online","huynhlx.shop","huynhtran.io.vn","huytuyen.click","huytuyen.online","huytuyen.site","huyvillafb.online","hvastudiesucces.nl","hvhg.skin","hviy.skin","hvva.hair","hwax4h4.giize.com","hwqmh2g.ddnsfree.com","hwsye.net","hxopi.ru","hxopi.store","hygle.net","hyhotmail.ccwu.cc","hymenjj.cfd","hypenated-domain.com","hypernautica.com","i-connect.com","i-dork.com","i-france.com","i-love-you-3000.net","i-mail.com.au","i-p.com","i.am","i.softbank.jp","i.ua","i0mn8cx.mywire.org","i12.com","i2b.asia","i2b.cam","i2b.com.vn","i2b.email","i2b.fun","i2b.id.vn","i2b.info","i2b.io.vn","i2b.lol","i2b.lu","i2b.mov","i2b.pw","i2b.space","i2b.vn","i2bgmail.com","i2c.email","i2c.pw","i2c.vn","i2i.vn","i2m.email","i2m.vn","i2n.vn","i2p.vn","i2pmail.org","i2u.vn","i2x.vn","i6.cloudns.cc","iaciu.com","iafu.hair","iafu.skin","iamawoman.com","iamwaiting.com","iamwasted.com","iamyours.com","iandsec.cc.cd","iaoss.com","iapapi.com","ib.lowdn.com","ibande.xyz","ibmdoors.com","ibmdoors.com.cn","ibnuh.bz","ibolinva.com","ibymail.com","icantbelieveineedtoexplainthisshit.com","icbr.us","iceans.cc.cd","icelandgcp.org.uk","icemail.club","icestorm.com","ich-bin-verrueckt-nach-dir.de","ich-essen-fleisch.bio","ich-will-net.de","ichecker.tech","ichigo.me","icidroit.info","ickletonrelief.co.uk","ickletonrelief.shop","icloud.com","icloudmail.kr","icloulb.com","icmans.com","icmsconsultants.com","iconmal.com","icotz.com","icousd.com","icq.com","icqmail.com","icrazy.com","icubik.com","icwr.beer","icx.in","icx.ro","icznn.com","id-base.com","ideuse.com","idf.ovh","idfd.live","idg.io.vn","ididitmyway.com","idigjesus.com","idirect.com","idns7v8.ooguy.com","idont.date","idu4aa4.info","idx4.com","idxue.com","ieatspam.eu","ieatspam.info","ieh-mail.de","iencm.com","iespana.es","ifeq.hair","iffymedia.com","ifoward.com","ifoxdd.com","ig.com.br","ige.es","igg.biz","ignazio.it","ignmail.com","ignoremail.com","igty.autos","ihateclowns.com","ihateyoualot.info","ihazspam.ca","ihc3znb.theworkpc.com","iheartspam.org","ihnpo.food","ihra.hair","ii.dickdns.org","iij4u.or.jp","iinboxes.com","iinet.net.au","iivyll.cc.cd","iivylls.cc.cd","ijustdontcare.com","ikbenspamvrij.nl","ikewe.com","ikomail.com","ikuncode.eu.cc","ikuromi.com","ilck.hair","ilcvn.cn","ilkposta.com","illistnoise.com","illnessth.com","illubd.com","ilovechocolate.com","iloveion.com","ilovejesus.com","ilovespam.com","ilovetocollect.net","iloveyou2.fun","ilse.nl","ilyx7j5.theworkpc.com","im5z.com","imaanpharmacy.com","imac.sfanrj.cfd","imagenbox.xyz","imagic.wiki","imaginemail.com","imail.edu.pl","imail.edu.vn","imail.ru","imail1.net","imailbox.com","imails.asso.st","imails.info","imailt.com","imap-mail.com","imap.cc","imap.fr.nf","imapmail.org","imashr.com","imbo.hair","imc.io.vn","imel.org","imfaya.com","img-free.com","imgfx.art","imgof.com","imgv.de","immo-gerance.info","imnart.com","imneverwrong.com","imperialcnk.com","importemail.com","imposter.co.uk","imranbt.store","imranccnn.buzz","imrancm.buzz","imrancumi.buzz","imranking.buzz","imranmax.buzz","imranspc.buzz","imstations.com","imstressed.com","imtoosexy.com","imul.info","imxwe.com","in-box.net","in-ulm.de","in2jesus.com","in2reach.com","inactivemachine.com","iname.com","inbax.tk","inbound.plus","inbox.com","inbox.lt","inbox.lv","inbox.net","inbox.ru","inbox.si","inbox.testmail.app","inbox.uron.de5.net"]');
INSERT INTO affiliation_free_email_domains (domain) SELECT value FROM json_each('["inbox2.info","inboxalias.com","inboxbear.com","inboxclean.com","inboxclean.org","inboxdesign.me","inboxed.im","inboxed.pw","inboxfast.space","inboxfly.space","inboxkitten.com","inboxly.website","inboxnow.ru","inboxnow.store","inboxopen.space","inboxorigin.com","inboxproxy.com","inboxstore.me","incamail.com","inclick.net","inclusiveprogress.com","incognitomail.com","incognitomail.net","incognitomail.org","incq.com","incredimail.com","inctart.com","ind.st","indamail.hu","indeedemail.com","inderpalsandhu.com","indevgo.com","index-mail.com","index.ua","indexa.fr","india.com","indianahorsecouncil.org","indiatimes.com","indieclad.com","indigobook.com","indirect.ws","indo-mail.com","indocities.com","indomaed.pw","indomail.com","indomina.cf","indoserver.stream","indosukses.press","indoxs.bond","indsec.online","indyracers.com","ineec.net","inerted.com","inet.com","inet.net.au","inetopenwrt.dpdns.org","infix1.io.vn","inflyratech.site","info-media.de","info-radio.ml","info66.com","infobuzzsite.com","infocom.zp.ua","infohq.com","infoisp.me","infolinewest.com","infomail.es","infomart.or.jp","infoseek.co.jp","infoseek.jp","infospacemail.com","infovia.com.ar","infoweb.ne.jp","ingam.online","inggo.org","inicia.es","inilogic.com","init.ink","inkiny.com","inkomail.com","inlook.cloud","inly.vn","inmail.sk","inmail24.com","inmano.com","inmune.ddns.net","inmynetwork.tk","innocent.com","innovationvirtuelle.asia","inorbit.com","inoutbox.com","inoutmail.de","inoutmail.eu","inoutmail.info","inoutmail.net","inpwa.com","inreur.com","insanony.art","insanony.one","insanony.store","insanumingeniumhomebrew.com","insgrmail.site","inshuan.com","insidebaltimore.net","insight.rr.com","insorg-mail.info","instaddr.ch","instaddr.uk","instaddr.win","instagr.vn","instagra.vn","instagram.io.vn","instance-email.com","instant-mail.de","instantblingmail.info","instantemailaddress.com","instantletter.net","instantmail.fr","instmail.uk","instrete.com","instruction.com","instructor.net","insurer.com","intady.com","interburp.com","interfree.it","interia.eu","interia.pl","interlap.com.ar","intermail.co.il","internet-e-mail.com","internet-mail.org","internet-police.com","internet-v-stavropole.ru","internetbiz.com","internetdrive.com","internetegypt.com","internetemails.net","internetkeno.com","internetmailing.net","internetoftags.com","internode.on.net","interstats.org","intersteller.com","intlgalleryheritageculture.org","intobx.com","intopwa.com","intopwa.net","intopwa.org","introex.com","invalid.com","inversiq.cfd","investore.co","inwagit.com","inwind.it","inxout.dpdns.org","iobox.com","iobox.fi","ioioioio.sbs","iojn.hair","iol.it","iol.pt","iolq.top","ionolenonos.com","ionolenonos.fr","ionolenonos.info","ionolenonos.store","ionq.pl","iopia.org","iotf.net","iowaemail.com","iozak.com","ip3.com","ip4.pp.ua","ip6.pp.ua","ipad.sfanrj.cfd","ipaddressforme.com","iphone.sfanrj.cfd","ipinf.eu.org","ipoo.org","ippals.com","ippandansei.tk","iprimus.com.au","ipsur.org","ipusgo.cfd","ipxwan.com","iqec.skin","iqemail.com","iqfucsod.top","iqxu.hair","irabops.com","iralborz.bid","irangate.net","iraniandsa.org","iraqedu.online","iraqmail.com","irc.so","irealiy.cyou","ireland.com","irelandmail.com","iremail.de","iridales.com","irinakicka.site","irish2me.com","irishspringrealty.com","irj.hu","iroid.com","ironbrookco.com","ironiebehindert.de","irpine.com","irssi.tv","is.af","isdaq.com","isellcars.com","isep.fr.nf","iservejesus.com","isfew.com","ishop2k.com","islamonline.net","isleuthmail.com","ismart.net","ismartsense.online","isonfire.com","isosq.com","isp9.net","ispeedtest.digital","israelmail.com","israeloil.abrdns.com","ist-allein.info","ist-einmalig.de","ist-ganz-allein.de","ist-hier.com","ist-willig.de","istii.ro","isukrainestillacountry.com","iswin.ccwu.cc","it7.ovh","italy-mail.com","italymail.com","itaolo.com","itcompu.com","itduniya.online","itfast.net","itime.day","itit.tk","itloox.com","itmj3po.ddnsfree.com","itmo.edu.pl","itmom.com","itos.cloudns.org","itquoted.com","itsbds.com","itsedit.click","itsjiff.com","itspid.com","itunesgiftcodegenerator.com","iuanhoi.store","iubridge.com","iuemail.men","iuno.fun","iupo219.ddnsfree.com","ivebeenframed.com","ivillage.com","iwan-fals.com","iwatermail.com","iwmail.com","iwon.com","iwx4k98.theworkpc.com","ixaks.com","ixhale.com","ixqr.hair","ixunbo.com","ixx.io","iya.fr.nf","iysqv.com","izadpanah.com","izhowto.com","izunasan.my.id","izunasuite.biz.id","j-p.us","j3r8qd.space","j5bie4.tech","jabmag.com","jackierobinsonparkoffame.org","jafps.com","jaga.email","jagomail.com","jahoopa.com","jailbreakeverything.com","jaipas.lu","jajxz.com","jakarta.io.vn","jakemsr.com","jakl.li","jakuza.hu","jamesat.biz.id","jamesat.my.id","jamesjfattorini.rocks","jamesthynnealmshouse.co.uk","jamyjmkqdsc.com","janestore.xyz","janproz.com","japan.com","japanesegirls.cc","japnc.com","jaqis.com","jarszone.com","jasminesports.com","jasonbella.online","jasonswheels.org","jav8.de","javadmin.com","javaemail.com","javaka.live","javindra.cfd","jawatengah.net","jawatimur.net","jaydemail.com","jazzandjava.com","jazzfan.com","jazzgame.com","jazzvip.site","jbsu.hair","jbsze.com","jbsze.ne","jbsze.net","jc58t04.kozow.com","jcnorris.com","jcom.home.ne.jp","jcom.zaq.ne.jp","jdmadventures.com","jdz.ro","je-recycle.info","jejes.de","jejesfb.biz.id","jellow.ml","jellycat.eu.cc","jellyrolls.com","jeoce.com","jeremytunnell.net","jerusalemmail.com","jessitrust.com","jessyx.bond","jet-renovation.fr","jetable.com","jetable.de","jetable.fr.nf","jetable.net","jetable.org","jetable.pp.ua","jetemail.net","jewby.com","jgjitffy.store","jgkcr.com","jhfnre-kjf.sbs","jhkf.beer","jhphoto.top","ji-a.cc","ji5.de","ji6.de","ji7.de","jiangwy.one","jiaoo.pp.ua","jiaxi.work","jibbo01.com","jieluv.com","jienan.hexname.com","jika.gg","jilingling.eu.cc","jincer.com","jingood.dpdns.org","jinkeyun.com","jinva.fr.nf","jiongguo.top","jiooq.com","jioso.com","jippii.fi","jisan.uk","jisankhan1.site","jiuji.asia","jiujiu.hexname.com","jjfcharitabletrust.co.uk","jjice.com","jjj.ee","jjk.app","jjlj.fashion","jjmj.fashion","jjuisyj.top","jjxj.fashion","jjxt6lv.mywire.org","jkotypc.com","jksndh-afd2.wiki","jlpevents.co.uk","jmail.co.za","jmail.fr.nf","jmail.ovh","jmail.ro","jmods.me","jmt2469.xyz","jnad.skin","jndp.hair","jnwexkd.giize.com","jnxjn.com","job4u.com","jobbikszimpatizans.hu","jobbrett.com","jobdatei.de","jobposts.net","jobs-to-be-done.net","jobscai.com","jobsma.pp.ua","jobzyy.com","joelonsoftware.com","joelpet.com","joetestalot.com","jofuso.com","johorulcloud.space","joihonm.shop","joinme.com","jojolt.shop","jojomedia.store","jokes.com","jonira.sbs","jonsjav.cc","jopho.com","jora.dpdns.org","jordanmail.com","joseihorumon.info","josse.ltd","journalist.com","jourrapide.com","jovem.te.pt","joymail.com","joymail.cyou","joywavepoint.com","jp-ml.com","jpco.org","jpopmail.com","jrhmail.com","jsifh5i.kozow.com","jsnc.cloud","jsncos.com","jsrsolutions.com","jualakun.com","jualakunfb.co","jualfb.co","jubii.dk","jubiichat.dk","jubiiconnect.dk","jubiigames.dk","jubiimail.dk","jubiipost.dk","jubiipostadresse.dk","jumonji.tk","jump.com","jumpy.it","jungkamushukum.com","juniormail.com","junk.to","junk1e.com","junkmail.com","junkmail.ga","junkmail.gq","juno.com","just-email.com","justdefinition.com","justemail.ml","justemail.net","justicemail.com","justnapa.com","juvanta.cfd","juyouxi.com","jwork.ru","jxin.hair","jxpomup.com","jywa.social","jzlvoei.cn","jzlz.hair","jzzm.top","k-global.dev","k4money.com","kaazoo.com","kabamail.com","kabarr.com","kabelmail.de","kabinbilla.com","kademen.com","kadokawa.cf","kadokawa.ga","kadokawa.gq","kadokawa.ml","kadokawa.tk","kaengu.ru","kaffeeschluerfer.com","kaffeeschluerfer.de","kagi.be","kahase.com","kaixo.com","kajaib.social","kajaib.studio","kaka0.kr","kakadua.net","kakao-mail.com","kakao.com","kakaomail.kr","kakator.com","kakaveo3.io.vn","kakslsie.store","kalapi.org","kalimantantimur.net","kalpoint.com","kalquoris.cfd","kalwa.fun","kamen-market.ru","kamete.org","kampret.asia","kamsg.com","kankoplm.eu.cc","kanlangld.shop","kanonmail.com","kansascity.com","kantclass.com","kaoing.com","kaovo.com","kapoorweb.com","kappala.info","kapten.site","kaptencpl.com","kara-turk.net","karachian.com","karachioye.com","karatraman.ml","karbasi.com","karenkey.com","kariplan.com","karta-kykyruza.ru","kartvelo.com","kasmail.com","kasmirfx.buzz","kaspop.com","katalyst.indevs.in","katamail.com","kathrynis.my.id","kathrynis.web.id","katputli.world","kattthu.us","katztube.com","kavio.my.id","kaw-sar.top","kawneha.site","kayafmmail.co.za","kaybooks.top","kayfapremium.store","kayfilms.top","kaygroup.top","kayilo.com","kaynlab.com","kazava.tech","kazelink.ml","kbishwanathuk.cc","kbjrmail.com","kbox.li","kcks.com","kcn.ne.jp","kcoporation.com","kcql.hair","kcrw.de","kcya.skin","kd2.org","kdpsl.org","ke1le.cyou","kee40vq.ddnsfree.com","keecs.com","keepmail.dev","keepmymail.com","keg-party.com","kein.date","keinhirn.de","keinpardon.de","keipino.de","kejinxi.xyz","kekita.com","keko.com.ar","kelenson.com","kelimo.sbs","kellychen.com","kellychibale-researchgroup-uct.com","kemail.uk","kempstoncharities.band","kempstoncharities.co.uk","kemptvillebaseball.com","kenari.online","kendev.id.vn","kenfern.com","kenhbanme.com","kenhphim.net","kenvanharen.com","kepkat.com","kepkat.site","keromail.com","kerotu.com","ket-qua.org","ketimunfam.online","ketua.id","keyemail.com","kgb.hu","kgfu.makeup","khaibn.com","khamu.me","khoke.nl","khosropour.com","khtextile.com","kia-sdn.me","kiani.com","kicaumania.web.id","kickassmail.com","kidaroa.com","kiecchn.com","kierko.com","kiki287666.xyz","killermail.com","killlove.site","killmail.com","killmail.net","killyourtime.com","kimagure.ccwu.cc","kimagure1.cc.cd","kimdyn.com","kimgmail.com","kimo.com","kimora.space","kimsdisk.com","kimzavin.shop","kinda.email","kindamail.com","kingdais.com","kinglibrary.net","kingproplan.site","kingsq.ga","kingss.de5.net","kinki-kids.com","kino-100.ru","kintil.buzz","kiois.com","kismail.ru","kisoq.com","kissfans.com","kissgy.com","kisstwink.com","kitap.az","kitnastar.com","kittymail.com","kitznet.at","kiwibox.com","kiwitown.com","kiwkiw.shop","kjhg.hair","kjkpc.net","kjkszpjcompany.com","kjnbtv.dedyn.io","kk.io.vn","kkdty.dynv6.net","kkkoouy.cyou","kkmail.be","kkoup.com","kksm.be","klassmaster.com","klassmaster.net","klazbo.com","kleinanzeigen-verification.de","klick-tipp.us","kliknesia.io","klingai.asia","klipschx12.com","kloap.com","klovenode.com","kludgemush.com","klut.io","klyverra.cfd","klzlk.com","km.ru","kmail.li","kmail.live","kmail.qzz.io","kmail123.com","kmhow.com","knaresboroughtownmuseum.org","knickerbockerban.de","knilok.com","knmcadibav.com","knol-power.nl","knowledgemd.com","kobrandly.com","kodeholik.site","kodpan.com","koes.justdied.com","kojoball.email","kokalo.store","kokklsd.dpdns.org","kokoa.eu.cc","kokoroa.eu.cc","koletter.com","kolumbus.fi","kommespaeter.de","kommunity.biz","kon42.com","kongbao.xyz","konican.com","konigyuan.us.ci","konterkulo.com","kontoko.org","konultant-jurist.ru","konx.com","kook.ml","kopagas.com","kopaka.net","korea.com","koreamail.com","korimoddin.store","kornet.net","korona-nedvizhimosti.ru","kortazo.email","korvanta.cfd","koshu.ru","kosmetik-obatkuat.com","kostenlosemailadresse.de","koszmail.pl","kpay.be","kpmn-design.org","kpnmail.nl","kpnplanet.nl","kpooa.com","kpost.be","kppk.beer","kpxj.hair","kpxj.skin","kqbz.beer","kqhmln6.theworkpc.com","kravintis.cfd","krd.ag","kreabaka.site","krim.ws","krongthip.com","krouter.net","krsw.tk","kruay.com","krunis.com","krypton.tk","krysentra.cfd","ksadj123.eu.cc","ksanmail.com","ksee24mail.com","kskblzdjdwkzkbl.top","ksmtrck.tk","kswm.beer","ktisocial.asia","ktpingprox.id.vn","kube93mail.com","kuhaku.indevs.in","kuhrap.com","kukamail.com","kuku.lu","kulmeo.com","kulturbetrieb.info","kumarweb.com","kumli.racing","kurin.sbs","kuromee.com","kuromee.store","kurumibnb.dog","kurzepost.de","kutakbisajauhjauh.gq","kuwait-mail.com","kv2vpn.eu.org","kvarra.org","kvbs.hair","kvhrr.com","kvhrs.com","kvhrw.com","kwifa.com","kwift.net","kwilco.net","kwtest.io","kxbj.beer","kyal.pl","kynninc.com","kyntaris.cfd","kyois.com","kyriog.fr","kyuusei.fr.nf","kywa.uk","kyx9sgz.loseyourip.com","kzccv.com","l-c-a.us","l2gyw37.mywire.org","l2rrz31.ddnsfree.com","l33r.eu","l6factors.com","la.com","laafd.com","labananmakmur.com","labetteraverouge.at","labforge.freeddns.org","laborderie.com","labworld.org","lacedmail.com","lackmail.net","lackmail.ru","lacraffe.fr.nf","lacto.info","ladymail.cz","lagerlouts.com","lags.us","lahoreoye.com","laicai8.sbs","lain.ch","lajiao.cc.cd","lajt.hu","lak.pp.ua","lakeground.shop","lakelivingstonrealestate.com","lakmail.com","lakqs.com","laksamantunggalakma.me","lalayun.cyou","lalulahoot.me","lamasticots.com","lambsauce.de","lamer.hu","land.ru","landmail.co","lankamail.com","lanuiopl.bond","laoeq.com","laoia.com","lapakqu.com","lapluz.xyz","laposte.net","lappies.net","laptoplonghai.com","larisia.com","larland.com","lashyd.com","lass-es-geschehen.de","last-chance.pro","laste.ml","lastexile.site","lastmail.co","lastmail.com","latemodels.com","latinmail.com","laulund.info","launchpadx.shop","launders.money","lavache.com","law.com","lawlita.com","lawyer.com","laxex.ru","laxex.store","laxiw.org","laymro.com","lazerbade.com","lazerbade.fr","lazerbade.org","lazerbade.store","lazyinbox.com","lazyinbox.us","lbrmail666.site","lbvz.homes","lcvfdvynb.top","ldaho.biz","ldkll.cn","ldofy2e.ooguy.com","ldop.com","ldsda.hexname.com","ldtp.com","le-tim.ru","leadwizzer.com","leafflip.com","lealking.com","learntojugg.com","lebetrust.org","lecn.beer","lee.mx","leechchannel.com","leeching.net","leehom.net","leetmail.co","lefruit-dev.work","legadmin.org","legalactions.com","legalrc.loan","legendaryseller.com","legislator.com","leie.me","lellno.gq","lellol.dev","lellol.tech","lemonkk.cn","lenovog4.com","lenta.ru","leoguio.site","leonlai.net","leopik.com","lerany.com","lerbhe.com","lerch.ovh","lero3.com","leruvo.icu","lesobprovermail.com","lessismore.eu.cc","letsgomets.net","letter.sobe.de5.net","letterboxes.org","letterhaven.net","letterprotect.net","lettersboxmail.com","letthemeatspam.com","letv377.nsmjj.tech","levele.com","levele.hu","levi.cc.cd","leviacerman.store","lex.bg","lexis-nexis-mail.com","lez.se","lfsz.beer","lftl.hair","lgxscreen.com","lhsdv.com","li.lacdn.cn","liadhene.com","liamcyrus.com","liang-tts.shop","liangganxiaopu.bond","libero.it","liberomail.com","libinit.com","licccons.icu","licenses.sbs","lick101.com","liebt-dich.info","lifebitsnotes.com","lifebyfood.com","lifetimefriends.info","lifetotech.com","lifetreechurch.co.uk","lifewiseleaf.com","liggegi.com","lightv.online","ligsb.com","likeageek.fr.nf","likemovie.net","likevip.net","lilbahlil.me","lillemap.net","lilo.me","lilspam.com","lilsuite.id","limcil.cyou","limtu.com","lindenbaumjapan.com","link2mail.net","linkcoll.my.id","linkedindiscount.com","linkedintuts2016.pw","linkmail.info","linkmaster.com","linkspo.my.id","linktrader.com","linlin.cloud","linlshe.com","linshiyou.com","linshiyouxiang.net","linux-do.me","linuxfreemail.com","linuxgo.us.ci","linuxmail.org","linuxmail.so","linxi.online","linyu.qzz.io","linzefor.asia","linzefor.shop","liocbrco.com","liondapt.com","lionsfan.com.au","liontrucks.com","liopsacac.shop","liquidinformation.net","list.ru","lista.cc","listomail.com","litedrop.com","littleapple.com","littleblueroom.com","littlejohns.info","littlemvh.org.uk","littsocial.com","liun.cc.cd","liuyuyu.space","live.at","live.be","live.ca","live.cl","live.cn","live.co.kr","live.co.uk","live.co.za","live.com","live.com.ar","live.com.au","live.com.mx","live.com.pt","live.com.sg","live.de","live.dk","live.fr","live.hk","live.ie","live.in","live.it","live.jp","live.nl","live.no","live.ru","live.se","livedoor.com","liveforms.org","liveradio.tk","liverpoolfans.com","livinitlarge.net","lixlord.xyz","liyao.edu.kg","lizery.com","lkgn.se","llandudno.com","llangollen.com","llciuoau.top","llhhtech.com","llogin.ru","lloudfsxly.top","lmagent.eu.cc","lmngh.site","lmxmail.sk","lnovic.com","lnwtt.com","loadby.us","loan101.pro","loaoa.com","loapq.com","lobbyist.com","localbar.com","locanto1.club","locantofuck.top","locantowsite.club","locawin.com","locomodev.net","locos.com","loganister.com","logicfieldzen.com","logicstreak.com","login-email.cf","login-email.ga","login-email.ml","login-email.tk","logsmarter.net","logular.com","loh.pp.ua","lohinja.com","loin.in","lokenathassociation.co.uk","lolfreak.net","lolito.tk","lolmail.biz","lonaxter.site","london.com","londonyouthsailing.org","longsbkt.xyz","looksmart.co.uk","looksmart.com","looksmart.com.au","lookugly.com","lopezclub.com","lordfortescue.news","lordfortescue.org.uk","lordofmysteries.org","lordsofts.com","lorkex.com","lortemail.dk","losemymail.com","losmail.no","lostnow.org","loudment.com","louiskoo.com","love-your.mom","love.cz","loveable.com","lovecalculatorname.org","lovecat.com","lovecv.cn","lovefall.ml","lovefootball.com","lovegivingsadaqah.org","lovelygirl.net","lovemail.com","lovemeet.faith","lovemeleaveme.com","lovepet.vip","lover-boy.com","lovergirl.com","lovertboy.online","lovesea.gq","lovethebroncos.com","lovethecowboys.com","loveuu.xyz","loveyouforever.de","lovingjesus.com","lowandslow.com","lowprizo.com","loww.ccwu.cc","lpfmgmtltd.com","lqkrxvc.loseyourip.com","lr7.us","lr78.com","lroid.com","lru.me","ls-server.ru","lsaar.com","lsbl6fq.mywire.org","lsd10086.ccwu.cc","lsd8866.ccwu.cc","lsereborn.com","lsfh.hair","lsirdomain.us.ci","lsjd.ccwu.cc","lsp.lsa1230.dpdns.org","lsyx24.com","lts35.help","lu1mtac.ooguy.com","luckfeed.com","luckymail.org","luffygadgets.com","luhupo.com","lujialu.edu.kg","lujian.de5.net","lukaat.com","lukecarriere.com","lukemail.info","lukop.dk","lum25kcredit.io.vn","lumeika.com","lumenbay.info","lumg.uk","luminexis.cfd","luminix1.shop","lumm25k.io.vn","lumyrix.cfd","lunarmoon.online","lunetra.shop","lunor.cfd","lushiyi.eu.cc","lushosa.com","luso.pt","lutech.uk","luukku.com","luv2.us","luxentra.cfd","luxovira.cfd","luxudata.com","lvie.com.sg","lxbeta.com","lxydawang.top","lycos.co.kr","lycos.co.uk","lycos.com","lycos.es","lycos.it","lycos.ne.jp","lycosmail.com","lydir.com","lyfestylecreditsolutions.com","lyfr65zne.cn","lyft.live","lygv76sax.cn","lympstonevillagehall.co.uk","lynex.sbs","lyngo.tech","lynwise.shop","lyricspad.net","lys48fgq.cn","lyse.net","lyxhzz.com.cn","lyxj71mnr.cn","lzoaq.com","lzum.homes","m-a-i-l.com","m-hmail.com","m1.lx1qzz.qzz.io","m21.cc","m4.org","m4ilweb.info","ma1l.duckdns.org","mabal.fr.nf","maboard.com","mabox.eu","mac-24.com","mac.com","macbox.com","macfreak.com","machen-wir.com","machinecandy.com","macmail.com","macmail.info","macos.one","macr2.com","macromaid.com","macromice.info","madcreations.com","madonnafan.com","madrid.com","maennerversteherin.com","maennerversteherin.de","maffia.hu","magamail.com","magbit.food","maggotymeat.ga","magicbox.ro","magicmail.co.za","magim.be","magspam.net","mahmoodweb.com","mahreenlifestyle.shop","maidlow.info","maika.eu.cc","mail-awu.de","mail-box.cz","mail-card.net","mail-center.com","mail-central.com","mail-easy.fr","mail-filter.com","mail-help.net","mail-hosting.co","mail-hub.info","mail-mario.fr.nf","mail-me.com","mail-now.top","mail-owl.com","mail-page.com","mail-share.com","mail-temporaire.com","mail-temporaire.fr","mail-tester.com","mail.1134511.xyz","mail.apomemail.ru","mail.austria.com","mail.az","mail.b-3.huggingface.qzz.io","mail.b-6.kpe.de5.net","mail.bbexcite.jp","mail.be","mail.bg","mail.bulgaria.com","mail.by","mail.byte.it","mail.capperflag.top","mail.ch","mail.co.za","mail.com","mail.com.tr","mail.de","mail.dk","mail.ee","mail.entrepeneurmag.com","mail.fr","mail.freetown.com","mail.frink.huggingface.qzz.io","mail.g-1.vactor1.us.ci","mail.g-10.vactor1.us.ci","mail.g-2.vactor1.us.ci","mail.g-4.vactor1.us.ci","mail.g-5.vactor1.us.ci","mail.g-6.vactor1.us.ci","mail.g-7.vactor1.us.ci","mail.g-9.vactor1.us.ci","mail.global-1.kpe.de5.net","mail.global-3.kpe.de5.net","mail.global-5.kpe.de5.net","mail.goo.ne.jp","mail.gr","mail.gw","mail.happyhome.eu.cc","mail.hipda.eu.cc","mail.hitthebeach.com","mail.homehappy.eu.cc","mail.htl22.at","mail.lacdn.cn","mail.loveopenai.eu.cc","mail.lv","mail.magicyue.top","mail.md","mail.misterpinball.de","mail.nothing688.de5.net","mail.nu","mail.oopenclaw.eu.cc","mail.org.uk","mail.pf","mail.pkday.eu.cc","mail.pt","mail.r-o-o-t.com","mail.ru","mail.sisna.com","mail.sony.jp","mail.sowhy.de5.net","mail.svenz.eu","mail.tdc.edu.vn","mail.tm","mail.uron.cc.cd","mail.uron.de5.net","mail.usa.com","mail.vasarhely.hu","mail.vu","mail.wtf","mail.wuwang1028.bond","mail.xiaolajiao.de","mail.xiaolajiaoyyds.com","mail.yongpeng.us.ci","mail0.ga","mail1.top","mail1.zecous.top","mail101.xyz","mail10m.com","mail10s.com","mail11.xyz","mail114.net","mail123.fr","mail123.pro","mail12h.com","mail15.com","mail1a.de","mail1web.org","mail1yyds.hbkj.eu.cc","mail2007.com","mail21.cc","mail22.club","mail2aaron.com","mail2abby.com","mail2abc.com","mail2actor.com","mail2admiral.com","mail2adorable.com","mail2adoration.com","mail2adore.com","mail2adventure.com","mail2aeolus.com","mail2aether.com","mail2affection.com","mail2afghanistan.com","mail2africa.com","mail2agent.com","mail2aha.com","mail2ahoy.com","mail2aim.com","mail2air.com","mail2airbag.com","mail2airforce.com","mail2airport.com","mail2alabama.com","mail2alan.com","mail2alaska.com","mail2albania.com","mail2alcoholic.com","mail2alec.com","mail2alexa.com","mail2algeria.com","mail2alicia.com","mail2alien.com","mail2allan.com","mail2allen.com","mail2allison.com","mail2alpha.com","mail2alyssa.com","mail2amanda.com","mail2amazing.com","mail2amber.com","mail2america.com","mail2american.com","mail2andorra.com","mail2andrea.com","mail2andy.com","mail2anesthesiologist.com","mail2angela.com","mail2angola.com","mail2ann.com","mail2anna.com","mail2anne.com","mail2anthony.com","mail2anything.com","mail2aphrodite.com","mail2apollo.com","mail2april.com","mail2aquarius.com","mail2arabia.com","mail2arabic.com","mail2architect.com","mail2ares.com","mail2argentina.com","mail2aries.com","mail2arizona.com","mail2arkansas.com","mail2armenia.com","mail2army.com","mail2arnold.com","mail2art.com","mail2artemus.com","mail2arthur.com","mail2artist.com","mail2ashley.com","mail2ask.com","mail2astronomer.com","mail2athena.com","mail2athlete.com","mail2atlas.com","mail2atom.com","mail2attitude.com","mail2auction.com","mail2aunt.com","mail2australia.com","mail2austria.com","mail2azerbaijan.com","mail2baby.com","mail2bahamas.com","mail2bahrain.com","mail2ballerina.com","mail2ballplayer.com","mail2band.com","mail2bangladesh.com","mail2bank.com","mail2banker.com","mail2bankrupt.com","mail2baptist.com","mail2bar.com","mail2barbados.com","mail2barbara.com","mail2barter.com","mail2basketball.com","mail2batter.com","mail2beach.com","mail2beast.com","mail2beatles.com","mail2beauty.com","mail2becky.com","mail2beijing.com","mail2belgium.com","mail2belize.com","mail2ben.com","mail2bernard.com","mail2beth.com","mail2betty.com","mail2beverly.com","mail2beyond.com","mail2biker.com","mail2bill.com","mail2billionaire.com","mail2billy.com","mail2bio.com","mail2biologist.com","mail2black.com","mail2blackbelt.com","mail2blake.com","mail2blind.com","mail2blonde.com","mail2blues.com","mail2bob.com","mail2bobby.com","mail2bolivia.com","mail2bombay.com","mail2bonn.com","mail2bookmark.com","mail2boreas.com","mail2bosnia.com","mail2boston.com","mail2botswana.com","mail2bradley.com","mail2brazil.com","mail2breakfast.com","mail2brian.com","mail2bride.com","mail2brittany.com","mail2broker.com","mail2brook.com","mail2bruce.com","mail2brunei.com","mail2brunette.com","mail2brussels.com","mail2bryan.com","mail2bug.com","mail2bulgaria.com","mail2business.com","mail2buy.com","mail2ca.com","mail2california.com","mail2calvin.com","mail2cambodia.com","mail2cameroon.com","mail2canada.com","mail2cancer.com","mail2capeverde.com","mail2capricorn.com","mail2cardinal.com","mail2cardiologist.com","mail2care.com","mail2caroline.com","mail2carolyn.com","mail2casey.com","mail2cat.com","mail2caterer.com","mail2cathy.com","mail2catlover.com","mail2catwalk.com","mail2cell.com","mail2chad.com","mail2champaign.com","mail2charles.com","mail2chef.com","mail2chemist.com","mail2cherry.com","mail2chicago.com","mail2chile.com","mail2china.com","mail2chinese.com","mail2chocolate.com","mail2christian.com","mail2christie.com","mail2christmas.com","mail2christy.com","mail2chuck.com","mail2cindy.com","mail2clark.com","mail2classifieds.com","mail2claude.com","mail2cliff.com","mail2clinic.com","mail2clint.com","mail2close.com","mail2club.com","mail2coach.com","mail2coastguard.com","mail2colin.com","mail2college.com","mail2colombia.com","mail2color.com","mail2colorado.com","mail2columbia.com","mail2comedian.com","mail2composer.com","mail2computer.com","mail2computers.com","mail2concert.com","mail2congo.com","mail2connect.com","mail2connecticut.com","mail2consultant.com","mail2convict.com","mail2cook.com","mail2cool.com","mail2cory.com","mail2costarica.com","mail2country.com","mail2courtney.com","mail2cowboy.com","mail2cowgirl.com","mail2craig.com","mail2crave.com","mail2crazy.com","mail2create.com","mail2croatia.com","mail2cry.com","mail2crystal.com","mail2cuba.com","mail2culture.com","mail2curt.com","mail2customs.com","mail2cute.com","mail2cutey.com","mail2cynthia.com","mail2cyprus.com","mail2czechrepublic.com","mail2dad.com","mail2dale.com","mail2dallas.com","mail2dan.com","mail2dana.com","mail2dance.com","mail2dancer.com","mail2danielle.com","mail2danny.com","mail2darlene.com","mail2darling.com","mail2darren.com","mail2daughter.com","mail2dave.com","mail2dawn.com","mail2dc.com","mail2dealer.com","mail2deanna.com","mail2dearest.com","mail2debbie.com","mail2debby.com","mail2deer.com","mail2delaware.com","mail2delicious.com","mail2demeter.com","mail2democrat.com","mail2denise.com","mail2denmark.com","mail2dennis.com","mail2dentist.com","mail2derek.com","mail2desert.com","mail2devoted.com","mail2devotion.com","mail2diamond.com","mail2diana.com","mail2diane.com","mail2diehard.com","mail2dilemma.com","mail2dillon.com","mail2dinner.com","mail2dinosaur.com","mail2dionysos.com","mail2diplomat.com","mail2director.com","mail2dirk.com","mail2disco.com","mail2dive.com","mail2diver.com","mail2divorced.com","mail2djibouti.com","mail2doctor.com","mail2doglover.com","mail2dominic.com","mail2dominica.com","mail2dominicanrepublic.com","mail2don.com","mail2donald.com","mail2donna.com","mail2doris.com","mail2dorothy.com","mail2doug.com","mail2dough.com","mail2douglas.com","mail2dow.com","mail2downtown.com","mail2dream.com","mail2dreamer.com","mail2dude.com","mail2dustin.com","mail2dyke.com","mail2dylan.com","mail2earl.com","mail2earth.com","mail2eastend.com","mail2eat.com","mail2economist.com","mail2ecuador.com","mail2eddie.com","mail2edgar.com","mail2edwin.com","mail2egypt.com","mail2electron.com","mail2eli.com","mail2elizabeth.com","mail2ellen.com","mail2elliot.com","mail2elsalvador.com","mail2elvis.com","mail2emergency.com","mail2emily.com","mail2engineer.com","mail2english.com","mail2environmentalist.com","mail2eos.com","mail2eric.com","mail2erica.com","mail2erin.com","mail2erinyes.com","mail2eris.com","mail2eritrea.com","mail2ernie.com","mail2eros.com","mail2estonia.com","mail2ethan.com","mail2ethiopia.com","mail2eu.com","mail2europe.com","mail2eurus.com","mail2eva.com","mail2evan.com","mail2evelyn.com","mail2everything.com","mail2exciting.com","mail2expert.com","mail2fairy.com","mail2faith.com","mail2fanatic.com","mail2fancy.com","mail2fantasy.com","mail2farm.com","mail2farmer.com","mail2fashion.com","mail2fat.com","mail2feeling.com","mail2female.com","mail2fever.com","mail2fighter.com","mail2fiji.com","mail2filmfestival.com","mail2films.com","mail2finance.com","mail2finland.com","mail2fireman.com","mail2firm.com","mail2fisherman.com","mail2flexible.com","mail2florence.com","mail2florida.com","mail2floyd.com","mail2fly.com","mail2fond.com","mail2fondness.com","mail2football.com","mail2footballfan.com","mail2found.com","mail2france.com","mail2frank.com","mail2frankfurt.com","mail2franklin.com","mail2fred.com","mail2freddie.com","mail2free.com","mail2freedom.com","mail2french.com","mail2freudian.com","mail2friendship.com","mail2from.com","mail2fun.com","mail2gabon.com","mail2gabriel.com","mail2gail.com","mail2galaxy.com","mail2gambia.com","mail2games.com","mail2gary.com","mail2gavin.com","mail2gemini.com","mail2gene.com","mail2genes.com","mail2geneva.com","mail2george.com","mail2georgia.com","mail2gerald.com","mail2german.com","mail2germany.com","mail2ghana.com","mail2gilbert.com","mail2gina.com","mail2girl.com","mail2glen.com","mail2gloria.com","mail2goddess.com","mail2gold.com","mail2golfclub.com","mail2golfer.com","mail2gordon.com","mail2government.com","mail2grab.com","mail2grace.com","mail2graham.com","mail2grandma.com","mail2grandpa.com","mail2grant.com","mail2greece.com","mail2green.com","mail2greg.com","mail2grenada.com","mail2gsm.com","mail2guard.com","mail2guatemala.com","mail2guy.com","mail2hades.com","mail2haiti.com","mail2hal.com","mail2handhelds.com","mail2hank.com","mail2hannah.com","mail2harold.com","mail2harry.com","mail2hawaii.com","mail2headhunter.com","mail2heal.com","mail2heather.com","mail2heaven.com","mail2hebe.com","mail2hecate.com","mail2heidi.com","mail2helen.com","mail2hell.com","mail2help.com","mail2helpdesk.com","mail2henry.com","mail2hephaestus.com","mail2hera.com","mail2hercules.com","mail2herman.com","mail2hermes.com","mail2hespera.com","mail2hestia.com","mail2highschool.com","mail2hindu.com","mail2hip.com","mail2hiphop.com","mail2holland.com","mail2holly.com","mail2hollywood.com","mail2homer.com","mail2honduras.com","mail2honey.com","mail2hongkong.com","mail2hope.com","mail2horse.com","mail2hot.com","mail2hotel.com","mail2houston.com","mail2howard.com","mail2hugh.com","mail2human.com","mail2hungary.com","mail2hungry.com","mail2hygeia.com","mail2hyperspace.com","mail2hypnos.com","mail2ian.com","mail2ice-cream.com","mail2iceland.com","mail2idaho.com","mail2idontknow.com","mail2illinois.com","mail2imam.com","mail2in.com","mail2india.com","mail2indian.com","mail2indiana.com","mail2indonesia.com","mail2infinity.com","mail2intense.com","mail2iowa.com","mail2iran.com","mail2iraq.com","mail2ireland.com","mail2irene.com","mail2iris.com","mail2irresistible.com","mail2irving.com","mail2irwin.com","mail2isaac.com","mail2israel.com","mail2italian.com","mail2italy.com","mail2jackie.com","mail2jacob.com","mail2jail.com","mail2jaime.com","mail2jake.com","mail2jamaica.com","mail2james.com","mail2jamie.com","mail2jan.com","mail2jane.com","mail2janet.com","mail2janice.com","mail2japan.com","mail2japanese.com","mail2jasmine.com","mail2jason.com","mail2java.com","mail2jay.com","mail2jazz.com","mail2jed.com","mail2jeffrey.com","mail2jennifer.com","mail2jenny.com","mail2jeremy.com","mail2jerry.com","mail2jessica.com","mail2jessie.com","mail2jesus.com","mail2jew.com","mail2jeweler.com","mail2jim.com","mail2jimmy.com","mail2joan.com","mail2joann.com","mail2joanna.com","mail2jody.com","mail2joe.com","mail2joel.com","mail2joey.com","mail2john.com","mail2join.com","mail2jon.com","mail2jonathan.com","mail2jones.com","mail2jordan.com","mail2joseph.com","mail2josh.com","mail2joy.com","mail2juan.com","mail2judge.com","mail2judy.com","mail2juggler.com","mail2julian.com","mail2julie.com","mail2jumbo.com","mail2junk.com","mail2justin.com","mail2justme.com","mail2k.ru","mail2kansas.com","mail2karate.com","mail2karen.com","mail2karl.com","mail2karma.com","mail2kathleen.com","mail2kathy.com","mail2katie.com","mail2kay.com","mail2kazakhstan.com","mail2keen.com","mail2keith.com","mail2kelly.com","mail2kelsey.com","mail2ken.com","mail2kendall.com","mail2kennedy.com","mail2kenneth.com","mail2kenny.com","mail2kentucky.com","mail2kenya.com","mail2kerry.com","mail2kevin.com","mail2kim.com","mail2kimberly.com","mail2king.com","mail2kirk.com","mail2kiss.com","mail2kosher.com","mail2kristin.com","mail2kurt.com","mail2kuwait.com","mail2kyle.com","mail2kyrgyzstan.com","mail2la.com","mail2lacrosse.com","mail2lance.com","mail2lao.com","mail2larry.com","mail2latvia.com","mail2laugh.com","mail2laura.com","mail2lauren.com","mail2laurie.com","mail2lawrence.com","mail2lawyer.com","mail2lebanon.com","mail2lee.com","mail2leo.com","mail2leon.com","mail2leonard.com","mail2leone.com","mail2leslie.com","mail2letter.com","mail2liberia.com","mail2libertarian.com","mail2libra.com","mail2libya.com","mail2liechtenstein.com","mail2life.com","mail2linda.com","mail2linux.com","mail2lionel.com","mail2lipstick.com","mail2liquid.com","mail2lisa.com","mail2lithuania.com","mail2litigator.com","mail2liz.com","mail2lloyd.com","mail2lois.com","mail2lola.com","mail2london.com","mail2looking.com","mail2lori.com","mail2lost.com","mail2lou.com","mail2louis.com","mail2louisiana.com","mail2lovable.com","mail2love.com","mail2lucky.com","mail2lucy.com","mail2lunch.com","mail2lust.com","mail2luxembourg.com","mail2luxury.com","mail2lyle.com","mail2lynn.com","mail2madagascar.com","mail2madison.com","mail2madrid.com","mail2maggie.com","mail2mail4.com","mail2maine.com","mail2malawi.com","mail2malaysia.com","mail2maldives.com","mail2mali.com","mail2malta.com","mail2mambo.com","mail2man.com","mail2mandy.com","mail2manhunter.com","mail2mankind.com","mail2many.com","mail2marc.com","mail2marcia.com","mail2margaret.com","mail2margie.com","mail2marhaba.com","mail2maria.com","mail2marilyn.com","mail2marines.com","mail2mark.com","mail2marriage.com","mail2married.com","mail2marries.com","mail2mars.com","mail2marsha.com","mail2marshallislands.com","mail2martha.com","mail2martin.com","mail2marty.com","mail2marvin.com","mail2mary.com","mail2maryland.com","mail2mason.com","mail2massachusetts.com","mail2matt.com","mail2matthew.com","mail2maurice.com","mail2mauritania.com","mail2mauritius.com","mail2max.com","mail2maxwell.com","mail2maybe.com","mail2mba.com","mail2me4u.com","mail2mechanic.com","mail2medieval.com","mail2megan.com","mail2mel.com","mail2melanie.com","mail2melissa.com","mail2melody.com","mail2member.com","mail2memphis.com","mail2methodist.com","mail2mexican.com","mail2mexico.com","mail2mgz.com","mail2miami.com","mail2michael.com","mail2michelle.com","mail2michigan.com","mail2mike.com","mail2milan.com","mail2milano.com","mail2mildred.com","mail2milkyway.com","mail2millennium.com","mail2millionaire.com","mail2milton.com","mail2mime.com","mail2mindreader.com","mail2mini.com","mail2minister.com","mail2minneapolis.com","mail2minnesota.com","mail2miracle.com","mail2missionary.com","mail2mississippi.com","mail2missouri.com","mail2mitch.com","mail2model.com","mail2moldova.commail2molly.com","mail2mom.com","mail2monaco.com","mail2money.com","mail2mongolia.com","mail2monica.com","mail2montana.com","mail2monty.com","mail2moon.com","mail2morocco.com","mail2morpheus.com","mail2mors.com","mail2moscow.com","mail2moslem.com","mail2mouseketeer.com","mail2movies.com","mail2mozambique.com","mail2mp3.com","mail2mrright.com","mail2msright.com","mail2museum.com","mail2music.com","mail2musician.com","mail2muslim.com","mail2my.com","mail2myboat.com","mail2mycar.com","mail2mycell.com","mail2mygsm.com","mail2mylaptop.com","mail2mymac.com","mail2mypager.com","mail2mypalm.com","mail2mypc.com","mail2myphone.com","mail2myplane.com","mail2namibia.com","mail2nancy.com","mail2nasdaq.com","mail2nathan.com","mail2nauru.com","mail2navy.com","mail2neal.com","mail2nebraska.com","mail2ned.com","mail2neil.com","mail2nelson.com","mail2nemesis.com","mail2nepal.com","mail2netherlands.com","mail2network.com","mail2nevada.com","mail2newhampshire.com","mail2newjersey.com","mail2newmexico.com","mail2newyork.com","mail2newzealand.com","mail2nicaragua.com","mail2nick.com","mail2nicole.com","mail2niger.com","mail2nigeria.com","mail2nike.com","mail2no.com","mail2noah.com","mail2noel.com","mail2noelle.com","mail2normal.com","mail2norman.com","mail2northamerica.com","mail2northcarolina.com","mail2northdakota.com","mail2northpole.com","mail2norway.com","mail2notus.com","mail2noway.com","mail2nowhere.com","mail2nuclear.com","mail2nun.com","mail2ny.com","mail2oasis.com","mail2oceanographer.com","mail2ohio.com","mail2ok.com","mail2oklahoma.com","mail2oliver.com","mail2oman.com","mail2one.com","mail2onfire.com","mail2online.com","mail2oops.com","mail2open.com","mail2ophthalmologist.com","mail2optometrist.com","mail2oregon.com","mail2oscars.com","mail2oslo.com","mail2painter.com","mail2pakistan.com","mail2palau.com","mail2pan.com","mail2panama.com","mail2paraguay.com","mail2paralegal.com","mail2paris.com","mail2park.com","mail2parker.com","mail2party.com","mail2passion.com","mail2pat.com","mail2patricia.com","mail2patrick.com","mail2patty.com","mail2paul.com","mail2paula.com","mail2pay.com","mail2peace.com","mail2pediatrician.com","mail2peggy.com","mail2pennsylvania.com","mail2perry.com","mail2persephone.com","mail2persian.com","mail2peru.com","mail2pete.com","mail2peter.com","mail2pharmacist.com","mail2phil.com","mail2philippines.com","mail2phoenix.com","mail2phonecall.com","mail2phyllis.com","mail2pickup.com","mail2pilot.com","mail2pisces.com","mail2planet.com","mail2platinum.com","mail2plato.com","mail2pluto.com","mail2pm.com","mail2podiatrist.com","mail2poet.com","mail2poland.com","mail2policeman.com","mail2policewoman.com","mail2politician.com","mail2pop.com","mail2pope.com","mail2popular.com","mail2portugal.com","mail2poseidon.com","mail2potatohead.com","mail2power.com","mail2presbyterian.com","mail2president.com","mail2priest.com","mail2prince.com","mail2princess.com","mail2producer.com","mail2professor.com","mail2protect.com","mail2psychiatrist.com","mail2psycho.com","mail2psychologist.com","mail2qatar.com","mail2queen.com","mail2rabbi.com","mail2race.com","mail2racer.com","mail2rachel.com","mail2rage.com","mail2rainmaker.com","mail2ralph.com","mail2randy.com","mail2rap.com","mail2rare.com","mail2rave.com","mail2ray.com","mail2raymond.com","mail2realtor.com","mail2rebecca.com","mail2recruiter.com","mail2recycle.com","mail2redhead.com","mail2reed.com","mail2reggie.com","mail2register.com","mail2rent.com","mail2republican.com","mail2resort.com","mail2rex.com","mail2rhodeisland.com","mail2rich.com","mail2richard.com","mail2ricky.com","mail2ride.com","mail2riley.com","mail2rita.com","mail2rob.com","mail2robert.com","mail2roberta.com","mail2robin.com","mail2rock.com","mail2rocker.com","mail2rod.com","mail2rodney.com","mail2romania.com","mail2rome.com","mail2ron.com","mail2ronald.com","mail2ronnie.com","mail2rose.com","mail2rosie.com","mail2roy.com","mail2rss.org","mail2rudy.com","mail2rugby.com","mail2runner.com","mail2russell.com","mail2russia.com","mail2russian.com","mail2rusty.com","mail2ruth.com","mail2rwanda.com","mail2ryan.com","mail2sa.com","mail2sabrina.com","mail2safe.com","mail2sagittarius.com","mail2sail.com","mail2sailor.com","mail2sal.com","mail2salaam.com","mail2sam.com","mail2samantha.com","mail2samoa.com","mail2samurai.com","mail2sandra.com","mail2sandy.com","mail2sanfrancisco.com","mail2sanmarino.com","mail2santa.com","mail2sara.com","mail2sarah.com","mail2sat.com","mail2saturn.com","mail2saudi.com","mail2saudiarabia.com","mail2save.com","mail2savings.com","mail2school.com","mail2scientist.com","mail2scorpio.com","mail2scott.com","mail2sean.com","mail2search.com","mail2seattle.com","mail2secretagent.com","mail2senate.com","mail2senegal.com","mail2sensual.com","mail2seth.com","mail2sevenseas.com","mail2sexy.com","mail2seychelles.com","mail2shane.com","mail2sharon.com","mail2shawn.com","mail2ship.com","mail2shirley.com","mail2shoot.com","mail2shuttle.com","mail2sierraleone.com","mail2simon.com","mail2singapore.com","mail2single.com","mail2site.com","mail2skater.com","mail2skier.com","mail2sky.com","mail2sleek.com","mail2slim.com","mail2slovakia.com","mail2slovenia.com","mail2smile.com","mail2smith.com","mail2smooth.com","mail2soccer.com","mail2soccerfan.com","mail2socialist.com","mail2soldier.com","mail2somalia.com","mail2son.com","mail2song.com","mail2sos.com","mail2sound.com","mail2southafrica.com","mail2southamerica.com","mail2southcarolina.com","mail2southdakota.com","mail2southkorea.com","mail2southpole.com","mail2spain.com","mail2spanish.com","mail2spare.com","mail2spectrum.com","mail2splash.com","mail2sponsor.com","mail2sports.com","mail2srilanka.com","mail2stacy.com","mail2stan.com","mail2stanley.com","mail2star.com","mail2state.com","mail2stephanie.com","mail2steve.com","mail2steven.com","mail2stewart.com","mail2stlouis.com","mail2stock.com","mail2stockholm.com","mail2stockmarket.com","mail2storage.com","mail2store.com","mail2strong.com","mail2student.com","mail2studio.com","mail2studio54.com","mail2stuntman.com","mail2subscribe.com","mail2sudan.com","mail2superstar.com","mail2surfer.com","mail2suriname.com","mail2susan.com","mail2suzie.com","mail2swaziland.com","mail2sweden.com","mail2sweetheart.com","mail2swim.com","mail2swimmer.com","mail2swiss.com","mail2switzerland.com","mail2sydney.com","mail2sylvia.com","mail2syria.com","mail2taboo.com","mail2taiwan.com","mail2tajikistan.com","mail2tammy.com","mail2tango.com","mail2tanya.com","mail2tanzania.com","mail2tara.com","mail2taurus.com","mail2taxi.com","mail2taxidermist.com","mail2taylor.com","mail2taz.com","mail2teacher.com","mail2technician.com","mail2ted.com","mail2telephone.com","mail2teletubbie.com","mail2tenderness.com","mail2tennessee.com","mail2tennis.com","mail2tennisfan.com","mail2terri.com","mail2terry.com","mail2test.com","mail2texas.com","mail2thailand.com","mail2therapy.com","mail2think.com","mail2tickets.com","mail2tiffany.com","mail2tim.com","mail2time.com","mail2timothy.com","mail2tina.com","mail2titanic.com","mail2toby.com","mail2todd.com","mail2togo.com","mail2tom.com","mail2tommy.com","mail2tonga.com","mail2tony.com","mail2touch.com","mail2tourist.com","mail2tracey.com","mail2tracy.com","mail2tramp.com","mail2travel.com","mail2traveler.com","mail2travis.com","mail2trekkie.com","mail2trex.com","mail2triallawyer.com","mail2trick.com","mail2trillionaire.com","mail2troy.com","mail2truck.com","mail2trump.com","mail2try.com","mail2tunisia.com","mail2turbo.com","mail2turkey.com","mail2turkmenistan.com","mail2tv.com","mail2tycoon.com","mail2tyler.com","mail2u4me.com","mail2uae.com","mail2uganda.com","mail2uk.com","mail2ukraine.com","mail2uncle.com","mail2unsubscribe.com","mail2uptown.com","mail2uruguay.com","mail2usa.com","mail2utah.com","mail2uzbekistan.com","mail2v.com","mail2vacation.com","mail2valentines.com","mail2valerie.com","mail2valley.com","mail2vamoose.com","mail2vanessa.com","mail2vanuatu.com","mail2venezuela.com","mail2venous.com","mail2venus.com","mail2vermont.com","mail2vickie.com","mail2victor.com","mail2victoria.com","mail2vienna.com","mail2vietnam.com","mail2vince.com","mail2virginia.com","mail2virgo.com","mail2visionary.com","mail2vodka.com","mail2volleyball.com","mail2waiter.com","mail2wallstreet.com","mail2wally.com","mail2walter.com","mail2warren.com","mail2washington.com","mail2wave.com","mail2way.com","mail2waycool.com","mail2wayne.com","mail2webmaster.com","mail2webtop.com","mail2webtv.com","mail2weird.com","mail2wendell.com","mail2wendy.com","mail2westend.com","mail2westvirginia.com","mail2whether.com","mail2whip.com","mail2white.com","mail2whitehouse.com","mail2whitney.com","mail2why.com","mail2wilbur.com","mail2wild.com","mail2willard.com","mail2willie.com","mail2wine.com","mail2winner.com","mail2wired.com","mail2wisconsin.com","mail2woman.com","mail2wonder.com","mail2world.com","mail2worship.com","mail2wow.com","mail2www.com","mail2wyoming.com","mail2xfiles.com","mail2xox.com","mail2yachtclub.com","mail2yahalla.com","mail2yemen.com","mail2yes.com","mail2yugoslavia.com","mail2zack.com","mail2zambia.com","mail2zenith.com","mail2zephir.com","mail2zeus.com","mail2zipper.com","mail2zoo.com","mail2zoologist.com","mail2zurich.com","mail3000.com","mail333.com","mail4.uk","mail4qa.com","mail4trash.com","mail4u.info","mail666.ru","mail7.io","mail707.com","mail72.com","mail789.dedyn.io","mailaddress.de","mailadresi.tk","mailandftp.com","mailandnews.com","mailapp.top","mailapril.org","mailas.com","mailasia.com","mailba.uk","mailback.com","mailbai.com","mailbali.com","mailbidon.com","mailbiscuit.com","mailbiz.biz","mailblocks.com","mailbolt.com","mailbomb.net","mailboom.com","mailbox.as","mailbox.co.za","mailbox.gr","mailbox.hu","mailbox.in.ua","mailbox.org","mailbox.zip","mailbox49.com","mailbox52.ga","mailbox72.biz","mailbox80.biz","mailbox82.biz","mailbox87.de","mailbox92.biz","mailboxify.ru","mailboxify.store","mailboxly.ru","mailboxly.store","mailboxy.fun","mailboxy.ru","mailboxy.store","mailbr.com.br","mailbucket.org","mailc.net","mailcan.com","mailcat.biz","mailcatch.com","mailcc.com","mailchannels.de","mailchatgpt.eu.cc","mailchoose.co","mailchop.com","mailcity.com","mailcker.com","mailclone2023.top","mailclub.fr","mailclub.net","maildax.me","mailde.de","mailde.info","maildock.store","maildrop.cc","maildrop.cf","maildrop.ga","maildrop.gq","maildrop.ml","maildrop.sobe.de5.net","maildu.de","maildx.com","maildy.site","maileater.com","mailed.in","mailed.ro","mailedu.edu.pl","maileduvn.us","maileimer.de","maileme101.com","mailer.edu.pl","mailer.io.vn","mailers.edu.pl","mailexcite.com","mailexpire.com","mailf5.com","mailfa.tk","mailfall.com","mailfast.pro","mailfence.com","mailfirefly.com","mailfirst.icu","mailfor1month.shop","mailforce.net","mailforgo.site","mailforspam.com","mailfortiktok.us","mailfree.ga","mailfree.gq","mailfree.ml","mailfreeonline.com","mailfs.com","mailftp.com","mailgenie.net","mailgo.cyou","mailguard.me","mailgutter.com","mailhaven.com","mailhazard.com","mailhazard.us","mailhex.com","mailhood.com","mailhz.me","mailimate.com","mailin8r.com","mailinatar.com","mailinater.com","mailinator.co.uk","mailinator.com","mailinator.gq","mailinator.info","mailinator.net","mailinator.org","mailinator.us","mailinator0.com","mailinator1.com","mailinator2.com","mailinator2.net","mailinator3.com","mailinator4.com","mailinator5.com","mailinator6.com","mailinator7.com","mailinator8.com","mailinator9.com","mailinblack.com","mailincubator.com","mailingaddress.org","mailingweb.com","mailisent.com","mailisia.com","mailismagic.com","mailita.tk","mailite.com","mailjunk.cf","mailjunk.ga","mailjunk.gq","mailjunk.ml","mailjunk.tk","mailku.co","maill.wuwang1028.bond","mailllshop.website","maillog.uk","mailmagnet.co","mailmate.com","mailmaxy.one","mailmay.org","mailme.dk","mailme.gq","mailme.ir","mailme.lv","mailme24.com","mailmenot.io","mailmetrash.com","mailmight.com","mailmij.nl","mailmmo.net","mailmoat.com","mailmoth.com","mailms.com","mailna.biz","mailna.co","mailna.in","mailna.me","mailnada.cc","mailnada.com","mailnator.com","mailnesia.com","mailnet.io.vn","mailnew.com","mailnoop.store","mailnull.com","mailnuo.com","mailo.edu.pl","mailold.us","mailonaut.com","mailontod.com","mailops.com","mailorc.com","mailorg.org","mailosaur.net","mailox.fun","mailoye.com","mailp.org","mailpanda.com","mailphu.com","mailpick.biz","mailpluss.com","mailpokemon.com","mailpooch.com","mailpoof.com","mailpost.zzn.com","mailpress.gq","mailpride.com","mailpro.lat","mailpro.live","mailproxsy.com","mailpts.com","mailpull.com","mailpuppy.com","mailquack.com","mailrock.biz","mailroom.com","mailru.com","mailrun.one","mails.cm","mailsa.biz.id","mailsa.my.id","mailsac.com","mailsafe.fr.nf","mailsbay.com","mailscrap.com","mailseal.de","mailsent.net","mailserv.info","mailservice.ms","mailshan.com","mailshell.com","mailshiv.com","mailshou.com","mailshun.com","mailshuttle.com","mailsiphon.com","mailslapping.com","mailslite.com","mailslurp.com","mailsmtp.qzz.io","mailstart.com","mailstartplus.com","mailsucker.net","mailsurf.com","mailt.net","mailt.top","mailtag.com","mailtao.me","mailtechx.com","mailtecom.com","mailtemp.info","mailtemple.xyz","mailtemporaire.com","mailtemporaire.fr","mailtest.ccwu.cc","mailto.de","mailto.plus","mailtome.de","mailtothis.com","mailtraps.com","mailtrash.net","mailtrix.net","mailtub.com","mailtv.net","mailtv.tv","mailueberfall.de","mailuniverse.co.uk","mailup.net","mailvip.net","mailw.site","mailwire.com","mailworks.org","mailx.04.mom","mailx.click","mailxyz.cyou","mailyan.my.id","mailzi.ru","mailzilla.com","mailzilla.org","mailzy.org","mainerfolg.info","mainkask.site","make.cc.cd","makemenaughty.club","makemetheking.com","makeraura.online","makertrial.com","makesomestone.shop","makmursrondol.store","makoli.sbs","makoli.space","maktoob.com","malahov.de","malayalamdtp.com","malayalamtelevision.net","malioter.pro","maltesemail.com","mama3.org","mamabood.com","mamangbadrut.site","mamber.net","mameganteng.store","mamulenok.ru","managedisabled.online","manager.de","mancity.net","mandraghen.cf","manhmmonew.online","manifestgenerator.com","mannawo.com","mansiondev.com","mantrafreenet.com","mantramail.com","mantraonline.com","manupay.com","manybrain.com","maohe.cloud","mapsguy.com","marchguidesassociation.org","marchguidesassociation.org.uk","marchmail.com","marhumal.tech","mariahc.com","marijuana.com","marijuana.nl","marineso.com","mariyaa.pp.ua","mark-compressoren.ru","markableytrust.org.uk","markaihub.shop","markandvirginiarometty.org","marketlink.info","markmurfin.com","marksia.com","markstonehub.org","married-not.com","marrytodo.de","marsattack.com","martenson-mail.mywire.org","martenson-mail.ooguy.com","martenson-mail.theworkpc.com","martindalemail.com","masbahlil.xyz","mash4077.com","mask03.ru","maskmy.id","masonline.info","masrawy.com","masteryforn.shop","masupost.tokenized.name","maswae.world","matamuasu.ga","matchpol.net","matjoa.com","matmail.com","matmayer.com","matprivate.tokenized.name","matra.site","mats.edu.pl","mauimail.com","mauritius.com","max-mail.org","maximail.vip","maxleft.com","maxmail.co.uk","maxresistance.com","maxseeding.com","maxtanie.com","maxturns.com","maxxspace.com","mayre.shop","mbox.com.au","mbox.re","mbx.cc","mbygjjo.mywire.org","mc-fly.be","mc088ue.loseyourip.com","mcache.net","mcdomaine.fr.nf","mchasd.eu.cc","mchsi.com","mciek.com","mcpservers.one","mcs.cc.cd","mcuma.com","mcunnm.ccwu.cc","mdahld.eu.cc","mdhc.tk","mdz.email","me-mail.hu","me.com","meantinc.com","mebeiuk.co.uk","mebelnu.info","mech2build.io.vn","mechanicalresumes.com","mechanicspedia.com","medevsa.com","mediaeast.uk","mediaholy.com","medical.net.au","medicichoir.org","mediseat.com","medkabinet-uzi.ru","medscape.com","meef.uk","meepsheep.eu","meetingmall.com","meevpo.id","megaegg.ne.jp","megago.com","megamail.pt","megapoint.com","megasend.org","mehda.eu.cc","mehr-bitcoin.de","mehrani.com","mehtaweb.com","meidecn.com","meikeya.com","meine-dateien.info","meine-diashow.de","meine-fotos.info","meine-urlaubsfotos.de","meinspamschutz.de","meinvr.com","meitu.io.vn","meituy.com","mekhong.com","mekqh.eu.cc","melbourne.edu.pl","mellowwish.angelina.syrf109475.top","melodymail.com","meloo.com","meltcoo.com","meltedbrownies.com","meltmail.com","meltp.com","memeazon.com","memoniclife.online","memsg.site","meng2026.bond","meng2026.cyou","mengma.eu.cc","mengundang.live","mentonit.net","meocon.org","meomo.store","meonvr.com","mepost.pw","merda.flu.cc","merda.igg.biz","merda.nut.cc","merda.usa.cc","merepost.com","merry.pink","meruado.uk","merumart.com","merxo.me","mesemails.fr.nf","mesh.ad.jp","mess-mails.fr.nf","message.hu","message.myspace.com","messagebeamer.de","messages.to","messibucu.click","messwiththebestdielikethe.rest","meta.aid.pl","meta.auto.pl","meta.corsica","meta.mail.pl","meta.ua","metacrawler.com","metadownload.org","metaintern.net","metajaya.biz.id","metalfan.com","metalunits.com","metaorbitx.com","metaping.com","metas.io.vn","metta.lk","mexicomail.com","mexvat.com","mezimages.net","mfapi.dpdns.org","mfsa.info","mfsa.ru","mfunza.com","mfxis.com","mgdns.shop","mgtop.cc","mgxianlu.gq","mhzayt.online","miaferrari.com","mianfeibuluo.com","miaowuai.buzz","miauj.com","michaeladmin.eu","michaeladmin.fr","michaeladmin.org","michaeladmin.store","mickaben.fr.nf","midcoastcustoms.com","midcoastcustoms.net","midcoastsolutions.com","midcoastsolutions.net","middletoncheneyuc.uk","mideastlens.com","mideastview.com","midiharmonica.com","midlertidig.com","midlertidig.net","midlertidig.org","midwestpride.org","mierdamail.com","miesto.sk","mighty.co.za","migmail.net","migmail.pl","migumail.com","mihep.com","miho-nakayama.com","miho.uk","miistermail.fr","mijnhva.nl","mikasa.ccwu.cc","mikesomelike.shop","mikfarm.com","mikrotamanet.com","mikrotikvietnam.com","mikrotikvn.com","mikrotikx.com","mikumirai.top","milertz.com","millionaireintraining.com","millionairemail.com","milllogiciel.asia","milmail.com","miloras.fr.nf","mimer.no","mimimail.me","minafter.com","mindless.com","mindspring.com","minefieldmail.com","mineo.jp","minhquang2000.com","minidmx.icu","minimail.gq","minister.com","ministry-of-silly-walks.de","minitts.net","minsmail.com","mintemail.com","minuteafter.com","minuteinbox.com","miomail.indevs.in","mipg.autos","mirai.re","mirasync.tokyo","miros.cloud","misery.net","miss.sryze.cc","missionbulldogs.org","missyoutoo.fun","misterpinball.de","mitico.org","mitrabisa.com","mitraprem.online","mitraprem.site","mittalweb.com","miucce.com","miwacle.com","mixmail.com","mixmail.site","mixzu.net","mjfrogmail.com","mji.ro","mjj.edu.ge","mjukglass.nu","mkeya.com","mkpfilm.com","mkql.autos","mkseiuuda.top","mkvesta.io.vn","mkvo.hair","mkzaso.com","ml1.net","ml8.ca","mlanm.online","mlb.bounce.ed10.net","mlgmail.top","mliok.com","mlumzmh.cn","mm.my","mm.st","mm2flip.pw","mm5.se","mmail.wuwang1028.bond","mmaily.com","mmcat.icu","mmdesign.work.gd","mmmggg0123.ccwu.cc","mmmo.us.ci","mmo.us.ci","mmo365.store","mmyuu.cn","mnode.me","mns.ru","mnvr.site","moakt.cc","moakt.co","moakt.com","moakt.ws","mobilbatam.com","mobileninja.co.uk","mobilevpn.top","moburl.com","mochamail.com","mockata.net","mockmyid.com","modirosa.com","modolku.store","moeri.org","mofu.be","mohammed.com","mohemil.com","mohmal.com","mohmal.im","mohmal.in","mohmal.tech","moimoi.re","mokondo.today","mokondoo.cyou","mokook.com","molabo.bond","moldind.help","moldova.cc","moldova.com","moldovacc.com","molms.com","momentics.ru","momoi.uk","momopifa.cc.cd","momoshe.com","momroad.org","momslife.com","mona.edu.kg","mona.edu.pl","mona.edu.rs","monachat.tk","monadi.ml","monchu.fr","moncourrier.fr.nf","mondial.asso.st","monemail.com","monemail.fr.nf","money.net","moneypipe.net","monglung.space","mongrec.top","monity.top","monmail.fr.nf","monomoho.site","monopacket.com","monoscalar.com","montevideo.com.uy","monumentmail.com","monyal.shop","moolee.net","moonapps.org","moondyal.com","moonfee.com","moonikent.us","moonman.com","moonstarsun.shop","moonwake.com","mooo.com","moose-mail.com","moot.es","mopera.net","mopess.help","mor19.uu.gl","mora45ktil.io.vn","moreawesomethanyou.com","moreorcs.com","morriesworld.ml","morsin.com","mortaza.com","moruzza.com","mosaicfx.com","moscowmail.com","mosswoodmissionhall.bio","most-wanted.com","mostlysunny.com","motion.jo3.org","motique.de","motormania.com","mountainregionallibrary.net","moutianwuliu.top","movemail.com","movieluver.com","mowan666.com","mowline.com","mox.pp.ua","moy-elektrik.ru","moyang303.de5.net","moza.pl","mozej.com","mp-j.ga","mp3oxi.com","mp4.it","mpk.ovh","mr-email.fr.nf","mr-potatohead.com","mr24.co","mrcheannko45k.io.vn","mriscan.live","mriscanner.live","mrizkifreelace.dpdns.org","mrnz.skin","mrotzis.com","mrphoto.org","mrvpm.net","mrvpt.com","msarra.com","mscold.com","msgbox.com","msgos.com","msn-mail-free-1.dynv6.net","msn-mail-free-1092.dynv6.net","msn-mail-free-1268.dynv6.net","msn-mail-free-1522.dynv6.net","msn-mail-free-1659.dynv6.net","msn-mail-free-1750.dynv6.net","msn-mail-free-189.dynv6.net","msn-mail-free-1974.dynv6.net","msn-mail-free-1980.dynv6.net","msn-mail-free-2112.dynv6.net","msn-mail-free-2193.dynv6.net","msn-mail-free-2205.dynv6.net","msn-mail-free-2634.dynv6.net","msn-mail-free-2681.dynv6.net","msn-mail-free-3011.dynv6.net","msn-mail-free-3229.dynv6.net","msn-mail-free-3232.dynv6.net","msn-mail-free-3270.dynv6.net","msn-mail-free-33.dynv6.net","msn-mail-free-3312.dynv6.net","msn-mail-free-3373.dynv6.net","msn-mail-free-3414.dynv6.net","msn-mail-free-3622.dynv6.net","msn-mail-free-3632.dynv6.net","msn-mail-free-3737.dynv6.net","msn-mail-free-3812.dynv6.net","msn-mail-free-4062.dynv6.net","msn-mail-free-4088.dynv6.net","msn-mail-free-4151.dynv6.net","msn-mail-free-4290.dynv6.net","msn-mail-free-4304.dynv6.net","msn-mail-free-4411.dynv6.net","msn-mail-free-4518.dynv6.net","msn-mail-free-4640.dynv6.net","msn-mail-free-4718.dynv6.net","msn-mail-free-4868.dynv6.net","msn-mail-free-5064.dynv6.net","msn-mail-free-5162.dynv6.net","msn-mail-free-5184.dynv6.net","msn-mail-free-5198.dynv6.net","msn-mail-free-5402.dynv6.net","msn-mail-free-5415.dynv6.net","msn-mail-free-554.dynv6.net","msn-mail-free-5696.dynv6.net","msn-mail-free-5718.dynv6.net","msn-mail-free-5872.dynv6.net","msn-mail-free-6047.dynv6.net","msn-mail-free-6113.dynv6.net","msn-mail-free-6326.dynv6.net","msn-mail-free-6581.dynv6.net","msn-mail-free-6589.dynv6.net","msn-mail-free-6760.dynv6.net","msn-mail-free-678.dynv6.net","msn-mail-free-6877.dynv6.net","msn-mail-free-6883.dynv6.net","msn-mail-free-6906.dynv6.net","msn-mail-free-6943.dynv6.net","msn-mail-free-6959.dynv6.net","msn-mail-free-6981.dynv6.net","msn-mail-free-708.dynv6.net","msn-mail-free-7155.dynv6.net","msn-mail-free-727.dynv6.net","msn-mail-free-733.dynv6.net","msn-mail-free-7424.dynv6.net","msn-mail-free-7429.dynv6.net","msn-mail-free-7434.dynv6.net","msn-mail-free-7509.dynv6.net","msn-mail-free-7570.dynv6.net","msn-mail-free-7742.dynv6.net","msn-mail-free-7760.dynv6.net","msn-mail-free-8047.dynv6.net","msn-mail-free-810.dynv6.net","msn-mail-free-8131.dynv6.net","msn-mail-free-8282.dynv6.net","msn-mail-free-8582.dynv6.net","msn-mail-free-86.dynv6.net","msn-mail-free-8632.dynv6.net","msn-mail-free-8704.dynv6.net","msn-mail-free-8776.dynv6.net","msn-mail-free-8841.dynv6.net","msn-mail-free-890.dynv6.net","msn-mail-free-8952.dynv6.net","msn-mail-free-8986.dynv6.net","msn-mail-free-9002.dynv6.net","msn-mail-free-9061.dynv6.net","msn-mail-free-9121.dynv6.net","msn-mail-free-9173.dynv6.net","msn-mail-free-9224.dynv6.net","msn-mail-free-9313.dynv6.net","msn-mail-free-9368.dynv6.net","msn-mail-free-9382.dynv6.net","msn-mail-free-9444.dynv6.net","msn-mail-free-9536.dynv6.net","msn-mail-free-9587.dynv6.net","msn-mail-free-9597.dynv6.net","msn-mail-free-9649.dynv6.net","msn-mail-free-9734.dynv6.net","msn-mail-free-9921.dynv6.net","msn-mail-free-9990.dynv6.net","msn-mail-free-9998.dynv6.net","msn.cn","msn.co.uk","msn.com","msn.nl","mspeciosa.com","msqatl.com","msrc.ml","msssg.com","msvw.skin","mswork.ru","msxd.com","mt2009.com","mt2014.com","mt2015.com","mt2016.com","mtdalmshouse.fitness","mtdalmshouse.uk","mtdog.xyz","mtmdev.com","mtnewtoy.us","mtshop18.io.vn","mttestdriver.com","mua.lacdn.cn","muadaingan.com","muareview.com","muataikhoan.info","muathegame.com","muchomail.com","mucincanon.com","mudahmaxwin.com","muehlacker.tk","muell.icu","muell.io","muell.monster","muell.xyz","muellemail.com","muellmail.com","muetop.store","mugadget.com","mugstock.com","muhaos.com","mui.cc.cd","mui.de5.net","mukn.skin","multicorse.com","muncloud.com","mundomail.net","munich.com","munik.edu.pl","munoubengoshi.gq","muonwhila.com","muralin-aja.com","muratec.eu.org","muratreis.icu","music.com","musiccode.me","musicflow.buzz","musician.org","musicscene.org","musiku.studio","muskelshirt.de","muslim.com","muslimsonline.com","mutant.me","mutantweb.com","mutudev.com","mvpmedix.com","mvrht.com","mvrht.net","mwalshabs.dev","mwarner.org","mwlp.skin","mwqj.xyz","mxclip.com","mxfuel.com","mxhquxyi.top","mxmm.hair","mxvia.com","mxwm.hair","my-pomsies.ru","my-teddyy.ru","my.com","my10minutemail.com","myamya.tech","mybitti.de","mybox.it","mycabin.com","mycity.com","mycleaninbox.net","mycool.com","mycorneroftheinter.net","mycreativeinbox.com","myde.ml","mydefipet.live","mydemo.equipment","mydomain.com","mydotcomaddress.com","myecho.es","myemailboxy.com","myerly.com","myfamily.com","myfastmail.com","myfxspot.com","mygeoweb.info","mygo.com","myhochzeitsfilm.de","myhosrn.servehalflife.com","myindohome.services","myinfoinc.com","myinterserver.ml","myiris.com","mykickassideas.com","myletters.online","mymacmail.com","mymail-in.net","mymail.infos.st","mymail90.com","mymaildo.kro.kr","mymailoasis.com","mymaily.lol","mymrxuyrd.top","mynamedot.com","mynes.com","mynet.com","mynetaddress.com","mynetstore.de","mynoop.store","myntora.cfd","myopang.com","myownemail.com","myownfriends.com","mypacks.net","mypad.com","mypartyclip.de","mypdj08.mywire.org","mypersonalemail.com","mypethealh.com","myphantomemail.com","mypk.beer","myplace.com","myrambler.ru","myrealbox.com","myremarq.com","mysadfjwefwf.us.ci","mysamp.de","myself.com","myself.fr.nf","myspaceinc.com","myspaceinc.net","myspaceinc.org","myspacepimpedup.com","myspamless.com","mystupidjob.com","mystvpn.com","mysugartime.ru","mytemp.email","mytempemail.com","mytempmail.com","mythirdage.com","mytrashmail.com","mywarnernet.net","myway.com","myweblaw.com","myworldmail.com","mywrld.site","mywrld.top","myxentra.cfd","myzx.com","mzico.com","mzl2wvp6.nsmjj.tech","n1nja.org","n2.com","n24n8x9.giize.com","n2baseball.com","n2business.com","n2mail.com","n2soccer.com","n2software.com","n5.jesys.net","n8.gs","na-cat.com","na3qxuk.kozow.com","naacpadvancement.org","naah.ru","naah.store","nabaxox.edu.pl","nabc.biz","nabilalo.bond","nabomail.com","nabuma.com","nada.email","nada.ltd","nafe.com","nagi.be","nagpal.net","nailooong.site","naka.edu.pl","nakedgreens.com","nakedtruth.biz","namdevmail2.qzz.io","name.com","namenan.me","nameplanet.com","namesgeneratorhub.com","namewok.com","nana10.co.il","nanana.uk","nandomail.com","nangspa.vn","naniniva.com","nanonym.ch","nanopools.info","nanoskin.vn","naobk.com","naocan.org","naplesnews.net","napthex4.com","naqulu.com","naraka.eu.cc","narrowment.com","narsub.online","narsub.shop","naseej.com","nashapoultryshop.com","naslazhdai.ru","natachai.me","natange.org.uk","nate.com","nategetvpn.store","nationalgardeningclub.com","nativestar.net","nativeweb.net","natuanal.com","naui.net","nautonk.com","navalcadets.com","naver.com","naverapp.com","naverly.com","navermail.kr","navigator.lv","navura.in","navy.org","nawmin.info","naxx.dev","naylonksosmed.com","naymedia.com","naz.com","nazisat.com","nb.syh.888.moe","nb.syh.new.cd","nb.syh.rua.ci","nbmbb.com","nbskyhope.shop","nbspace.us","nbvrluhsh.top","nbzmr.com","nbzy.hair","nc.rr.com","ncfx.beer","nchoicemail.com","ncien.com","ncleap.com","ndade.eu.cc","ndnphim.io.vn","ndut.pro","neatdaynote.com","necub.com","neeva.net","negated.com","neghtlefi.com","neko2.net","nekochan.fr","nekosan.uk","nemomo.org","nemra1.com","nenter.com","neo.rr.com","neomailbox.com","neosstudy.work","neotlozhniy-zaim.ru","neowd.com","nepwk.com","neroki.shop","nervhq.org","nervmich.net","nervtmich.net","nesopf.com","nespf.com","nespj.com","nespressopixie.com","nestlynotes.com","net-c.be","net-c.ca","net-c.cat","net-c.com","net-c.es","net-c.fr","net-c.it","net-c.lu","net-c.nl","net-c.pl","net-pager.net","net-shopping.com","net1mail.com","net4b.pt","net4you.at","netbounce.com","netbroadcaster.com","netby.dk","netc.eu","netc.fr","netc.it","netc.lu","netc.pl","netcenter-vn.net","netcmail.com","netcnet.uk","netcom.no","netcom.ws","netcourrier.com","netexecutive.com","netexpressway.com","netfusionhub.surf","netfxd.com","netgcp.online","netgenie.com","netherfieldvillagehall.co.uk","nethubmail.net","netian.com","netizen.com.ar","netlane.com","netlimit.com","netmails.com","netmails.net","netmongol.com","netn.top","netnet.com.sg","netnoir.net","netoiu.com","netpiper.com","netposta.net","netralink.com","netricity.nl","netris.net","netscape.net","netscapeonline.co.uk","netsgo.com","netspace.net.au","netspeedway.com","netsquare.com","netster.com","nettaxi.com","nettemail.com","netterchef.de","netti.fi","netviewer-france.com","networksolutionshk.asia","netzero.com","netzero.net","netzidiot.de","neue-dateien.de","neuf.fr","neuro.md","nevanata.com","neverlose.eu.cc","nevermail.de","neverover.life","nevinxu.cc.cd","nevinxu.ccwu.cc","new-api.cc.cd","newaddr.com","newbpotato.tk","newbreedapps.com","newconnect.uk","newdelhi.io.vn","newfilm24.ru","newgreenpath.org","newideasfornewpeople.info","newmail.com","newmail.net","newmail.ru","newmail.top","newmano.store","news.sowhy.de5.net","newsboysmail.com","newsteadabbeypartnership.org","newyork.com","newyork.io.vn","nexarisystems.online","nexarsh.store","nexarshop.store","nexentia.cfd","nexio.sbs","nexorabio.pro.vn","nexosphere.lifestyle","next.ovh","nextmail.info","nextmail.ru","nextpomi.dynv6.net","nextstopvalhalla.com","nextsuns.com","nexus-streams.online","nexushost.site","nexverseal.shop","nexxmail.com","nezdiro.org","nezid.com","nezuka.net","nezumi.be","nezzart.com","nfast.net","nfengwu.bond","nfkah.eu.cc","nfmail.com","nfuo.makeup","nghienplus.io.vn","nghienplus.store","nguyendanhkietisocial.com","nguyenlieu24h.com","nguyentinhblog.com","nguyenusedcars.com","nh3.ro","nhienpv1.io.vn","nhmi1.com","nhmvn.com","nhoopmail.store","nhotv.com","nhungdang.xyz","niang-sfx.biz","nianshen09.help","nianshens.help","nice-4u.com","nice.qzz.io","nicebad.com","nicebush.com","nicegal.com","niceground.shop","nicemail.cc","niceminute.com","nichaoxing.cc","nicholastse.net","nick-ao.com","nickmxh.com","nicknassar.com","nicolastse.com","nicusaurelus.online","niede.de","nifty.com","nifty.ne.jp","nigeriansincoventry.org","nightfood.studio","nightmail.com","nightorb.com","nik.edu.pl","nikopage.com","nikora.fr.nf","nimail.com","nimbacharity.com","nimbusreach.info","nincsmail.com","nincsmail.hu","ninepacman.com","ninfan.com","ninjarapid.com","niprack.com","nirvanafan.com","niseko.be","niulaibulai.me","niwave.shop","niwave.top","niwl.net","njwzzvmtin.my","nlpdy8m.ooguy.com","nm123.com","nm7.cc","nmail.cf","nnh.com","nnnetworks.com","nnot.net","nnoway.ru","no-spam.ws","no-trash.ru","no-ux.com","no2bullyingatwork.org.uk","noavar.com","nobinbox.com","noblepioneer.com","nobugmail.com","nobulk.com","nobuma.com","noc5yva.theworkpc.com","noclickemail.com","nocp.ru","nocp.store","nodejs.uk","nodezine.com","noexpire.top","nogmailspam.info","noicd.com","noinspect.top","noizonicfoundation.com","nokdot.com","nokiamail.com","nolemail.ga","nolettersbox.com","nomail.cf","nomail.ga","nomail.pw","nomail2me.com","nomes.fr.nf","nomomail.com","nomorespamemails.com","nomorix.cfd","nonchalantresmita.biz","nondon.site","nondon.store","nongnue.com","nonpartisan.com","nonspam.eu","nonspammer.de","nonze.ro","nooploop.store","noopmail.com","noos.fr","noproposal.com","noref.in","noreply.fr","nori24.tv","norika-fujiwara.com","norikomail.com","norovpn.site","norseforce.com","northboveymeadow.business","northgates.net","northsixty.com","norvanta.cfd","norwegischlernen.info","noship.shop","noshiper.pro","nospam.fr.nf","nospam.today","nospam4.us","nospamfor.us","nospammail.net","nospamthanks.info","nosubcriber.shop","notboxletters.com","nothingtoseehere.ca","notif.me","notify.nothing688.de5.net","notipr.com","notlettersmail.com","notmailinator.com","notrnailinator.com","notsharingmy.info","novacontigencia.xyz","novaemail.com","novaprime.vip","novaspherelabs.store","novasub.click","novyrix.cfd","now.im","nowhere.org","nowmymail.com","nowmymail.net","nownuri.net","nowrouter.store","nowtopzen.com","nowyoudme1.cc.cd","noyavip.com","noyp.fr.nf","nproxi.com","nqmo.com","nrbs.me","nrehi.com","nriza.com","nrlord.com","ns01.biz","nsvpn.com","nsyncxy.com","ntebb.no","ntelos.net","nthrl.com","ntlhelp.net","ntlworld.com","ntmtep.xyz","ntscan.com","ntto.us","nttoadmin2.us","nu9233b.theworkpc.com","nubescontrol.com","nucleant.org","nuitx.com","nuknjkv.ooguy.com","null.net","nulla.de5.net","nullbox.asia","nullbox.info","numericable.fr","nuoifb.com","nuox.eu.org","nur-fuer-spam.de","nurfuerspam.de","nut.cc","nutpa.net","nuts2trade.com","nv6ei2v.kozow.com","nvhrw.com","nvqt304.xyz","nwfa.hair","nwldx.com","nwrlr.org","nwytg.com","nwytg.net","nxdbxd.dpdns.org","nxdbxd.indevs.in","nxdbxd.top","nxirad.online","nxt.ru","ny.com","ny7.me","ny7u9qr.kozow.com","nyasan.com","nyawit.id","nybella.com","nyc.com","nycmail.com","nyfhk.com","nygren-realty.com","nygrenrealty.com","nypato.com","nyrmusic.com","nyxmail.pro","nyxpanel.xyz","nyxstores.id","nzoomail.com","o-tay.com","o2.co.uk","o2.pl","o2stk.org","o2y50o5.loseyourip.com","o326lav.kozow.com","o7i.net","oaifree.ai6.me","oaklandas-fan.com","oakon.com","oalsp.com","oath.com","obelion.cfd","obfusko.com","objectmail.com","obobbo.com","oborudovanieizturcii.ru","obxpestcontrol.com","oc.lacdn.cn","ocbxpz3.camdvr.org","oceanfree.net","oceanz.tech","oceva.site","ocn.ne.jp","octovie.com","oczt15m.kozow.com","odaymail.com","oddpost.com","odeask.com","odem.com","odmail.com","odn.ad.jp","odn.ne.jp","odnorazovoe.ru","oebd.hair","oepia.com","oerpub.org","ofanda.com","office-dateien.de","office-email.com","officecombine.com","offrework.click","offroadwarrior.com","offshore-proxies.net","ofisher.net","ogoplace.pro","ogrencikredisi.org","ogzmail.com","ohaaa.de","ohgitu.me","ohi.tw","ohm.edu.pl","oicexchange.com","oida.icu","oiioii.email","oiioii.vip","oikrach.com","oing.cf","okauq.store","okbank.com","okcdeals.com","okclprojects.com","okcx.edu.rs","okcxhssgk.top","okexbit.com","okhko.com","okhuman.com","okiae.com","okinawa.li","okmad.com","okmagic.com","okname.net","okrent.us","oku.ovh","okuk.com","oky.ovh","okzk.com","oldao.com","oldies104mail.com","ole.com","olemail.com","oletters.com","oliespace.id","oliespace.site","olimp-case.ru","olipii.com","olisup.cyou","oliviadiffuser.store","oloh.ru","oloh.store","olympist.net","olypmall.ru","olzx.skin","omail.de","omail.pro","omanarts.com","omaninfo.com","omarnasrrr.com","omeie.com","omen.ru","omfg.run","omgheels.com","omkiujk.ddnsgeek.com","omnievents.org","omnilog.space","omnisent.cfd","omnivex.cfd","omonomon.shop","omtecha.com","onbap.com","one-mail.top","one-ml.com","one-sec-mail.site","one-time.email","one2mail.info","onebox.com","onekisspresave.com","onelettersmail.com","onemail.host","onemuou.com","onenet.com.ar","oneoffemail.com","oneoffmail.com","onet.com.pl","onet.eu","onet.pl","onetm-ml.com","onetm.jp","onetopclick.online","oneummahorg.uk","onewaymail.com","onheb.com","oninet.pt","onion.ee.eu.org","onionred.com","oniventa.cfd","onlatedotcom.info","onldm.net","online-home.de","online.de","online.ie","online.ms","online.nl","online.no","onlinecmail.com","onlinehome.de","onlineidea.info","onlinewiz.com","only4gamers.shop","onlyapp.net","onmailflare.com","onmilwaukee.com","onobox.com","onqin.com","onsbrabantnet.nl","ontasa.com","ontyne.biz","oohioo.com","oolus.com","oonies-shoprus.ru","oooooooo.store","oopi.org","oosln.com","oovk.ru","oovk.store","ooxxoo.asia","ooynib.com","ooyv.homes","op.pl","opayq.com","opelkun.net","opemails.com","openagent.cfd","openavz.com","openclawskill.shop","opendns.ro","openedclaw.top","openmail.pro","openmailbox.org","opentrash.com","openwrt.qzz.io","operafan.com","operamail.com","opihhushdjn.cyou","opmmedia.ga","opoczta.pl","opog.hair","opog.skin","oposite.org","opp24.com","opportunity-africa.com","optician.com","optimaweb.me","optivex.cfd","optonline.net","optusnet.com.au","opwebw.com","oqgd.skin","oqmy.hair","oranek.com","orange.fr","oravantis.cfd","oravell.cfd","orbit25k.io.vn","orbitel.bg","orbitxhive.com","orbixacoa.com","orceqjqw.top","ordinaryamerican.net","ordite.com","oreidresume.com","orgmail.net","orgmail.pro","orgmbx.cc","orimassage.com","oroki.de","oronny.com","orsbap.com","orthodontist.net","ortogenmail.com","orwpaztm.cfd","osaxadinhos.com.br","oscarluna.site","oscarluna.xyz","oshietechan.link","oshjr-24.xyz","osifixtech.com.mx","osite.com.br","oskarstalbergcitygenerator.com","oso.com","ospirun.com","ostahie.com","ostinmail.com","osuzu.eu.cc","osxofulk.com","otakumail.com","otherinbox.com","otmail.jp","otona.uk","otpku.com","ottsathi.store","ouchcloud.com","ouk.me","oupul8b1k.bond","oupul8b1k.cyou","our-computer.com","our-office.com","our.st","ourbrisbane.com","ourklips.com","ourl.me","ournet.md","ourpreviewdomain.com","outboxmint.com","outdaremusicdevon.org","outgun.com","outiook.com","outlawspam.com","outlook.at","outlook.be","outlook.cl","outlook.co.id","outlook.co.il","outlook.co.nz","outlook.co.th","outlook.co.uk","outlook.com","outlook.com.au","outlook.com.br","outlook.com.gr","outlook.com.pe","outlook.com.tr","outlook.com.vn","outlook.cz","outlook.de","outlook.dk","outlook.edu.pl","outlook.es","outlook.fr","outlook.hu","outlook.ie","outlook.in","outlook.it","outlook.jp","outlook.kr","outlook.lv","outlook.my","outlook.nl","outlook.ph","outlook.pt","outlook.sa","outlook.sg","outlook.sk","outlook.tw","outlookapp.tech","outlooks.bond","outmail.win","ovbest.com","over-the-rainbow.com","ovomail.co","ovpn.to","owdrcro.giize.com","owleyes.ch","owlpic.com","ownmail.net","ownsyou.de","owo-mailteam.bond","owo-mailteam.cyou","owovo.site","owube.com","oxfo.edu.pl","oxmail.homes","oxopoha.com","oxvq.hair","oyisam.my","oynsuxe.ooguy.com","oyoa.hair","oyoa.skin","ozatvn.com","ozbytes.net.au","ozemail.com.au","ozjp.skin","ozm.fr","ozsaip.com","ozvmail.com","ozyl.de","p-aac.top","p-banlis.ru","p-kk2.icu","p-ttz.top","p-y.cc","p0dl9ik.giize.com","p1aintiff.qzz.io","p2bvz.cyou","p33.org","p3t8dyv.mywire.org","p6vvvok.mywire.org","p71ce1m.com","p94y7ff.camdvr.org","pa9e.com","pacbell.net","pachilly.com","pacific-ocean.com","pacific-re.com","pacificwest.com","packersfan.com","packiu.com","padue.app","pagamenti.tk","pagina.de","pagons.org","paharpurmim.ga","pakadebu.ga","pakistanmail.com","pakistanoye.com","palaze.cc","paldonanamansilolo.online","palestinemail.com","paliospiti.com","pamaweb.com","pamil.fr.nf","pancakemail.com","panda.tnc.ne.jp","pandai.in","pandey.lol","pandora.be","pandorasboxproductions.org","panlix.cloud","papierkorb.me","paplease.com","para2019.ru","paran.com","paratrabajar.xyz","paris.edu.pl","parisdaily.fr","parkjiyoon.com","parlimentpetitioner.tk","parsitv.com","parsmail.com","parthekio.live","parthxxtoasts.site","partlycloudy.com","partybombe.de","partyheld.de","partynight.at","parvazi.com","passeone.com","passeone.xyz","passmail.net","passwordmail.com","past-line.com","pastebitch.com","pastipremium.store","pastryofistanbul.com","pathfindermail.com","patientlecadet.online","patity.com","patonce.com","pavilionx2.com","pawobby.cfd","paxlys.com","paylaar.com","payperex2.com","payspun.com","pazard.com","pazuric.com","pbhak.dev","pbis.beer","pbrg4fb.ooguy.com","pcaa.lol","pcbb.lol","pcdo.hair","pckage.com","pconnections.net","pcpostal.com","pcsrock.com","pcusers.otherinbox.com","pddfw.cn","pdf-cutter.com","pdmy.skin","pdood.com","pdx.ne.jp","pe.hu","peakinbox.net","pecinan.com","pecinan.net","pecinan.org","pediatrician.com","pehol.com","pelviro.sbs","penisgoes.in","penoto.tk","penpen.com","peoplepc.com","peopleweb.com","pepamail.com","pepbot.com","percyfx.com","perfectmail.com","perso.be","personal.ro","personales.com","pertera.com","pertok.com","peruss.biz.id","pesagilt.top","petchi.uk","peterdethier.com","peterhe-ai.bond","petloca.com","petlover.com","petml.com","petrzilka.net","pettypool.com","pewpewpewpew.pw","pezeshkpour.com","pflege-schoene-haut.de","pfui.ru","pgxh.skin","phamay.com","phanmembanhang24h.com","phayze.com","phctool.com","philipdowney.com","phimib.com","phimteen.net","phmail.site","phmail.us","phone-elkey.ru","phone.net","photo-impact.eu","photobrex.com","photographer.net","photomark.net","phpbb.uu.gl","phpto.us","phreaker.net","phucmmo.com","phuongnhicare.com","phuotngay.com","phus8kajuspa.cu.cc","phuturemail.com","phyones.com","physcroenmail.com","physicaladithama.io","physicist.net","pi.vu","piaa.me","pianomail.com","picdirect.net","pickuplanet.com","pickupman.com","picturehostel.com","picturehostel.fr","picturehostel.org","picturehostel.store","picusnet.com","pig.pp.ua","pigeonprotocol.com","pigpig.net","pii.at","pikara.ne.jp","piki.si","pilotcloak.com","pimpedupmyspace.com","pinehill-seattle.org","pingddns.net","pingir.com","pingmx.com","pinkgreengenerator.me","pinmx.net","pinoymail.com","pinpool.ai","pipemail.space","pipmmotube.store","pippoc.com","piracha.net","piscesbody.xyz","pisem.net","pisls.com","pitaniezdorovie.ru","pithu.org","pitiful.pp.ua","pivo-bar.ru","pivotylabs.pro","pixdd.com","pixelcroft.org","pixelgagnant.net","pixiil.com","pixoledge.net","pizu.ru","pizu.store","pizuhdev.work","pizzajunk.com","pjjkp.com","pkday.eu.cc","pkdigitalmart.site","pkrj.hair","placebomail10.com","plainhomehub.com","plala.or.jp","planet.nl","planetaccess.com","planetarymotion.net","planetearthinter.net","planetmail.com","planetmail.net","planetout.com","planworker.pro","plasa.com","playasiafootball.xyz","playersodds.com","playful.com","playstation.sony.com","pleasenoham.org","plenoryx.cfd","plexfirm.com","plexflux.app","plexolan.de","plhk.ru","pliz.fr.nf","ploae.com","ploki.fr","ploncy.com","plowcreek.org","plugintonature.org.uk","plus.com","plus.google.com","plusmail.com.br","plw.me","pm.me","pmail.net","pmail.site","pnaz.skin","pngk.uk","pngrise.com","pntvipveo45k.io.vn","pnvipveo25k.io.vn","pobbofqd.top","pobox.hu","pobox.sk","poc4756bb.camdvr.org","pochta.ru","pochtac.ru","poczta.fm","poczta.onet.eu","poczta.onet.pl","poehali-otdihat.ru","poetic.com","pofmagic.com","poisonword.com","pojok.ml","pokemail.net","pokemonpost.com","pokemons1.fr.nf","pokepost.com","pokiemobile.com","polandmail.com","polarkingxx.ml","polbox.com","policeoffice.com","politician.com","politikerclub.de","polizisten-duzer.de","polkaroad.net","polvexar.space","polyfaust.com","polyfaust.net","polysolextcoin.cloud","pongpong.org","ponp.be","pooae.com","poofy.org","pookmail.com","pool-sharks.com","poolemethodists.org.uk","poond.com","pooo.ooguy.com","poopiebutt.club","popaccount.com","popak.work.gd","popcornfarm7.com","popcornfly.com","popesodomy.com","popgx.com","poplk.com","popmail.com","popol.fr.nf","popsmail.com","popstar.com","porjoton.com","porsh.net","porsilapongo.cl","portaltrendsarena.com","portalveil.com","portugalmail.com","portugalmail.pt","portugalnet.com","pos.lukeliou.site","posdz.com","positive-thinking.com","positivevoiceteesvalley.co.uk","post.com","post.cz","post.sk","post.uron.de5.net","posta.ro","posta.store","postaccesslite.com","postacin.com","postafree.com","postaweb.com","postbox.uron.cc.cd","postbx.ru","postbx.store","posteo.af","posteo.at","posteo.be","posteo.ch","posteo.cl","posteo.co","posteo.co.uk","posteo.cr","posteo.cz","posteo.de","posteo.dk","posteo.ee","posteo.es","posteo.eu","posteo.fi","posteo.gl","posteo.gr","posteo.hn","posteo.hr","posteo.hu","posteo.ie","posteo.in","posteo.is","posteo.jp","posteo.la","posteo.li","posteo.lt","posteo.lu","posteo.me","posteo.mx","posteo.my","posteo.net","posteo.nl","posteo.no","posteo.nz","posteo.org","posteo.pe","posteo.pl","posteo.pm","posteo.pt","posteo.ro","posteo.ru","posteo.se","posteo.sg","posteo.si","posteo.tn","posteo.uk","posteo.us","postfach.cc","postinbox.com","postino.ch","postmark.net","postmaster.co.uk","postmaster.twitter.com","postonline.me","postpro.net","poubelle-du.net","poubelle.fr.nf","pousa.com","poutineyourface.com","powerdea.me","powered.name","powerencry.com","powerfan.com","powerscrews.com","powlearn.com","pox2.com","pozima.rest","pp-n6.top","pp-tw.cc","pp.inet.fi","pp7rvv.com","pp9vdr0.ddnsfree.com","ppdf.cc","ppedu.pp.ua","ppetw.com","ppoo.ccwu.cc","pptrvv.com","pqoia.com","praize.com","pratikmail.com","pratikmail.net","pratikmail.org","prazdnik-37.ru","prc.cx","predatorrat.cf","predatorrat.ga","predatorrat.gq","predatorrat.ml","predatorrat.tk","premiapp.com","premieragents.net","premierr.site","premigu.co","premirum.shop","premium-mail.fr","premiumapk.store","premiumcrome.site","premiuminternet.site","premiuminternetvpn.xyz","premiumonebd.store","premiumservice.com","premiumsigma.shop","prems.id","premsy.net","presidency.com","press.co.jp","prestige-leadership.org","prestore.space","pretreer.com","pricegh.com","pricegh.fun","pride-worldwi.de","priest.com","primabananen.net","primalhigh.click","primebulidv1.uk","primejetnet.com","primered.shop","primposta.com","primposta.hu","primtech.cn","prin.be","printz.site","prisonity.com","privacy-mail.top","privacy.net","privacyshield.cc","privatdemail.net","privmail.edu.pl","privo.edu.pl","privy-mail.com","privy-mail.de","privymail.de","priyo-mail.com","priyo.edu.pl","priyo.ovh","priyo.site","priyoemail.site","priyomail.in","priyomail.net","priyomail.top","priyomail.uk","priyomail.us","priyor.com","priyp.com","prkmail.xyz","pro-tag.org","pro.hu","pro5g.com","probemail.com","procrackers.com","prodigy.net","productmm.shop","profast.top","progetplus.it","programist.ru","programmer.net","programozo.hu","prohade.com","prohisi.store","proid.cloud-ip.cc","proinbox.com","project2k.com","projectcl.com","promailt.com","promessage.com","promyvia.cfd","prontomail.com","proprietativalcea.ro","propscore.com","prorises.com","prosocial.io.vn","protectsmail.net","protempmail.com","protestant.com","proton.me","protonmail.ch","protonmail.com","protonza.com","prout.be","proveity.com","proxy-gateway.net","proxymail.eu","proxyparking.com","prp-ppdt.app","prtnx.com","prtshr.com","prtz.eu","prydirect.info","psai.run.place","psh.me","psles.com","psnator.com","psoxs.com","psv-supporter.com","ptct.net","ptd.net","ptncereio.com","ptnstudio.vn","ptsculure.com","puabook.com","public-files.de","public.usa.com","publicist.com","puffiqo.store","pugb.vip","puglieisi.com","puji.pro","pulp-fiction.com","pulse25k.io.vn","pulsix.pw","pumpoly.com","punchbagartgallery.org.uk","punkass.com","punkproof.com","puppetmail.de","purcell.email","pureheart.org.uk","purelogistics.org","purifyzed.org","purmuttad.com","purpleturtle.com","pursip.com","pushcom.store","pusmail.com","pussport.com","put2.net","puttanamaiala.tk","putthisinyourspamdatabase.com","puxa.top","pvnmax.space","pwpwa.com","pwrby.com","pwx129.love","pxlys.com","pyrosenex.cfd","pyskillsgame.com","q.com","q06htej.ddnsfree.com","q0y5ffo.kozow.com","q1zx2zj.camdvr.org","q7qipaa.kozow.com","qabq.com","qacmjeq.com","qagk.hair","qaondqs.loseyourip.com","qasti.com","qatarmail.com","qazaxmj.theworkpc.com","qbfree.us","qc.to","qcai.skin","qcgmtzhzh.top","qd.je","qd28max.eu.cc","qejjyl.com","qentic.shop","qeurtor.com","qexvhz.com","qfnt.skin","qgming.qzz.io","qhgs.com","qi3hav9.mywire.org","qiang66.ccwu.cc","qibl.at","qiott.com","qip.ru","qipmail.net","qiq.us","qisdo.com","qisoa.com","qiuvision.com","qjwlaaa.giize.com","qkwv.skin","qkxm.skin","qlbz.hair","qlhub.org.uk","qlto.hair","qmail.com","qmrbe.com","qodiq.com","qoika.com","qopow.com","qoq.indevs.in","qpdm.beer","qprfans.com","qq.com","qq.my","qqcomeback.me","qrio.com","qrt8e6v.ddnsfree.com","qrxs6eh.giize.com","qrzzq7z.ooguy.com","qsl.ro","qsmail.cc.cd","qsuo.uno","qtum-ico.com","quackquack.com","quadrafit.com","quakemail.com","qualbo.com","qualityservice.com","quantentunnel.de","quantorynexus.space","quantumeridian.site","quarkember.com","quarvex.cfd","qudsmail.com","quentavo.cfd","quepasa.com","questtechsystems.com","quick-mail.cc","quickdrop.buzz","quickemail.info","quickhosts.com","quickinbox.com","quickmail.nl","quicknet.nl","quicksend.ch","quickwebmail.com","quiet-branch.com","quiklinks.com","quikmail.com","quillet.eu","quinz.me","quipas.com","quixentra.cfd","qukv.skin","quml.skin","quorixia.cfd","ququb.com","quye.loves-beer.com","qv7.info","qvcq.skin","qvmao.com","qvttclass.us","qvwi.skin","qvy.me","qweasd123.cc.cd","qwer.729406.xyz","qwertyhandsome.net","qwest.net","qwestoffice.net","qwezxc321.cc.cd","qwhost.top","qwickmail.com","qydxproapi.store","qytechs.cn","qzueos.com","r-o-o-t.com","r2money.io.vn","r4.sdfe.app","r4nd0m.de","r8cri1k.theworkpc.com","ra3.us","raakim.com","rabin.ca","rabiot.reisen","rabitex.com","racaho.com","racedriver.com","racefanz.com","racingfan.com.au","racingmail.com","rackabzar.com","racovor.com","radarcloak.com","radeshop.com","radiant-flow.org","radicalz.com","radiku.ye.vc","radioastronomynet.com","radiologist.net","rael.us","raetp9.com","ragingbull.com","rainbib.co.uk","rainbowly.ml","rajaiblis.com","raketenmann.de","rakumail.jp","rakuten.jp","raleigh-construction.com","ralib.com","rambler.ru","ramcen.com","ramenmail.de","ramin200.site","ramizan.com","rancidhome.net","randol.infos.st","randomail.io","randomail.net","rank-expleo.mailinator.com","ranmamail.com","raotus.com","rapidefr.fr.nf","rapplo.com","rapt.be","raqid.com","rastogi.net","ratt-n-roll.com","rattle-snake.com","raubtierbaendiger.de","ravavo.bond","ravc.beer","ravearena.com","ravemail.com","raveqxon.blog","raveqxon.store","rawr.foo","rax.la","raxio.app","raxtest.com","rayrayactive.com","razemail.com","razeny.com","razormail.com","razuz.com","rbb.org","rbmz.beer","rbs1.xyz","rc38643.ddnsfree.com","rcasd.com","rccgmail.org","rccgmanifestinghisglory.co.uk","rcn.com","rcpt.at","rdevmail.tokenized.name","rdklcrv.xyz","rdlt0hi.mywire.org","rdsekaunx.top","re-gister.com","reacc.me","realemail.net","reality-concept.club","realize.edu.pl","reallyfast.biz","reallyfast.info","reallymymail.com","realmail.co","realman.mywire.org","realmka.io","realquickemail.com","realradiomail.com","realseek.xyz","realtyagent.com","realtyalerts.ca","reapsa.com","reason.edu.pl","rebates.stream","reborn.com","receiveee.com","recipeforfailure.com","reclameaqui.services","recode.me","reconmail.com","recyclemail.dk","recycler.com","recyclermail.com","redbiodiesel.com","redfeathercrow.com","redi.fr.nf","rediff.com","rediffmail.com","rediffmailpro.com","rednecks.com","rednotecreatoracademy.art","redproxies.com","redseven.de","redsfans.com","reepar.cyou","reestore.site","refblogs.com","refk.site","reftoken.net","regapts.com","regbypass.com","reggaefan.com","registerednurses.com","regspaces.tk","regvippro.site","reimondo.com","reincarnate.com","rejectmail.com","rejo.technology","rekaer.com","relayne.top","reliable-mail.com","relieve.us.ci","religious.com","remahankerupuk.com","remai.freeddns.org","remail.cf","remail.ga","remarkable.rocks","remind.edu.pl","remote.li","remoteflyer.co.uk","renren.com","rensumo.top","rentaen.com","rentop.asia","renvotra.cfd","renydox.com","reovipvpn.top","repairman.com","reply.hu","reply.ticketmaster.com","replyloop.com","reportfresh.com","representative.com","reptilegenetics.com","rescueteam.com","resgedvgfed.tk","resmso.com","resource.calendar.google.com","restorationchurchtv.com","resumeforest.cn","resumemail.com","reusable.email","reusecomputers.site","reverendneedham.co.uk","reviewfood.vn","revolvingdoorhoax.org","rewermail.com","rexabot.com","rexmoo.ccwu.cc","rexornge.net","rexornge.site","reymaticx.com","rezai.com","rezalabs.shop","rezato.com","rf.gd","rfc822.org","rfods.tech","rfzpnrbpv.top","rgbeastcomputers.site","rgwdomb.theworkpc.com","rhalmshouse.church","rhalmshouse.co.uk","rhyta.com","riazra.bond","ricardo0911.xyz","richfinances.pw","richmondhill.com","rickymail.com","riddermark.de","riffproductions.co.uk","rifkian.ga","rifqysaputra.dev","rikka0612.site","rilzz.store","rimshacooking.site","rin.ru","rinseart.com","riopreto.com.br","riposh.shop","rippb.com","risinggirl.co.uk","risingsuntouch.com","riski.cf","risu.be","rito.grok-mail.co","riwutz-gmail.com","rjzh8vf.giize.com","rklips.com","rkomo.com","rkzpcx.top","rm2rf.com","rma.ec","rmmr.fun","rmqkr.net","rn.com","rnailinator.com","rniz667.mywire.org","rnmut8pudgj0ikregqx6.dynv6.net","rnvvpn.store","ro.lt","ro.ru","roadrunner.com","roanokemail.com","robertspcrepair.com","roborena.com","robot-mail.com","robothandcook.cfd","robustq.com","rock.com","rocketiron.com","rocketmail.com","rocketship.com","rockfan.com","rodhazlitt.com","rodrun.com","rogers.com","roguemaster.dev","roiv.hair","rollindo.agency","rome.com","ronete.com","ronger.cfd","ronghsng.buzz","ronnierage.net","roosh.com","rootfest.net","rootprompt.org","roratu.com","roroki.cn","rosebearmylove.ru","rosella.my.id","rotaniliam.com","rotomails.co.uk","rotomails.com","rouflav.com","roughnet.com","route64.de","routerboardvietnam.com","rover.info","rowdydow.com","rowe-solutions.com","roweryo.com","royal.net","royaldoodles.org","royalmarket.life","royalpriesthoodagc.org.uk","royandk.com","roybl.com","rppkn.com","rr.com","rr.nu","rrohio.com","rs.sdfe.app","rshz.hair","rsub.com","rsvhr.com","rt.jesys.net","rteet.com","rtrobinsbequest.org.uk","rtrtr.com","rtskiya.xyz","rua.pp.ua","rubyridge.com","rudymail.ml","ruinique.tech","rukiaops.me","rulersonline.com","rulp.skin","rumahweb.site","rumgel.com","runbox.com","runcubesapps.id","runi.ca","runlop6.ooguy.com","rupayamail.com","ruru.be","rushpost.com","rustydoor.com","rustyload.com","ruttolibero.com","ruu.kr","ruutukf.com","rvb.ro","rvhx.hair","rvneous.com","rvshop.com","rw1aifc.camdvr.org","rweebz-mail-1.online","rwstatus.com","rwxsxnomo.top","rxinai.com","rxs9.cn","rygel.infos.st","rymtool.eu.cc","rynetvpn.site","ryteto.me","ryuu.codes","ryuucn.com","ryyr.ru","ryyr.store","ryzid.com","rzbal.xyz","s-mail.com","s-mail.social","s-mdg.top","s0ny.net","s1q59z82q.top","s33db0x.com","s3cmt5w.kozow.com","s3k.net","s40vwj8.camdvr.org","s4sfoundation.org.uk","s8gz4ay.kozow.com","sabreshockey.com","sabrestlouis.com","sacbeemail.com","sackboii.com","sad23321adja.cn","sada-sd.cc","saddope.lol","sadfg.indevs.in","sadrain.shop","sads-ads-awe.top","saeoil.com","saeuferleber.de","safaat.cf","safe-mail.net","safermail.info","safersignup.de","safetymail.info","safetypost.de","safrica.com","sagametour.com","sagra.lu","sags-per-mail.de","saharanightstempe.com","sahildash.dev","sailmail.io","sailormoon.com","saintly.com","saintmail.net","saisonhama.shop","sajutadollars.com","sakoonthroughcancer.com","sakurapink.top","salakoais.shop","sale-sale-sale.com","salehi.net","saleis.live","salesperson.net","salmeow.tk","sam1.eu.org","samaltour.site","samaritanfamilyfoundation.com","samblogs.nett.to","samblogs.zone.id","samerica.com","samilan.net","sammimail.com","sampsave.tech","samsclass.info","samsung-gmail.com","sandcars.net","sandelf.de","sandwhichvideo.com","sanfinder.com","sanfnge.run","sanfnges.cc","sanfranmail.com","sanim.net","sanook.com","sanstr.com","saovangtiles.site","sapo.pt","sappisi.com","sarawakreport.com","sast.ro","sasukiez.shop","satisfyme.club","satorix.id","satukosong.com","saturrshop.uk","saudia.com","saungadaid.pro"]');
INSERT INTO affiliation_free_email_domains (domain) SELECT value FROM json_each('["sausen.com","save4now.com","savelife.ml","savemydinar.com","savests.com","say0.com","sayhi.net","saynotospams.com","sayverfox.com","sbcglbal.net","sbcglobal.com","sbcglobal.net","scandalmail.com","scarlet.nl","scatmail.com","scatterteam.com","scay.net","schachrol.com","schafmail.de","schizo.com","schmeissweg.tk","schmusemail.de","schoolemail.com","schoolmail.com","schoolsucks.com","schreib-doch-mal-wieder.de","schrott-email.de","schweiz.org","sci.fi","scientist.com","scifianime.com","scook.cfd","scotland.com","scotlandmail.com","scottcoffman.net","scottishmail.co.uk","scottni.com","scottsboro.org","scpulse.com","scribito.de","scrsot.com","scubadiving.com","sd3.in","sdbbs.cc","sdhaiok.eu.cc","sdi5mon.ooguy.com","sdj.fr.nf","sds-awe.top","sdsfre.blog","sdvft.com","sdvgeft.com","sdvrecft.com","seanet.com","search.ua","search4gpt.com","searchwales.com","seasonofgrace.org","seaworld.asia","sebbcn.net","sebil.com","seckinmail.com","secmail.pw","secret-police.com","secretary.net","secretemail.de","secretservices.net","securamail.org","secure-mail.biz","secure-mail.cc","secured-link.net","securehost.com.es","securemail.edu.pl","securitybot.online","sedekah-mudah.com","seduck.com","seductive.com","seedancespace.shop","seedaz.com","seedcorn.foundation","seedspeed.site","seekapps.com","seekjobs4u.com","seekstoyboy.com","segichen.com","seguros.com.br","sehier.fr","sejaa.lv","sekotong.store","selaciptama.com","seler25k.io.vn","selerb.top","selfdestructingmail.com","selfdestructingmail.org","selftrak.fit","selltub.com","selltub.me","seman.edu.kg","semester.bond","send.hu","send22u.info","send4.uk","sendapp.uk","sendfree.org","sendgrid.ovh","sendingspecialflyers.com","sendme.cz","sendnow.win","sendo.dedyn.io","sendo.giize.com","sendokai.click","sendos.fr.nf","sendos.infos.st","sendspamhere.com","sengkuni.dedyn.io","sengkuni.qzz.io","sengkuni.xx.kg","senseless-entertainment.com","sensewave.com","sent.as","sent.at","sent.com","sentra-premium.com","sentrismail.com","senvas.me","senyan.fun","seosnaps.com","sepole.com","seqerc.com","serbaprem.store","serbaserbisoftware.site","serenith.cfd","serga.com.ar","servemymail.com","server.ms","servermaps.net","servicee.es","services391.com","servicetr.me","sesasdl.top","sesmail.com","setxko.com","sevakbhajanlal.com","severnday.us","sevopay.com","sewink.my.id","sex520.eu.org","sexforswingers.com","sexfrancecute.lol","sexfrancecute.tattoo","sexfrancecute.xyz","sexical.com","sexmagnet.com","sexyalwasmi.top","sexymeowers.site","sexymeowers.space","sexymeowers.store","sexymeowers.xyz","seznam.cz","sfacg.org","sfanrj.cfd","sfolkar.com","sfr.fr","sfr09g1.camdvr.org","sgatra.com","sgm.ovh","shaceng.biz.id","shaceng.my.id","shadap.org","shaguaaini.click","shahabnoor.org","shahweb.net","shalar.net","shanhaijuli.sbs","shaniastuff.com","sharebot.net","shared-files.de","sharedmailbox.org","sharkfaces.com","sharklasers.com","sharmaweb.com","shaw.ca","shchiba.uk","she.com","sheerid.top","sheinup.com","shengxia.asia","sherazhaider.com","sheryli.com","shhmail.com","shhuut.org","shieldedmail.com","shieldedpost.net","shieldemail.com","shiftmail.com","shiita12.com","shinedyoureyes.com","shipfromto.com","shiphazmat.org","shipping-regulations.com","shippingterms.org","shiptudo.com","shiro-alice.live","shitaway.cf","shitaway.cu.cc","shitaway.ga","shitaway.gq","shitaway.ml","shitaway.tk","shitaway.usa.cc","shitmail.de","shitmail.me","shitmail.org","shitware.nl","shizuku-lulu.love","shkele.cyou","shmavje.mywire.org","shmeriously.com","shockinmytown.cu.cc","shootmail.com","shopaccmmo.com","shopbantkclone.com","shopcreative.cc","shopdevo.com","shopempva11.com","shopld.linkpc.net","shopprimeaccounts.com","shopvipduzk666.shop","shopvipduzk6868.shop","shopxda.com","shopy.club","shortmail.com","shortmail.net","shortweb.live","shotgun.hu","shotmail.ru","showslow.de","shrib.com","shuelder.com","shuf.com","shut.name","shut.ws","shxwonew.xyz","si1ver.xyz","sialkotcity.com","sialkotian.com","sialkotoye.com","siap-sepuh.com","sibafo.asia","siberpay.com","siby9w6.loseyourip.com","sicmg.com","sidelka-mytischi.ru","sidement.com","sidlabs.site","sidneymichaelpoland.travel","siempre.gratis","sifan077.cc.cd","siftportal.ru","sify.com","sig.de5.net","signalxp.com","signinid.com","signsoflife.org.uk","sihanoma.store","sika3.com","sikux.com","silenceofthespam.com","silentmail.ccwu.cc","siliwangi.ga","silkroad.net","silvaron.cfd","silvercoin.life","sim-simka.ru","sim-sppg.com","simaenaga.com","simoka.sbs","simpleitsecurity.info","simranaitech.space","sin.cl","sina.cn","sina.com","sinaite.net","sinamail.com","sind-hier.com","sind-wir.com","sindhier.com","sindwir.com","sinema.ml","sinfiltro.cl","singapore.com","singapore.edu.pl","singles4jesus.com","singlespride.com","singmail.com","singnet.com.sg","sinnlos-mail.de","sino.tw","sinorto.com","siperer.online","siroja.top","siteinfox.com","siteposter.net","sitwelltownlands.org.uk","six25.biz","sixoplus.com","sizzlemctwizzle.com","sjuaq.com","sjusngde.info","sk-ai.eu.cc","skafan.com","skeefmail.com","skim.com","skingkong.com","skizo.hu","skrak.com","skrhqfnya.top","skrx.tk","sky-inbox.com","sky-ts.de","sky.com","sky.tkc.ne.jp","sky.tkk.ne.jp","sky.tu-ka.ne.jp","skyemails.app","skyemails.tech","skyforte25k.io.vn","skygazer42.cn","skygazerhub.com","skyhope666.icu","skyhope666.shop","skyhope666.xyz","skyhopenb.shop","skyhopenb.xyz","skyhopenba.shop","skyhopetw.xyz","skyhopewd.xyz","skyhopewdf.xyz","skynet.be","skynet.infos.st","skyrt.de","skyserver.cyou","skytopway.com","slamdunkfan.com","slapsfromlastnight.com","slaskpost.se","slave-auctions.net","slimirin.com","slingshot.com","slippery.email","slipry.net","sliverkeigo.fun","slo.net","slopsbox.com","slotbeer.com","slothmail.net","slotter.com","slowpokerfrance.eu","slowpokerfrance.fr","slowpokerfrance.org","slowpokerfrance.store","slushmail.com","slushpools.cloud","sluteen.com","sly.io","slyouthuk.org","smailpro.com","smailwork.com","smakit.vn","smallker.tk","smap.4nmv.ru","smapfree24.com","smapfree24.de","smapfree24.eu","smapfree24.info","smapfree24.org","smapxsmap.net","smarfren.tech","smartdigitalpromo.com","smartemailbox.co","smartnator.com","smarttalent.pw","smarttickethub.com","smashmail.de","smell.sbs","smellfear.com","smellrear.com","smellypotato.tk","smeux.com","smileyface.comsmithemail.net","smkanba.com","smncloud.com","smoothmail.com","smpcharity.co.uk","smpnegeri4-pwt.my.id","sms.at","smtp.id.vn","smtp.io.vn","smtp99.com","smvmail.com","smwg.info","smykwb.com","sn6fk3.nsmjj.tech","snail-mail.net","snakebite.com","snakebutt.com","snakemail.com","snapbx.com","snapmail.cc","snapmail.site","snapmail.xyz","snapwet.com","sndt.net","sneakemail.com","sneakmail.de","snece.com","snet.net","sneydgreen-communityhall.co.uk","sniper.hu","snkmail.com","snoopymail.com","snowboarding.com","snowdonia.net","snowlash.com","snpmail.fun","so-net.ne.jp","soc123.net","socamail.com","socceramerica.net","soccermail.com","soccermomz.com","social-mailer.tk","socialfurry.org","socialist.sbs","sociallymediocre.com","socialminty.autos","socialpulse.casa","socialtrash.online","socialworker.net","sociologist.com","soco7.com","socoori.com","sofia.re","sofimail.com","sofort-mail.de","sofortmail.de","sofrge.com","softbank.id","softbank.ne.jp","softdailyguide.com","softhome.net","softkey-office.ru","softlitceg.com","softpls.asia","sogetthis.com","sogou.com","sohai.ml","sohu.com","sohus.cn","soioa.com","soisz.com","sol.dk","solar-impact.pro","solarnyx.com","solarunited.net","solarunited.org","solcon.nl","soldier.hu","solenox.cfd","solerbe.net","solimoddin.online","solkill.store","solquira.cfd","solution4u.com","solvemail.info","solventtrap.wiki","somadethcdk.site","somelora.com","somestoneair.shop","somoj.com","son2d.site","songsan.business","songsign.com","songwriter.net","soniot.fr","soniot.info","soniot.online","soniot.store","sonjj.edu.pl","sonl192.theworkpc.com","sonnenkinder.org","sonny.tk","sonphuongthinh.com","sonrusu.com","sonshi.cf","soodmail.com","soodomail.com","soodonims.com","soombo.com","soon.com","soon.it","soppat.com","soscandia.org","soson.shop","soul-association.com","soulfoodcookbook.com","souss.dev","southai.bond","southeastessexanimal.uk","soyboy.observer","sozenit.com","sp.nl","spaaqs.ne.jp","space-bank.com","space-man.com","space-ship.com","space-travel.com","space.com","spacebazzar.ru","spacehotline.com","spacemart.com","spacetowns.com","spacewar.com","spacework.top","spacexyz.space","spacezin.space","spahe.space","spahe.xyz","spainmail.com","spam-be-gone.com","spam.2012-2016.ru","spam.care","spam.ceo","spam.la","spam.org.es","spam.su","spam4.me","spamail.de","spamarrest.com","spamavert.com","spambob.com","spambob.net","spambob.org","spambog.com","spambog.de","spambog.net","spambog.ru","spambooger.com","spambox.info","spambox.me","spambox.org","spambox.us","spambox.xyz","spamcero.com","spamcon.org","spamcorptastic.com","spamcowboy.com","spamcowboy.net","spamcowboy.org","spamday.com","spamdecoy.net","spameater.com","spameater.org","spamex.com","spamfellas.com","spamfighter.cf","spamfighter.ga","spamfighter.gq","spamfighter.ml","spamfighter.tk","spamfree.eu","spamfree24.com","spamfree24.de","spamfree24.eu","spamfree24.info","spamfree24.net","spamfree24.org","spamgoes.in","spamherelots.com","spamhereplease.com","spamhole.com","spamify.com","spaminator.de","spamkill.info","spaml.com","spaml.de","spamlot.net","spammer.fail","spammotel.com","spammy.host","spamobox.com","spamoff.de","spamok.com","spamsalad.in","spamsandwich.com","spamslicer.com","spamsphere.com","spamspot.com","spamstack.net","spamthis.co.uk","spamthis.network","spamthisplease.com","spamtrail.com","spamtrap.ro","spamtroll.net","spamwc.cf","spamwc.ga","spamwc.gq","spamwc.ml","sparkletoc.com","spartapiet.com","sparxautomationhub.store","spazmail.com","speak2all.com","speakerion.com","speaknow.org.uk","specialneedscircle.co.uk","speedemail.net","speedgaus.net","speedlooking.fun","speedpost.net","speedrules.com","speedrulz.com","speedymail.org","sperke.net","sperma.cf","spicysoda.com","spiedemtion.store","spikio.com","spils.com","spinbit.cyou","spindl-e.com","spinfinder.com","spinly.net","spl.at","splitparents.com","spoko.pl","spoofmail.de","sportcornwall.org","sportemail.com","sportrid.com","sportsfunlifestyle.org","sportsmail.com","sporttruckdriver.com","spotiy.site","spotlightdiary.com","spr.io","spray.no","spray.se","spritzzone.de","spruzme.com","spybox.de","spymac.com","spymail.com","spymail.one","sqp.cc.cd","squizzy.de","squizzy.net","sraka.xyz","srame.com","srilankan.net","sroff.com","sry.li","srzi.makeup","ss0qw9a.ddnsfree.com","ssanphone.me","ssi-bsn.infos.st","sskaid.com","ssl-mail.com","ssoia.com","sssig.one","sssvcv.uno","st-davids.net","stacys.mom","stade.fr","stalag13.com","stanfordujjain.com","star-fish.org.uk","starbalance.site","starcheck.in","stardust-2.store","stargateradio.com","starlight-breaker.net","starlight.store","starmail.com","starmail.net","starmail.org","starmedia.com","starnlink.com","starplace.com","starpower.space","starspath.com","start.com.au","start.no","startfu.com","startkeys.com","statdvr.com","stathost.net","statiix.com","stayhome.li","stc-88.com","steadyhabithub.com","steam-area.ru","steam-coin.com","steambot.net","steel4work.io.vn","stepsofhope.co.uk","sterlingpointco.com","stexsy.com","stinkefinger.net","stipte.nl","stmail.cc.cd","stomatogomail.ru","stoned.com","stoneground.shop","stones.com","stonesinwater.com","stop-my-spam.cf","stop-my-spam.com","stop-my-spam.ga","stop-my-spam.ml","stop-my-spam.pp.ua","stop-my-spam.tk","stopdropandroll.com","stopspam.app","storebanme.com","storegmail.net","storiesonthestreet.org","storiqax.top","storj99.com","storj99.top","storksite.com","storybuddies.online","stpaulsgrammaralumniusa.org","stravico.cfd","strayhood.org","streamingku.live","streamtv.biz.id","streamwolf.store","streber24.de","streetwisemail.com","stribmail.com","stromox.com","strompost.com","strongguy.com","stuckmail.com","student.nyc.mn","student.su","studentcenter.org","studio.jo3.org","studio.publicvm.com","studyhub.edu.pl","stuffmail.de","stufmail.com","stumpfwerk.com","stylist-volos.ru","su.cloudns.biz","suarj.com","submic.com","submitreports.com","subram.com","substoretools.com","substoretools.site","substoretools.store","suburbanthug.com","suckmyd.com","sudanmail.net","sudern.de","sudolife.me","sudolife.net","sudomail.biz","sudomail.com","sudomail.net","sudoverse.com","sudoverse.net","sudoweb.net","sudoworld.com","sudoworld.net","sueshaw.com","suexamplesb.com","suft.autos","suftwari.com","sugarloafstudios.net","suhabi.com","suhasmedam.com","suiemail.com","suini.dpdns.org","suioe.com","suisse.org","sukhumvit.net","sumberakun.com","sunmoonlight.shop","sunpoint.net","sunrain.tech","sunrise-sunset.com","sunsgame.com","sunstarmoon.shop","suntuy.com","sunumail.sn","suomi24.fi","super-auswahl.de","super.lgbt","superblohey.com","superbowlstarttime.org","superdada.com","supereva.it","supergreatmail.com","supergrok.id","supergrok.site","supermail.ru","supermailer.jp","superplatyna.com","superrito.com","supersave.net","superstachel.de","superti4r.dev","superyp.com","supplementsdiary.com","supplementwiki.org","supportorganization.online","supporttc.com","surat.com","surbitonnewlifebaptist.com","suremail.info","surf3.net","surfree.com","surfy.net","surgical.net","surimail.com","survivormail.com","suryain.app","sushisalmon.online","susi.ml","sute.jp","svetims.com","svip520.cn","svip888888888.com","svipcun.eu.org","svk.jp","svlg.hair","svvf.hair","svxr.org","swagpapa.com","swap.name.ng","swbell.net","sweb.cz","swedenmail.com","sweepser.com","sweetberry.online","sweetpotato.ml","sweetville.net","sweetxxx.de","swi4jut.ddnsfree.com","swift-mail.com","swift-mail.net","swift10minutemail.com","swiftcroft.org","swiftdesk.com","swingeasyhithard.com","swingfan.com","swipermail.zzn.com","swirve.com","swissinfo.org","swissmail.com","swissmail.net","swissokalmo.org.uk","switchboardmail.com","switzerland.org","swsdz.com","sx172.com","sx227.top","sx235.top","sx697.top","sx856.top","sx872.top","sx882.top","sx992.top","sxda.cc.cd","sydney.edu.pl","syecna9.ooguy.com","syinxun.com","sylentha.cfd","sylnetdns.site","sylnetgcp.site","sylnetgcp.top","sylnetx1.top","sylvannet.com","sympatico.ca","symphonyresume.com","synarca.com","syncax.com","synovaris.cfd","synsky.com","syntheradynamics.site","syom.com","syosetu.gq","syriamail.com","sysout.cloud","sytchampton.directory","sytchamptoncc.co.uk","syujob.accountants","sz345p7.loseyourip.com","szerz.com","szxcfagah.online","t-com.ne.jp","t-online.de","t-online.hu","t.psh.me","t15ippy.giize.com","t1mo.net","t2d9n0j.ooguy.com","t2mail.com","t2t.email","t6s7.top","t7sqtao.giize.com","t8xieb2.kozow.com","tacomail.de","tafmail.com","tafnsxo.ooguy.com","tafoi.gr","tagara.infos.st","taglead.com","tagmymedia.com","tagyourself.com","taikhoankiro.pro","taimb.com","taischaves.com","tako.skin","takuyakimura.com","talemarketing.com","talk21.com","talkcity.com","talkinator.com","talkmatrix.study","talktalk.net","talkup.sbs","talmetry.com","tamil.com","tampabay.rr.com","tamthomca.click","tamttts.com","tandlplith.se","tankpolice.com","tanks7.com","tanlanav.com","tanpony.com","tanukis.org","tanvo.online","taobudao.com","taohucom.store","taojingrun.online","taomail.web.id","tapchicuoihoi.com","taphear.com","tapi.re","tarasbest.xyz","tartinemoi.com","tarzanmail.cf","taseek.cc.cd","taseek.top","tastmemail.com","tastrg.com","tatadidi.com","tatanova.com","tatsu.uk","taugr.com","taukah.com","taxibmt.com","taxibmt.net","taymonera.de","tb-on-line.net","tbgroupconsultants.com","tbr.fr.nf","tbterqwzv.top","tbwt.com","tcc.on.ca","tcwlm.com","tcwlx.com","tds.net","tdtda.com","teacher.semar.edu.pl","teachermail.net","teachers.org","teambunnyfoundation.org.uk","teamdiscovery.com","teamnewmexico.org","teamtitan.co","teamtulsa.net","tech-center.com","tech2grow.io.vn","tech4peace.org","tech69.com","techblast.ch","techcyber.shop","techemail.com","techgroup.me","techie.com","techlhj.email","technisamail.co.za","technologist.com","technoproxy.ru","techscout.com","techspot.com","techusa.org","teenagedirtbag.com","teerest.com","teewars.org","tefl.ro","tehillahpraise.uk","teihu.com","tele2.nl","tele2.no","telebot.com","telecomix.pl","telefonica.net","teleg.eu","telegmail.com","teleline.es","telenet.be","telepac.pt","telerymd.com","teleworm.com","teleworm.us","telfort.nl","telfortglasvezel.nl","teliedge.com","teligmail.site","telimail.online","telinco.net","telkom.net","tellos.xyz","telos.lat","telpage.net","telstra.com","telstra.com.au","telvetto.com","temailz.com","tembusselalu.biz.id","tembusselalu.my.id","teml.net","temp-email.de5.net","temp-link.net","temp-mail-free.dedyn.io","temp-mail-free.dynv6.net","temp-mail.best","temp-mail.cfd","temp-mail.com","temp-mail.de","temp-mail.edu.rs","temp-mail.freeddns.org","temp-mail.gg","temp-mail.lol","temp-mail.now","temp-mail.org","temp-mail.pp.ua","temp-mail.ru","temp-mail.snaper24.com","temp-mailer.dynv6.net","temp-mails.com","temp.headstrong.de","temp.skymeshdynamics.com","temp.sowhy.de5.net","temp1month.icu","temp2.qzz.io","tempail.com","tempalias.com","tempblockchain.com","tempe-mail.com","tempebossok.my.id","tempemail.biz","tempemail.co.za","tempemail.com","tempemail.de","tempemail.net","tempemail.nyc.mn","tempemailgen.com","tempemaill.com","tempemailo.org","tempestme.com","tempforward.com","tempinbox.co.uk","tempinbox.com","tempmail.at","tempmail.best","tempmail.cc","tempmail.cn","tempmail.co","tempmail.com","tempmail.de","tempmail.edu.pl","tempmail.email","tempmail.eu","tempmail.giize.com","tempmail.id.vn","tempmail.ing","tempmail.io.vn","tempmail.it","tempmail.net","tempmail.ninja","tempmail.plus","tempmail.pp.ua","tempmail.us","tempmail.vip","tempmail.world","tempmail.ws","tempmail101.com","tempmail2.com","tempmail5.com","tempmaildemo.com","tempmailer.com","tempmailer.de","tempmailer.net","tempmailfree.net","tempmailo.com","tempmailr.com","tempmails.net","tempmailto.com","tempmailyo.org","tempomail.fr","tempomail.org","tempomailo.site","temporalemail.org","temporam.com","temporam.online","temporam.xin","temporam.xyz","temporarily.de","temporarioemail.com.br","temporarly.com","temporarmail.edu.pl","temporary-mail.net","temporaryemail.dpdns.org","temporaryemail.net","temporaryemail.us","temporaryforwarding.com","temporaryinbox.com","temporarymailaddress.com","tempp-mails.com","temppppo.store","tempr.email","tempsky.com","temptami.com","tempthe.net","tempxzy.net","tempymail.com","tempyx.com","temtulsa.net","temzo.tech","tenchiclub.com","tenderkiss.com","tenhub.uk","tenmin.app","tennismail.com","tensi.org","tenull.com","terminverpennt.de","ternaklele.ga","terra.cl","terra.com","terra.com.ar","terra.com.br","terra.es","terre.infos.st","test-infos.fr.nf","test.com","test.de","test1byali.cfd","tester2341.great-site.net","testore.co","testudine.com","tetestebu.online","tevstart.com","texify.online","textdiff.net","tfanus.com.er","tfbnw.asia","tfbnw.id.vn","tfbnw.in","tfbnw.info","tfbnw.io.vn","tfbnw.tech","tfbnw.xyz","tfcn.beer","tffv4a3.kozow.com","tfz.net","tgduck.com","tgmaiss.xyz","tgnm.hair","tgoj.skin","thai.com","thaihp.net","thaimail.com","thaimail.net","thaitudang.xyz","thalarex.cfd","thameschamberorchestra.co.uk","thanhnhontienbao.com","thanksnospam.info","thankyou2010.com","thaotri.com","thatim.info","thc.st","thdfyrg.top","the-african.com","the-airforce.com","the-aliens.com","the-american.com","the-animal.com","the-army.com","the-astronaut.com","the-beauty.com","the-big-apple.com","the-biker.com","the-boss.com","the-brazilian.com","the-canadian.com","the-canuck.com","the-captain.com","the-chinese.com","the-country.com","the-cowboy.com","the-davis-home.com","the-dutchman.com","the-eagles.com","the-englishman.com","the-fastest.net","the-fool.com","the-frenchman.com","the-galaxy.net","the-genius.com","the-gentleman.com","the-german.com","the-gremlin.com","the-hooligan.com","the-italian.com","the-japanese.com","the-lair.com","the-madman.com","the-mailinglist.com","the-marine.com","the-master.com","the-mexican.com","the-ministry.com","the-monkey.com","the-newsletter.net","the-pentagon.com","the-police.com","the-prayer.com","the-professional.com","the-quickest.com","the-russian.com","the-snake.com","the-spaceman.com","the-stock-market.com","the-student.net","the-whitehouse.net","the-wild-west.com","the18th.com","the23app.com","theaviors.com","thebearshark.com","thebest73.shop","theboys.cyou","thecarinformation.com","thechildrensfocus.com","thecity.biz","thecloudindex.com","thecoolguy.com","thecriminals.com","thecwf.co.uk","thediamants.org","thedirhq.info","thedoghousemail.com","thedorm.com","thedorsetcarershub.org","theeditai.com","theend.hu","theeyeoftruth.com","theglobe.com","thegolfcourse.com","thegooner.com","thegrampians.net","theheadoffice.com","thehjhvj.ink","theinternetemail.com","thejenkins.net","thejoker5.com","theking.id","thelanddownunder.com","thelifecentre.org.uk","thelightningmail.net","thelimescommunitygarden.org","thelimestones.com","themail.com","themailer.de","thembones.com.au","themccarneyfoundation.co.uk","themegreview.com","themillionare.net","themostemail.com","theoffice.net","theplate.com","thepokerface.com","thepostmaster.net","theraces.com","theracetrack.com","therapist.net","thereddoors.online","theroyalweb.club","thescrappermovie.com","these.cc","theshahnazfoundation.com","thespamfather.com","thestreetfighter.com","theteastory.info","thetechnext.net","theteebox.com","thewatercooler.com","thewebpros.co.uk","theweifamily.icu","thewizzard.com","thewizzkid.com","thex.ro","thexyz.ca","thexyz.fr","thexyz.in","thexyz.mobi","thexyz.net","thexyz.org","thezhangs.net","thg.cc.cd","thichanthit.com","thichmmo.com","thiefness.com","thietbivanphong.asia","thirdage.com","thirifara.com","thisgirl.com","thisisnotmyrealemail.com","thismail.net","thispy.top","thisurl.website","thly.cc.cd","thnikka.com","thoas.ru","thodianamdu.com","thoitrangnam2024.shop","thomasblackerby.org.uk","thor.my.id","thraml.com","threads.io.vn","thrma.com","throam.com","thrott.com","throwam.com","throwaway.dynv6.net","throwawayemail.app","throwawayemailaddress.com","throwawaymail.app","throwawaymail.com","throwawaymail.pp.ua","throya.com","thrubay.com","thrunet.com","thshyo.org","thueotp.net","thulinh.net","thunderbolt.science","thundermail.com","thunkinator.org","thuongxg.com","thurleighchurchestate.church","thxmate.com","tianblog.top","tianmi.me","tianstudy.space","tiapz.com","tic.ec","tidaksuka.cfd","tidewick.org","tidissajiiu.com","tidni.com","tidylifehub.com","tiendadezapasok.com","tiffincrane.com","tigrisstem.org","tijdelijke.email","tikanony.com","tiki.ne.jp","tikmail.org","tiksofi.uk","tiktakgrab.com","tiktakgrab.shop","tiktakgrabber.com","tiktokngon.com","tiktokus.us","tilien.com","tilumo.cfd","tilvex.click","timbourkescholarshipfund.org","timein.net","timgiarevn.com","timkassouf.com","tinhoconline.com","tinoza.org","tinpho.com","tinytimer.org","tinyurl24.com","tipsb.com","tirasya.pro","tiscali.at","tiscali.be","tiscali.co.uk","tiscali.it","tiscali.lu","tiscali.no","tiscali.se","tistory.com","titangamezz.com","titenpa.com","tittbit.in","tiv.cc","tivendra.cfd","tivertonhospitalleagueoffriends.co.uk","tivo.camdvr.org","tizi.com","tjhn.beer","tkcity.com","tkfb24h.com","tkitc.de","tlen.pl","tlktok.us","tlpn.org","tm.488448.xyz","tm.515666.xyz","tm.622221.xyz","tm.cloud-ip.cc","tm.spkun.org","tmail.com","tmail.edu.rs","tmail.gg","tmail.io","tmail.link","tmail.lt","tmail.mx","tmail.ws","tmail1.org","tmail2.org","tmail3.com","tmail3.org","tmail4.org","tmail5.org","tmail6.com","tmail9.com","tmaile.net","tmailinator.com","tmailor.com","tmailor.net","tmails.net","tmmbt.net","tmpbox.net","tmpemails.com","tmpeml.com","tmpeml.info","tmpjr.me","tmpmail.net","tmpmail.org","tmpmailer.com","tmpmailtor.com","tmpnator.live","tmpx.sa.com","tmxttvmail.com","tnbeta.com","toaik.com","toast.com","tocuda.cloud","toddsbighug.com","tofeat.com","tohru.org","toiea.com","tojson.icu","tokai.or.jp","toke.com","tokem.co","token.ro","token0v0.com","tokenizer.qwen3-30b-a3b.xyz","tokenmail.de","tokfly.org","tokmail.fun","tokmail.net","tokobibit.co","tokyo.edu.pl","tokyo112.top","tokyoflarex.tokyo","tom.com","tomail.cc.cd","tomhouse.shop","tommyfommy.site","tomvnet.uk","tonaeto.com","tongle.ccwu.cc","toni.io.vn","tonne.to","tonyfarm.indevs.in","tonymanso.com","too.li","toolbox.ovh","toolnator.plus","toolourles.tech","tools-capcut.com","toolsequipment.cyou","toolsource.com","toomail.biz","toon.ml","toothfairy.com","top-shop-tovar.ru","top101.de","top1mail.ru","top1post.ru","topchat.com","topdatamaster.com","topgamers.co.uk","topinrock.cf","topletter.com","topmail-files.de","topmail.com.ar","topmail2.com","topmail2.net","topofertasdehoy.com","topranklist.de","topren.cyou","topren.top","toprumours.com","topsurf.com","topupgg.app","topvu.net","torchmail.com","torkakak.site","tormail.org","torontomail.com","torrent411.fr.nf","tortenboxer.de","torvila.sbs","tospage.com","toss.pw","tosunkaya.com","totallynotfake.net","totalmail.de","totalmusic.net","totalvista.com","totesmail.com","totoan.info","totococo.fr.nf","toupiao7003.top","tourcc.com","tousma.com","townisp.com","tozya.com","tp-qa-mail.com","tpg.com.au","tppp.one","tppp.online","tpwlb.com","tqoai.com","tqosi.com","trackden.com","tradermail.info","tradingview.my.id","tradr.space","trainthem2fish.co.uk","tramynguyen.net","tranceversal.com","trandigabapoe.shop","trangiabao.click","trangzim.uk","tranhtai.com","transaksikita.tech","transferpulsa.net","translateid.com","traodoinick.com","traogiai.com","trap-mail.de","trash-amil.com","trash-mail.at","trash-mail.cf","trash-mail.com","trash-mail.de","trash-mail.ga","trash-mail.gq","trash-mail.ml","trash-mail.tk","trash-mail.webredirect.org","trash-me.com","trash2009.com","trash2010.com","trash2011.com","trashcanmail.com","trashdevil.com","trashdevil.de","trashemail.de","trashemails.de","trashinbox.com","trashmail.at","trashmail.com","trashmail.de","trashmail.fr","trashmail.gq","trashmail.hu","trashmail.io","trashmail.me","trashmail.net","trashmail.org","trashmail.se","trashmail.ws","trashmailer.com","trashmailgenerator.de","trashmailr.com","trashmails.com","trashymail.com","trashymail.net","trasz.com","travel.li","travelfriend.online","travelistaworld.com","travelovelinka.club","travionex.cfd","trayna.com","trbvm.com","trbvn.com","trbvo.com","treesforderby.org","trend-maker.ru","treso.me","treterter.shop","trevourus.com","trfu.to","trgfu.com","trgovinanaveliko.info","trialbytrivia.com","trialmail.de","trickmail.net","trieuhao.site","trillianpro.com","trimix.cn","trinovia.cfd","triots.com","tritium.net","trixtrux1.ru","trmailbox.com","trojanvmesswrt.dpdns.org","trolebrotmail.com","trollproject.com","tropicalbass.info","tropicalstorm.com","tropovenamail.com","trovantis.cfd","troveniq.cfd","truckerz.com","truckracer.com","truckracers.com","truelambda.com","trumingovn.online","trunghocphothong.io.vn","trungmetax.com","trungtamtoeic.com","trust-me.com","trustcheck.cc","trustdomainvn.us","trustedadmin2.shop","trustedadmindns.site","trusteddns.online","trustguru.vip","trusticloud.us","trustmailold.us","truthfinderlogin.com","truthmail.com","tryalert.com","tryninja.io","trythe.net","tryzoe.com","tsamail.co.za","tscasalnt.top","tsderp.com","tsdpt.co.uk","tshdn.cfd","tshirtsavvy.com","tsmtp.org","tstrust.org.uk","ttirv.org","ttml.co.in","ttpo89japan.com","ttsk.de5.net","ttszuo.xyz","tualias.com","tuamaeaquelaursa.com","tubebox.us","tubeemail.com","tuethong.shop","tuku26012023.xyz","tulw6ae.ooguy.com","tumroc.net","tunisiamail.com","tunthuta.com","tuofs.com","tupmail.com","turboprinz.de","turboprinzessin.de","turkey.com","turkeyth.com","turnimon.com","turoid.com","turual.com","turuma.com","tut.by","tuta.io","tutanota.com","tutanota.de","tutuapp.bid","tuyenchau.click","tuyenchau.online","tuyenchau.site","tuyenhuy.click","tuyenhuy.online","tuyenhuy.site","tvchd.com","tverya.com","tvstar.com","twc.com","twck.hair","twcny.com","tweaksky.com","tweet.fr.nf","twinmail.de","twinstarsmail.com","twitch.work","twitchythoughtcreations.in","twitter.io.vn","twkly.ml","twocowmail.net","twoweirdtricks.com","twskyhope.top","twskyhope.xyz","twskyhopenb.shop","twzhhq.online","tx.rr.com","tx1ggv4.theworkpc.com","txcct.com","txen.de","txqx.skin","txtadvertise.com","tybz.hair","tycoonmail.com","tyhe.ro","tyldd.com","tympe.net","tyoless.org.uk","typemail.com","tzail.com","tzrj.pro","u14269.ml","u2club.com","u2v7nnn.mywire.org","ua.fm","uacro.com","uae.ac","uaemail.com","ubbi.com","ubbi.com.br","uber-mail.com","uberip.com","ubinert.com","ubismail.net","ubm.md","uboot.com","ucche.us","ucom.ne.jp","ucupdong.ml","uddinfoundation.org","udingclin.com","uemail99.com","ufacturing.com","ufokeuabmail.com","ug.wtf","uggsrock.com","uguuchantele.com","uhe2.com","uhhu.ru","uiemail.com","uiu.us","ujijima1129.gq","uk.to","uk2.net","uk2k.com","uk2net.com","uk7.net","uk8.net","ukbuilder.com","ukcool.com","ukdreamcast.com","ukev.org","uki.io.vn","ukm.ovh","ukmail.org","ukmax.com","ukr.net","ukrpost.net","ukshop538yt.uk","uku.co.uk","ukwv.skin","ulm-dsl.de","ultapulta.com","ulteriq.cfd","ultra.fyi","ultrada.ru","ultrafive.online","ultralabs24.store","ultralux.io.vn","ultrapostman.com","ultrasix.online","ultravex.cfd","ultraz1.io.vn","ultrmigos.online","uma3.be","umail.net","umil.net","umiudi.cn","ummah.org","umombiss.tk","umpire.com","unbounded.com","undeadbank.com","underseagolf.com","undo.it","unfairship.com","unforgettable.com","uni.de","unican.es","unicodeworld.com","unids.com","unihome.com","unimain.tech","unimark.org","uniromax.com","unit7lahaina.com","unitedcharitiesosm.org.uk","unitel.co.kr","unitybox.de","universal.pt","universall.me","unlikeyth.com","unmail.ru","uno.ee","uno.it","unofree.it","unratito.com","unterderbruecke.de","uofzcpg9ftykob.asia","uol.com.ar","uol.com.br","uol.com.co","uol.com.mx","uol.com.ve","uole.com","uole.com.ve","uolmail.com","uomail.com","uooos.com","uorak.com","upc.infos.st","upc.nl","upcmail.nl","upf.org","upliftnow.com","uplipht.com","uploadnolimit.com","upozowac.info","upphim.net","upsnab.net","uqfb.hair","uqmobile.jp","uqqlrdi.top","uqu.me","urbanvalore.info","ureach.com","urfunktion.se","urgentmail.biz","urgentmail.ovh","urhen.com","uroid.com","urvs.skin","urzy.skin","us-x.top","us.af","us.to","usa.cc","usa.com","usa.edu.pl","usa.net","usa.priyo.edu.pl","usaaccess.net","usagica.com","usaishop.shop","usako.net","usanetmail.com","usbc.be","usdtbeta.com","used-product.fr","usedus.me","usefulbriefing.com","uselesswebsites.net","usermail.com","username.e4ward.com","ushijima1129.cf","ushijima1129.ga","ushijima1129.gq","ushijima1129.ml","ushijima1129.tk","usm.ovh","usma.net","usmc.net","uspsp.top","usrl71x.camdvr.org","ustorp.com","usus.accesscam.org","usus.camdvr.org","usus.casacam.net","usus.ddnsfree.com","ususus.dynv6.net","uswestmail.net","utiket.us","utkarsh.tech","uu.gl","uu2.ovh","uue.edu.pl","uuf.me","uuii.in","uvaul.us.ci","uvicone.in","uwork4.us","uxmil.com","uyhip.com","uymail.com","uyqs.skin","uyuyuy.com","uz8.net","v-mail.xyz","v-sexi.com","v1jhjrc.giize.com","v2v.click","v2v.email","v2v.world","v6.army","v6.navy","v6.rocks","v6omlz6.giize.com","vaasfc4.tk","vaati.org","vae.indevs.in","vafyxh.com","vahoo.com","valanides.com","valemail.net","valhalladev.com","valueineveryone.co.uk","vampirehunter.com","vankin.de","vapu.xyz","varbizmail.com","vasteron.com","vatos.gg","vaupk.org","vbgvd.com","vbv.cards","vcmail.com","vcois.com","vctel.com","vda.ro","vddaz.com","vdig.com","vdzc.skin","ve0ai.com","veanlo.com","veb37.com","vectorbrasil.app","vectorzeta.com","velatrix.cfd","veletis.bond","velloxist.site","velmoor.org","velnet.co.uk","velocall.com","velocitronix.online","veltexline.com","vemomail.win","venariq.cfd","vendprop.com","venompen.com","ventrovia.cfd","veo.kr","veo325k.io.vn","veo325kcredit.io.vn","veo33.io.vn","veo3ultra.sbs","veomatrix25k.io.vn","veoverse25k.io.vn","ver0.cf","ver0.ga","ver0.gq","ver0.ml","ver0.tk","vercelli.cf","vercelli.ga","vercelli.gq","vercelli.ml","vercelspace.shop","verdejo.com","verel.online","verifycenter.net","verityemail.site","verizon.net","verizonmail.com","verlass-mich-nicht.de","vermutlich.net","vernonbourne.uk","veronicamira.info","versatel.nl","vertexinbox.com","vertexium.net","veruvercomail.com","verybigdick.cyou","veryday.ch","veryday.eu","veryday.info","veryfast.biz","veryrealemail.com","veryspeedy.net","ves.ink","vesa.pw","vesdev01.shop","vetra.cyou","vevs.de","vexalor.cfd","vexaluno.xyz","vexi.my","vextora.click","vfdhks.eu.cc","vfemail.net","vfre4w3.dynv6.net","vfwladiesauxin.org","vgfautd.mywire.org","vggh.beer","vgyi.hair","vi1ilpa.mywire.org","via.tokyo.jp","viavuive.net","vibertees.com","vibzi.net","vickaentb.tk","victime.ninja","victoriaalison.com","victoriantwins.com","vidchart.com","videoigdownload.com","videotoptop.com","videotron.ca","viditag.com","vidwobox.com","vidxlr.me","viemarter.online","viettravel.io.vn","vietxf.com","viewbuster.ru","viewcastmedia.com","viewcastmedia.net","viewcastmedia.org","viewmuse.com","vigilantkeep.net","vigoneo.com","vikingsonly.com","villatogel.com","villaxoa.site","vinaemail.com","vinakoop.com","vinakop.com","vinatissue.org","vinbazar.com","vinernet.com","vinhdo.shop","vintomaper.com","viole.cfd","violet0923.online","violinmakers.co.uk","vip.126.com","vip.21cn.com","vip.chaldea.eu.cc","vip.citiz.net","vip.gr","vip.mssk.cc.cd","vip.mssk.eu.cc","vip.onet.pl","vip.qq.com","vip.sina.com","vipepe.com","vipmail.hu","vipmail.name","vipmail.pw","vipmail.ru","vipmba.cc","vips.pics","vipxm.net","viralplays.com","virelio.cfd","virgilian.com","virgilio.it","virgin.net","virginbroadband.com.au","virginmedia.com","virginsrus.xyz","virtual-hipster.com","virtualemail.info","virtualmail.com","virtualminerals.com","virtue1.qzz.io","visal007.tk","visal168.cf","visal168.ga","visal168.gq","visal168.ml","visal168.tk","visignal.com","visitmail.com","visitweb.com","visto.com","visualcities.com","visualdep.run.place","visualnest.work","visuals.linkpc.net","vitahicks.com","vitaspherelife.com","vitrineproducoes.com","viv2.com","vivavelocity.com","vivianhsu.net","vividtipzone.com","vixletdev.com","vixtricks.com","vjbl.skin","vjoid.ru","vjoid.store","vjtimail.com","vjuum.com","vkbb.ru","vkbb.store","vkbt.ru","vkbt.store","vkcbt.ru","vkcbt.store","vkcode.ru","vkfu.ru","vkfu.store","vkjashdf.eu.cc","vkpr.store","vkr1.com","vkrr.ru","vkrr.store","vladhub.buzz","vlemi.com","vlrregulatory.com","vmailing.info","vmani.com","vmbx.skin","vmm.indevs.in","vmpanda.com","vn-one.com","vncctv.org","vnedu.me","vnet.citiz.net","vnfjsh.eu.cc","vnn.vn","vnqi.skin","vntechhub.online","vnvmail.com","vnxdxpf.loseyourip.com","vobau.net","vodafone.ne.jp","vodafone.nl","vodafonethuis.nl","voerpemww.click","voicesforchangeinc.org","voidbay.com","voidmail.one","voidpop.win","voila.fr","volaj.com","volcanomail.com","volku.org","vollbio.de","volloeko.de","voltaer.com","voltr.click","voltravia.cfd","vomoto.com","vorga.org","vorsicht-bissig.de","vorsicht-scharf.de","vortalis.cfd","voryxen.com","vote-democrats.com","vote-hillary.com","vote-republicans.com","vote4gop.org","votenet.com","vothanhtuan.shop","votiputox.org","votooe.com","voxelcore.com","voxinh.net","vp.pl","vpbz.skin","vpii.beer","vpkv.skin","vpn.st","vpn64.de","vpnseat.com","vps30.com","vps79.com","vps911.net","vqdz.hair","vqdz.skin","vr9.com","vradportal.com","vremonte24-store.ru","vrjxk.com","vrmtr.com","vsdsd23gsdf.shop","vsimcard.com","vsmailpro.com","vssms.com","vtmpj.com","vtmpj.net","vtxmail.us","vuatrochoi.nl","vubby.com","vuiy.pw","vuket.org","vulca.sbs","vulcanpioneerjers.org","vupn.me","vusra.com","vutrugay.org","vuv.indevs.in","vvatxiy.com","vwagamlk.top","vwhins.com","vxsolar.com","vystella.cfd","vztc.com","w-asertun.ru","w.dickdns.org","w154ed2.giize.com","w3.to","w3internet.co.uk","wacold.com","waguriagent.codes","wahoye.com","waisfoundation.com","waitbeqa.com","waivey.com","wakingupesther.com","walala.org","wales2000.net","walkmail.net","walkmail.ru","walla.co.il","wallm.com","wam.co.za","wanadoo.es","wanadoo.fr","wanai.biz.id","wanaofamouscar.com","wandouyu.run","wanko.be","wansnode-dice.site","wanting2work.org.uk","wanva.shop","war-im-urlaub.de","wargravepreschool.uk","warlus.asso.st","warmmail.com","waroengku.cc","waroengmail.com","waroengpremium.com","warpmail.net","warrior.hu","warrity25k.io.vn","warunkto.com","watch-harry-potter.com","watchever.biz","watchfull.net","watchironman3onlinefreefullmovie.com","waterisgone.com","waterpalace.pro","watersoftenersystemcost.com","watrf.com","watsawang.com","waumail.com","waventra.cfd","waw.indevs.in","wazabi.club","wbdet.com","wbdev.tech","wbml.net","wbslxy.cc.cd","wcm.ne.jp","wdhu.skin","wdrd.beer","wearab.net","wearkeymail.site","wearvault.biz.id","weatherbx.xyz","weaxymt.loseyourip.com","web-contact.info","web-emailbox.eu","web-ideal.fr","web-inc.net","web-library.net","web-mail.com.ar","web-mail.pp.ua","web-police.com","web.de","web2mailco.com","webave.com","webcammail.com","webcamness.com","webcenterfairbanks.dedyn.io","webcity.ca","webclub.infos.st","webcontact-france.eu","webdream.com","webemail.me","webhook.site","webinarmoa.com","webindia123.com","webjump.com","webm4il.info","webmail.co.yu","webmail.co.za","webmail.hu","webmail24.top","webmails.com","webmailus.com","webname.com","webofip.com","webprogramming.com","webscash.com","webstation.com","webstore.fr.nf","websurfer.co.za","webtopmail.com","webtrip.ch","webui.cc.cd","webuser.in","webxio.pro","webxios.pro","wecanmakehit.win","wecp.ru","wecp.store","wedwe.eu.cc","wee.my","weedmail.com","weehost.top","weekfly.com","weekmail.com","weekonline.com","weekzs.icu","weeline.fun","wef.gr","wefjo.grn.cc","weg-werf-email.de","wegas.ru","wegoo.dpdns.org","wegwerf-email-addressen.de","wegwerf-email-adressen.de","wegwerf-email.at","wegwerf-email.de","wegwerf-email.net","wegwerf-emails.de","wegwerfadresse.de","wegwerfemail.com","wegwerfemail.de","wegwerfemail.info","wegwerfemail.net","wegwerfemail.org","wegwerfemailadresse.com","wegwerfmail.de","wegwerfmail.info","wegwerfmail.net","wegwerfmail.org","wegwerpmailadres.nl","wegwrfmail.de","wegwrfmail.net","wegwrfmail.org","wehshee.com","weibsvolk.de","weibsvolk.org","weinenvorglueck.de","weiruipingji.com","weizixu.com","wejedvv.giize.com","wekawa.com","welikecookies.com","wellsfargocomcardholders.com","welsh-lady.com","wemel.top","wenkuu.com","wentcity.com","wenyuanshe.com","wep.email","were-w.top","westnet.com","westnet.com.au","wetrainbayarea.com","wetrainbayarea.org","weyword.cfd","wfgdfhj.tk","wfpe.autos","wg0.com","wh4f.org","whaaaaaaaaaat.com","whale-mail.com","whartontx.com","whatagarbage.com","whatemi.de","whatever.za.net","whatiaas.com","whatifanalytics.com","whatpaas.com","whatsaas.com","wheelweb.com","whf222.top","whiffles.org","whipmail.com","whirlygirlink.org","whispermail.org","whitehousecalculator.com","whitemistral.pro","whob31o.camdvr.org","whoever.com","whoopymail.com","whoopza.org","whoopza.store","whopy.com","whtjddn.33mail.com","whyspam.me","wi.rr.com","wi.twcbc.com","wibblesmith.com","wicfolhumanservices.org","wickmail.net","widaryanto.info","wideopenwest.com","widget.gg","wiemei.com","wierie.tk","wifimaple.com","wifioak.com","wikfee.com","wikidocuslava.ru","wildan.tech","wildmail.com","wilemail.com","will-hier-weg.de","willcom.com","willhackforfood.biz","willselfdestruct.com","wimsg.com","windowslive.com","windrivers.net","windstream.net","windsurfcom.shop","winemaven.info","wingnutz.com","wingsai.online","winmail.com.au","winning.com","winocs.com","wins.com.br","wintersgf.store","wintersmail.site","wir-haben-nachwuchs.de","wir-sind-cool.org","wir-sind.com","wireconnected.com","wireps.com","wirsindcool.de","wishy.fr","witty.com","wivstore.com","wiz.cc","wjah.hair","wjah.skin","wkbwmail.com","wlist.ro","wlsom.com","wmail.cf","wmail.club","wmct.info","wmksuhd.cn","wnbaldwy.com","wo.com.cn","wo1jiao2ren3jian4hu5.qzz.io","wo4dashauige666.qzz.io","woh.rr.com","wohbc.co.uk","wokcy.com","wolf-web.com","wolfmail.ml","wolfsmail.tk","wolke7.net","wollan.info","wombles.com","women-at-work.org","womp-wo.mp","wongfaye.com","woofas.com","woofgl.email","woofidog.fr.nf","wooow.it","woopros.com","work.2026157.xyz","worker.com","workhorsefilms.com","workingtall.com","workmail.com","worldcoins.top","worldcricket.org.uk","worldemail.com","worldlylife.store","worldnet.att.net","worldspace.link","wormseo.cn","wosaddict.com","woshiemoman.cloud-ip.cc","wouldilie.com","wovoemj1119.icu","wovz.cu.cc","wowgirl.com","wowmail.com","wowway.com","wp.pl","wpdork.com","wpg.im","wpnf.skin","wptamail.com","wralawfirm.com","wrexham.net","wrgee.com","writeme.com","writeme.us","writemeback.com","wronghead.com","wrongmail.com","wrqj.top","wrxx.beer","ws.gy","wshu.net","wsvpsft.xyz","wsxnxce.online","wsym.de","wsypc.com","wtjinkintrust.co.uk","wtsl.hair","wtvhmail.com","wudet.men","wudiai.shop","wuespdj.xyz","wupics.com","wusongdahu.cc.cd","wuuvo.com","wuzak.com","wuzup.net","wuzupmail.net","wvdg.skin","wvyt851.ddnsfree.com","wwc8.com","wwdg.com","wwdskboiv.top","wwefd.top","wwej.cc.cd","wwgoc.com","wwjmp.com","wwtykkm.bond","wwvec.uno","wwvk.ru","wwvk.store","www.com","www.e4ward.com","www2000.net","wwwnew.eu","wx88.net","wxcv.fr.nf","wxf07.shop","wxhp.hair","wxnw.net","wxs.net","wxxu.hair","wyattcloud.vip","wyoxafp.com","wywnxa.com","wzjpj.com","wzjyyds.com","wzofit.com","x-clone.asia","x-lab.net","x-mail.net","x-networks.net","x.loves-beer.com","x0bdu6n.mywire.org","x0q.net","x1ix.com","x24.com","x5g.com","x80.dpdns.org","x80la.shop","x8nxh3g.theworkpc.com","x9ad1.my","xagloo.co","xagloo.com","xaker.ru","xandoria.cfd","xapimail.top","xazymarcie.space","xbaby69.top","xbmotor.com","xbrok.com","xcf.pet","xclone.asia","xcode.ro","xcodes.net","xcompress.com","xcoxc.com","xcp3iiv.ooguy.com","xcpy.com","xcsllajs.eu.cc","xcucngon.site","xcvuaylik.top","xcvv.xyz","xczv.hair","xddroot.eu.org","xdfrms.fun","xdnss.cc","xdpxdp.online","xehop.org","xelio.sbs","xelu.space","xemaps.com","xemne.com","xen-bypass.com","xenloria.cfd","xeno.gay","xenta.cfd","xents.com","xeovo.ru","xepa.ru","xeramail.com","xfavaj.com","xfft.beer","xgcpking.space","xgmail.bond","xgng.skin","xhke.hair","xhke.skin","xhotmail.cyou","xi2.cc","xiajspof.eu.cc","xiangshan.eu.cc","xiaoche.ggff.net","xiaoguaishou.icu","xiaohuangyu.ccwu.cc","xiaolajiao.dedyn.io","xiaolajiao.tech","xiaoting.cc","xib.icu","xidealx.com","xiejiang.site","xiejiang.us.ci","xiiqtg.com","xiiqtg.vip","xikemail.com","ximenor.site","xing886.uu.gl","xingmeisofa.com","xirentha.cfd","xitler.top","xitroo.com","xiunt.com","xiwinnie.icu","xjau.homes","xjoi.com","xkgm.hair","xktu.hair","xkx.me","xkxkud.com","xl.cx","xlcsh.icu","xmailer.be","xmailtm.com","xmaily.com","xmastime.com","xmisom.help","xmlab.icu","xms.nl","xmsg.com","xmyvgkvw.top","xn--5nx.cc","xn--9kq967o.com","xn--ai-ry2ck37oorv.com","xn--d-bga.net","xn--di5au2k.shop","xn--ihq4pool8g32cwxiiqcovaa9159jhvah03g.top","xn--jxsa73o.eu.org","xn--o38h.abrdns.com","xn--rhqv96g.tv","xn--yaho-sqa.com","xn-xp8h.bond","xo00wda.loseyourip.com","xojxe.com","xolic.me","xoom.com","xopmail.fun","xost.us","xoxo3.website","xoxox.cc","xperiae5.com","xpremium.pro","xpressmail.zzn.com","xpromail.xyz","xqmm.hair","xqqgegsd.eu.cc","xrap.de","xs4all.nl","xsecurity.org","xshop.bond","xsioap.eu.cc","xsmail.com","xsnipersquad.com","xsnipersquad.site","xsnipersquad.space","xstyled.net","xswl.xyz","xt81.help","xtra.co.nz","xtxt.de5.net","xtzg.beer","xuicf1r.site","xunika.uk","xuno.com","xvx.us","xww.ro","xx.lucky04.dpdns.org","xxhamsterxx.ga","xxi2.com","xxl.st","xxlocanto.us","xxmailedu.dpdns.org","xxolocanto.us","xxqx3802.com","xxvd.net","xxvk.ru","xxvk.store","xxxhi.cc","xxxmailaxx.site","xy9ce.tk","xylanta.cfd","xylar.ru","xylar.store","xyxy.app","xyzfree.net","xzapmail.com","xzsok.com","y0fwzc2.mywire.org","y0p8gli.loseyourip.com","y1dk5vk.giize.com","y4ebvg.nothing688.de5.net","y4plv.cyou","y6jxjln.kozow.com","y7mail.com","ya.ru","yabai-oppai.tk","yabes.ovh","yada-yada.com","yahmail.top","yaho.com","yahoo.ae","yahoo.at","yahoo.be","yahoo.ca","yahoo.ch","yahoo.cn","yahoo.co","yahoo.co.id","yahoo.co.il","yahoo.co.in","yahoo.co.jp","yahoo.co.kr","yahoo.co.nz","yahoo.co.th","yahoo.co.uk","yahoo.co.za","yahoo.com","yahoo.com.ar","yahoo.com.au","yahoo.com.br","yahoo.com.cn","yahoo.com.co","yahoo.com.hk","yahoo.com.is","yahoo.com.mx","yahoo.com.my","yahoo.com.ph","yahoo.com.ru","yahoo.com.sg","yahoo.com.tr","yahoo.com.tw","yahoo.com.vn","yahoo.cz","yahoo.de","yahoo.dk","yahoo.es","yahoo.fi","yahoo.fr","yahoo.gr","yahoo.hu","yahoo.ie","yahoo.in","yahoo.it","yahoo.jp","yahoo.nl","yahoo.no","yahoo.pl","yahoo.pt","yahoo.ro","yahoo.ru","yahoo.se","yahoofs.com","yahoomail.pro","yahooproduct.net","yahoox.cyou","yalla.com","yalla.com.lb","yaloo.fr.nf","yalook.com","yam.com","yamail.win","yandex.by","yandex.com","yandex.kz","yandex.pl","yandex.ru","yandex.ua","yanemail.com","yanet.me","yangzazhong.top","yangzhai.xyz","yangzhong-sfd.cc","yanhd-jkd.top","yannmail.win","yanxuan.eu.cc","yapost.com","yapped.net","yaqp.com","yarnpedia.ga","yasuo.sbs","yawmail.com","yb9ye8c.kozow.com","ybb.ne.jp","ybidbccmv.top","yc08.cn","ycare.de","ycglobalmovement.com","ycn.ro","ydhfks.shop","ydns.eu","ydscontingencia.com","ye.vc","yeah.net","yebox.com","yecp.ru","yecp.store","yedi.org","yeezus.ru","yehey.com","yellofdf2.click","yemenmail.com","yenphandinhe.com","yep.it","yepmail.net","yermail.net","yert.ye.vc","yesey.net","yeummo.io.vn","yfhsdb.eu.cc","yfnc.skin","ygbelira.me","ygebjd8-ktyd.top","ygpa.autos","ygwpr.com","yhg.biz","yifan.net","yihacihuy.top","yilue.eu.org","ying-ge.com","yingzi321.shop","yiuogmq.loseyourip.com","yjlwcbrf.top","yl66.cfd","ymail.com","ymail.ne.jp","ymee.eu.cc","yml666.cc.cd","ymobile.ne.jp","ymobile1.ne.jp","ymonthl.com","ynagjie-66.cc","ynmrealty.com","ynnord.top","yodwg.sbs","yodx.ro","yogamaven.com","yoggm.com","yogirt.com","yogotemail.com","yomail.edu.pl","yomail.info","yomand.store","yondrix.cfd","yongdan-hstn.best","yoo.ro","yopm.zone.id","yopmail.com","yopmail.fr","yopmail.gq","yopmail.kro.kr","yopmail.loseyourip.com","yopmail.net","yopmail.ooguy.com","yopmail.pp.ua","yopmail.theworkpc.com","yopmail.webredirect.org","yopolis.com","yoptruc.fr.nf","yopweb.com","yordanmail.cf","yorushika.one","yotmail.fr.nf","you-spam.com","youareadork.com","yougotgoated.com","youmail.ga","youmailr.com","youneedmore.info","youpymail.com","your-house.com","your-mail.com","your5.ru","your5.store","yourdomain.com","youremail.cf","yourewronghereswhy.com","yourinbox.com","yourlifesucks.cu.cc","yourlms.biz","yourlover.net","yourname.freeservers.com","yournightmare.com","yours.com","yours.tools","yourspamgoesto.space","yourssincerely.com","yoursubdomain.zzn.com","yourteacher.net","yourtube.ml","yourwap.com","yourwiseguide.com","youtube-com-watch-jtpdc8khnpi.accesscam.org","youtube-com-watch-jtpdc8khnpi.bond","youtube-com-watch-jtpdc8khnpi.cyou","youtube-com-watch-jtpdc8khnpi.dedyn.io","youtube-com-watch-jtpdc8khnpi.freeddns.org","youtube-com-watch-jtpdc8khnpi.gleeze.com","youtube-com-watch-jtpdc8khnpi.loseyourip.com","youtube-com-watch-jtpdc8khnpi.mywire.org","youtube-com-watch-jtpdc8khnpi.ooguy.com","youtube-com-watch-jtpdc8khnpi.theworkpc.com","youtube-com-watch-jtpdc8khnpi.webredirect.org","youxiang.dev","ypyb.hair","yroid.com","yrppwsekv.top","ys.deepl.cc.cd","ysfuddr.top","ysgdjd.fun","yshdnhh.click","ysngdtw55n.top","yspend.com","ysuhd.art","yszmy.cn","ytkj.us.ci","ytnhy.com","ytoof.app","ytpayy.com","yugasandrika.com","yui.it","yujiehanjiao.cc","yuki.ren","yummymeow.eu","yummymeow.fr","yummymeow.org","yummymeow.store","yun.pics","yunxiangpnv.lol","yuoia.com","yurevia.cfd","yurovovault.shop","yuuhuu.net","yuurok.com","ywiueryweqrwerqsdf.us.ci","ywzmb.top","yxdad.ru","yxdad.store","yxkm.skin","yxx1.ccwu.cc","yxxala.ccwu.cc","yxxawa.ccwu.cc","yxxawa.top","yxzx.net","yy.lucky04.dpdns.org","yyddss.qzz.io","yyds-mail-03.cc.cd","yyds-mail-04.cc.cd","yyds-mail-05.cc.cd","yyds.729406.xyz","yyds.lkberich.online","yyds.mail.13140905.xyz","yyds.mcmdo.com","yydsmail.cckff.ggff.net","yydsplus.top","yydsyes.ccwu.cc","yyhmail.com","yykzv53.theworkpc.com","yyolf.net","yyqzc8v.giize.com","yzcalo.com","yzm.de","z-o-e-v-a.ru","z0d.eu","z1p.biz","z86.ru","z8ebbq2.camdvr.org","zahadum.com","zahav.net.il","zai.asia","zain.com.co","zain.site","zainmax.net","zaktouni.fr","zalesie.net.pl","zantrax.com","zapmail.one","zaq.ne.jp","zarabotokdoma11.ru","zarkbin.store","zasod.com","zauxpbp.cn","zaym-zaym.ru","zbock.com","zcdpbx.top","zcjzy.cc.cd","zcovz.ru","zcovz.store","zcrcd.com","zdenka.net","zdge.hair","ze.tc","zebins.com","zebins.eu","zeelandnet.nl","zeepost.nl","zehnminuten.de","zehnminutenmail.de","zeldaa.ccwu.cc","zellatrix.cfd","zellio.yachts","zelnro.com","zemzar.net","zenbada.com","zenbyul.com","zensurpirat.de","zenthara.cfd","zenthira.cfd","zenthranet.com","zephyros.cfd","zepp.dk","zeroai.sbs","zeronerbacomail.com","zeropolly.com","zetmail.com","zevionyx.com","zexic.cyou","zfymail.com","zgg0.help","zgx7jfa.nsmjj.cc.cd","zhaji.eu.org","zhanhuokma2.wang","zhaoqian.ninja","zhaowei.net","zhaoyuanedu.cn","zhcne.com","zhengwz.dpdns.org","zhewei88.com","zheye.dickdns.org","zhizhiwei.fun","zhjjq.tech","zhorachu.com","zhouemail.510520.org","zhousj.eu.org","zi7z88eo.mailosaur.net","ziell.my.id","ziggo.nl","zik.dj","zikzak.site","zimf.hair","zionweb.org","zip.net","zipcad.com","zipcatfish.com","zipido.com","ziping.me","ziplip.com","zipmail.com","zipmail.com.br","zipmail.one","zipmax.com","zipo1.gq","zippymail.info","zipsendtest.com","zira.my","ziragold.com","zivox.sbs","ziyoupi.asia","zizo7.com","zjer.ccwu.cc","zjqi.qzz.io","zjsan.ccwu.cc","zjwu.ccwu.cc","zjyi.us.ci","zkfdwz.shop","zkfr.hair","zlqkuzx.ddnsfree.com","zlzu.skin","zmail.cam","zmail.ru","zmnai.top","zmypxprb.sbs","znext.bond","znhyo.dpdns.org","zoaxe.com","zoemail.com","zoemail.net","zoemail.org","zoetropes.org","zoho.com","zohobillings.com","zohomail.com","zolamin.com","zolmiu.cfd","zombie-hive.com","zomg.info","zonnet.nl","zoomintens.com","zoominternet.net","zorg.fr.nf","zouz.fr.nf","zovion.com","zozozo123.com","zpva4pd.mywire.org","zqjq.hair","zqwn.skin","zrpu.hair","zrufe.com","zsero.com","zslsz.com","zsmj.cc.cd","zsts.top","zub.edu.pl","zubee.com","zudpck.com","zuldev.live","zumnime.me","zumpul.com","zutomayo.best","zuvio.com","zuzzurello.com","zv68.com","zvvzuv.com","zw5pkjm.camdvr.org","zwallet.com","zweb.in","zx81.ovh","zxb8bds.loseyourip.com","zxcv.com","zxcvbn123.cc.cd","zxcvbnm.com","zxhyzlwcp.top","zxqzin.cn","zxrey.club","zybermail.com","zydecofan.com","zymuying.com","zyns.com","zypherin.cfd","zyranova.cfd","zyvenix.cfd","zzaidah.cloud","zzeu.us","zzi.us","zzn.com","zzom.co.uk","zzrgg.com","zzz.com","zzz.pl","zzzzzzzzzzzzzz-1090.dynv6.net","zzzzzzzzzzzzzz-2092.dynv6.net","zzzzzzzzzzzzzz-277.dynv6.net","zzzzzzzzzzzzzz-3294.dynv6.net","zzzzzzzzzzzzzz-3330.dynv6.net","zzzzzzzzzzzzzz-3535.dynv6.net","zzzzzzzzzzzzzz-3928.dynv6.net","zzzzzzzzzzzzzz-3940.dynv6.net","zzzzzzzzzzzzzz-4283.dynv6.net","zzzzzzzzzzzzzz-4904.dynv6.net","zzzzzzzzzzzzzz-5055.dynv6.net","zzzzzzzzzzzzzz-5246.dynv6.net","zzzzzzzzzzzzzz-546.dynv6.net","zzzzzzzzzzzzzz-739.dynv6.net","zzzzzzzzzzzzzz-7619.dynv6.net","zzzzzzzzzzzzzz-7911.dynv6.net","zzzzzzzzzzzzzz-8050.dynv6.net","zzzzzzzzzzzzzz-8079.dynv6.net","zzzzzzzzzzzzzz-8874.dynv6.net","zzzzzzzzzzzzzz-969.dynv6.net","zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.loseyourip.com","zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.ooguy.com"]');

CREATE TABLE affiliation_resolutions (
  user_id           TEXT NOT NULL PRIMARY KEY,
  organization_name TEXT,
  normalized_name   TEXT,
  job_title         TEXT,
  domain            TEXT,
  email_id          TEXT,
  organization_id   TEXT,
  matched_by        TEXT,
  is_member         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX affiliation_resolutions_domain ON affiliation_resolutions(domain);

INSERT INTO affiliation_resolutions (user_id, organization_name, normalized_name, job_title, domain, email_id)
WITH RECURSIVE addresses AS (
  SELECT person.id AS user_id, substr(person.normalized_email, instr(person.normalized_email, '@') + 1) AS domain,
         NULL AS email_id, 0 AS preference
    FROM users person
   WHERE person.email_verified_at IS NOT NULL
  UNION ALL
  SELECT address.user_id, substr(address.normalized_email, instr(address.normalized_email, '@') + 1), address.id, 1
    FROM user_emails address
   WHERE address.verified_at IS NOT NULL
),
domain_suffixes (domain, suffix) AS (
  SELECT DISTINCT domain, domain FROM addresses WHERE domain <> ''
  UNION
  SELECT domain, substr(suffix, instr(suffix, '.') + 1) FROM domain_suffixes WHERE instr(suffix, '.') > 0
),
covering_claims AS (
  SELECT suffixes.domain, claim.domain AS claim_domain,
         (claim.organization_id IS NOT NULL AND claim.application_id IS NULL) AS approved,
         ROW_NUMBER() OVER (PARTITION BY suffixes.domain ORDER BY length(claim.domain) DESC) AS rank
    FROM domain_suffixes suffixes
    JOIN organization_domain_claims claim ON claim.domain = suffixes.suffix
),
work_addresses AS (
  SELECT addresses.user_id, COALESCE(covering.claim_domain, addresses.domain) AS domain, addresses.email_id,
         addresses.preference, COALESCE(covering.approved, 0) AS claimed
    FROM addresses
    LEFT JOIN covering_claims covering ON covering.domain = addresses.domain AND covering.rank = 1
   WHERE addresses.domain <> ''
     AND NOT EXISTS (SELECT 1 FROM domain_suffixes suffixes
                       JOIN affiliation_free_email_domains free ON free.domain = suffixes.suffix
                      WHERE suffixes.domain = addresses.domain)
     AND COALESCE(covering.approved, 1) = 1
),
work_domain AS (
  SELECT user_id, domain, email_id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY claimed DESC, preference, email_id) AS rank
    FROM work_addresses
)
SELECT person.id, NULLIF(trim(person.organization_name), ''),
       CASE WHEN NULLIF(trim(person.organization_name), '') IS NOT NULL THEN lower(trim(
         replace(replace(replace(replace(
           replace(replace(replace(person.organization_name, char(9), ' '), char(10), ' '), char(13), ' '),
         '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '))) END,
       NULLIF(trim(person.job_title), ''), work_domain.domain, work_domain.email_id
  FROM users person
  LEFT JOIN work_domain ON work_domain.user_id = person.id AND work_domain.rank = 1
 WHERE person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM identities held
      WHERE held.user_id = person.id AND held.organization_id IS NOT NULL
        AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL)
   AND (NULLIF(trim(person.organization_name), '') IS NOT NULL OR NULLIF(trim(person.job_title), '') IS NOT NULL
        OR work_domain.domain IS NOT NULL);

-- Step 2b. Who owns each work domain. The organization holding an approved
-- claim owns it, unless people already reached another organization through
-- the domain (then staff decide). Without a claim, the one organization
-- verified addresses on the domain already reached owns it, when that is a
-- non-member organization with an active verified-email relationship and no
-- blocked or unprovenanced one. The facts are read as runtime reads them
-- (functions/_lib/services/identities/verified-email-domain.ts).
CREATE TABLE affiliation_domain_facts (
  domain          TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  active          INTEGER NOT NULL,
  disputed        INTEGER NOT NULL,
  unknown         INTEGER NOT NULL,
  member          INTEGER NOT NULL,
  PRIMARY KEY (domain, organization_id)
);
INSERT INTO affiliation_domain_facts (domain, organization_id, active, disputed, unknown, member)
SELECT work.domain, fact.organization_id,
       MAX(CASE WHEN fact.verified_email_domain IS NOT NULL AND fact.source = 'verified_email'
                 AND fact.started_at IS NOT NULL AND fact.ended_at IS NULL AND fact.blocked_at IS NULL
                 AND person.active = 1 THEN 1 ELSE 0 END),
       MAX(CASE WHEN fact.blocked_at IS NOT NULL THEN 1 ELSE 0 END),
       MAX(CASE WHEN fact.verified_email_domain IS NULL THEN 1 ELSE 0 END),
       EXISTS (SELECT 1 FROM members WHERE members.organization_id = fact.organization_id)
  FROM (SELECT DISTINCT domain FROM affiliation_resolutions WHERE domain IS NOT NULL) work
  JOIN identities fact ON fact.organization_id IS NOT NULL
  JOIN users person ON person.id = fact.user_id
  LEFT JOIN user_emails address ON address.id = fact.email_id AND address.user_id = person.id
 WHERE fact.verified_email_domain = work.domain
    OR (fact.verified_email_domain IS NULL AND fact.source = 'verified_email'
        AND ('.' || substr(CASE WHEN fact.email_id IS NULL THEN person.normalized_email ELSE address.normalized_email END,
                   instr(CASE WHEN fact.email_id IS NULL THEN person.normalized_email ELSE address.normalized_email END,
                         '@') + 1)) GLOB ('*.' || work.domain))
 GROUP BY work.domain, fact.organization_id;

UPDATE affiliation_resolutions
   SET organization_id = (SELECT claim.organization_id FROM organization_domain_claims claim
                           WHERE claim.domain = affiliation_resolutions.domain
                             AND claim.organization_id IS NOT NULL AND claim.application_id IS NULL),
       matched_by = 'verified_domain_claim'
 WHERE domain IN (SELECT claim.domain FROM organization_domain_claims claim
                   WHERE claim.organization_id IS NOT NULL AND claim.application_id IS NULL)
   AND NOT EXISTS (
     SELECT 1 FROM affiliation_domain_facts fact
      JOIN organization_domain_claims claim ON claim.domain = fact.domain
     WHERE fact.domain = affiliation_resolutions.domain AND fact.organization_id <> claim.organization_id);

UPDATE affiliation_resolutions
   SET organization_id = (SELECT fact.organization_id FROM affiliation_domain_facts fact
                           WHERE fact.domain = affiliation_resolutions.domain),
       matched_by = 'derived_domain'
 WHERE organization_id IS NULL AND domain IS NOT NULL
   AND domain NOT IN (SELECT claim.domain FROM organization_domain_claims claim)
   AND (SELECT COUNT(*) FROM affiliation_domain_facts fact WHERE fact.domain = affiliation_resolutions.domain) = 1
   AND EXISTS (SELECT 1 FROM affiliation_domain_facts fact
                WHERE fact.domain = affiliation_resolutions.domain
                  AND fact.active = 1 AND fact.disputed = 0 AND fact.unknown = 0 AND fact.member = 0);

UPDATE affiliation_resolutions
   SET is_member = EXISTS (SELECT 1 FROM members WHERE members.organization_id = affiliation_resolutions.organization_id)
 WHERE organization_id IS NOT NULL;

-- Step 2c. The rule joins a non-member organization automatically. A member
-- organization is joined only when the person confirms it (registering or
-- signing in is not joining the consortium, issue #23), so the portal offers
-- it at their next sign-in instead. A person who already had any relationship
-- with the organization (ended, blocked, or still an invitation) keeps it:
-- nothing here revives or bypasses it.
UPDATE affiliation_resolutions
   SET organization_id = NULL, matched_by = NULL
 WHERE is_member = 1
    OR EXISTS (SELECT 1 FROM identities held
                WHERE held.user_id = affiliation_resolutions.user_id
                  AND held.organization_id = affiliation_resolutions.organization_id);

-- Step 2d. Each automatically joined person gets the identity runtime's join
-- would give them, starting now and bound to no event: through a claim it is
-- a verified_domain identity, through a derived domain a verified_email one
-- that records the domain. It carries the title the profile held and stays
-- off the organization's public profile until the person chooses otherwise.
-- Each decision is written to the audit log first, naming the new identity's
-- id and the profile's own spelling, and the identity is created from that
-- entry, so later steps recognize the identities this migration created by
-- their audit entry.
INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'identity_created_from_profile', 'identity', lower(hex(randomblob(16))),
       json_object(
         'userId', json_object('from', NULL, 'to', resolution.user_id),
         'organizationId', json_object('from', NULL, 'to', resolution.organization_id),
         'emailId', json_object('from', NULL, 'to', resolution.email_id),
         'domain', json_object('from', NULL, 'to', resolution.domain),
         'verifiedEmailDomain', json_object('from', NULL, 'to',
           CASE WHEN resolution.matched_by = 'derived_domain' THEN resolution.domain END),
         'source', json_object('from', NULL, 'to',
           CASE WHEN resolution.matched_by = 'derived_domain' THEN 'verified_email' ELSE 'verified_domain' END),
         'jobTitle', json_object('from', NULL, 'to', resolution.job_title),
         'profileOrganizationName', json_object('from', resolution.organization_name, 'to', organization.name),
         'matchedBy', json_object('from', NULL, 'to', resolution.matched_by)),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL
  FROM affiliation_resolutions resolution
  JOIN organizations organization ON organization.id = resolution.organization_id;

INSERT INTO identities (
  id, user_id, organization_id, email_id, verified_email_domain, job_title, source,
  show_on_organization_profile, invited_at, started_at, created_at, updated_at
)
SELECT entry.entity_id, json_extract(entry.details_json, '$.userId.to'),
       json_extract(entry.details_json, '$.organizationId.to'), json_extract(entry.details_json, '$.emailId.to'),
       json_extract(entry.details_json, '$.verifiedEmailDomain.to'), json_extract(entry.details_json, '$.jobTitle.to'),
       json_extract(entry.details_json, '$.source.to'), 0,
       entry.created_at, entry.created_at, entry.created_at, entry.created_at
  FROM audit_log entry
 WHERE entry.action = 'identity_created_from_profile' AND entry.entity_type = 'identity'
   AND json_extract(entry.details_json, '$.organizationId.to') IS NOT NULL;

-- Step 2e. Identity is independent of membership, so every other person
-- without an active identity receives an individual identity, logged and
-- created the same way. So does an individual member whose only active
-- identities are organization ones, since their membership moves to a
-- personal identity below. The individual/organization exclusivity triggers
-- are gone, and the anti-join respects uq_identities_active_individual. An
-- individual identity carries no title; step 2i keeps a title held without
-- an organization.
INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'identity_created_from_profile', 'identity', lower(hex(randomblob(16))),
       json_object(
         'userId', json_object('from', NULL, 'to', person.id),
         'organizationId', json_object('from', NULL, 'to', NULL),
         'matchedBy', json_object('from', NULL, 'to', 'individual')),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL
  FROM users person
 WHERE person.merged_into_user_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM identities held
      WHERE held.user_id = person.id
        AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL
        AND (held.organization_id IS NULL
             OR NOT EXISTS (SELECT 1 FROM members member
                             WHERE member.user_id = person.id AND member.member_type = 'individual')));

INSERT INTO identities (
  id, user_id, organization_id, source, show_on_organization_profile,
  invited_at, started_at, created_at, updated_at
)
SELECT entry.entity_id, json_extract(entry.details_json, '$.userId.to'), NULL, 'migration', 0,
       entry.created_at, entry.created_at, entry.created_at, entry.created_at
  FROM audit_log entry
 WHERE entry.action = 'identity_created_from_profile' AND entry.entity_type = 'identity'
   AND json_extract(entry.details_json, '$.matchedBy.to') = 'individual';

-- Step 2f. A person who already held the organization identity their profile
-- named (by its exact normalized spelling) keeps the profile's title on it
-- when the identity had none.
INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'identity_job_title_backfilled', 'identity', identity.id,
       json_object('jobTitle', json_object('from', NULL, 'to', trim(person.job_title))),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL
  FROM identities identity
  JOIN users person ON person.id = identity.user_id
  JOIN organizations organization ON organization.id = identity.organization_id
 WHERE identity.job_title IS NULL
   AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
   AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
   AND NULLIF(trim(person.job_title), '') IS NOT NULL
   AND organization.normalized_name = lower(trim(
         replace(replace(replace(replace(
           replace(replace(replace(person.organization_name, char(9), ' '), char(10), ' '), char(13), ' '),
         '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')));

UPDATE identities
   SET job_title = (SELECT trim(person.job_title) FROM users person WHERE person.id = identities.user_id),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id IN (SELECT entry.entity_id FROM audit_log entry WHERE entry.action = 'identity_job_title_backfilled');

-- Step 2g. Work addresses belong to identities while the person keeps owning
-- every address and passkey. An address belongs to at most one identity of
-- the same person; the identity's selected address is the first it owns.
ALTER TABLE user_emails ADD COLUMN identity_id TEXT REFERENCES identities(id) ON DELETE SET NULL;
CREATE INDEX user_emails_identity ON user_emails(identity_id) WHERE identity_id IS NOT NULL;
CREATE TRIGGER user_email_identity_owner_insert BEFORE INSERT ON user_emails
WHEN NEW.identity_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM identities identity WHERE identity.id = NEW.identity_id AND identity.user_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'USER_EMAIL_IDENTITY_OWNER_MISMATCH'); END;
CREATE TRIGGER user_email_identity_owner_update BEFORE UPDATE OF identity_id, user_id ON user_emails
WHEN NEW.identity_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM identities identity WHERE identity.id = NEW.identity_id AND identity.user_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'USER_EMAIL_IDENTITY_OWNER_MISMATCH'); END;

UPDATE user_emails
   SET identity_id = (SELECT identity.id FROM identities identity WHERE identity.email_id = user_emails.id)
 WHERE identity_id IS NULL
   AND (SELECT COUNT(*) FROM identities identity WHERE identity.email_id = user_emails.id) = 1;

-- Step 2h. Text that no identity represents is kept for staff review rather
-- than dropped: an organization name no active identity of the person carries
-- by its exact normalized spelling, or a title on none of their active
-- organization identities. An identity step 2d joined through the person's
-- work domain represents their profile, whatever spelling it used. A review
-- keeps the person's work domain, so staff and the person's own organization
-- offer can see where it points.
INSERT INTO affiliation_reviews (
  id, user_id, organization_name, normalized_name, job_title, email_domain, group_key, source_type, source_id, created_at
)
SELECT lower(hex(randomblob(16))), person.id, written.organization_name, written.normalized_name,
       NULLIF(trim(person.job_title), ''),
       (SELECT resolution.domain FROM affiliation_resolutions resolution WHERE resolution.user_id = person.id),
       COALESCE(written.normalized_name, 'person:' || person.id),
       'user_profile', person.id, strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM users person
  JOIN (
    SELECT id,
           NULLIF(trim(organization_name), '') AS organization_name,
           CASE WHEN NULLIF(trim(organization_name), '') IS NOT NULL THEN lower(trim(
             replace(replace(replace(replace(
               replace(replace(replace(organization_name, char(9), ' '), char(10), ' '), char(13), ' '),
             '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '))) END AS normalized_name
      FROM users
  ) written ON written.id = person.id
 WHERE person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
   AND (written.organization_name IS NOT NULL OR NULLIF(trim(person.job_title), '') IS NOT NULL)
   -- A title without any organization is an individual title (step 2i).
   AND NOT (
     written.organization_name IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM identities held
        WHERE held.user_id = person.id AND held.organization_id IS NOT NULL
          AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL))
   AND NOT EXISTS (
     SELECT 1
       FROM identities held
       JOIN organizations organization ON organization.id = held.organization_id
      WHERE held.user_id = person.id
        AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL
        AND (
          written.organization_name IS NULL
          OR held.id IN (SELECT entry.entity_id FROM audit_log entry
                          WHERE entry.action = 'identity_created_from_profile' AND entry.entity_type = 'identity')
          OR organization.normalized_name = written.normalized_name
        )
        AND (NULLIF(trim(person.job_title), '') IS NULL OR held.job_title IS trim(person.job_title)));

-- Step 2i. A title held without an organization identity.
INSERT INTO individual_job_titles (user_id, job_title, created_at, updated_at)
SELECT person.id, trim(person.job_title),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM users person
 WHERE person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
   AND NULLIF(trim(person.organization_name), '') IS NULL
   AND NULLIF(trim(person.job_title), '') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM identities held
      WHERE held.user_id = person.id AND held.organization_id IS NOT NULL
        AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL);

INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'individual_job_title_retained', 'user', title.user_id,
       json_object('jobTitle', json_object('from', NULL, 'to', title.job_title)),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL
  FROM individual_job_titles title;

-- Step 3. Proposal speakers no longer override organization or title: the
-- speaker's acting identity, else their identity, is the only source. An
-- override no identity of the speaker represents by its exact normalized
-- spelling goes to review first.
INSERT INTO affiliation_reviews (
  id, user_id, organization_name, normalized_name, job_title, email_domain, group_key, source_type, source_id, created_at
)
SELECT lower(hex(randomblob(16))), speaker.user_id, override.organization_name, override.normalized_name,
       override.job_title,
       (SELECT resolution.domain FROM affiliation_resolutions resolution WHERE resolution.user_id = speaker.user_id),
       COALESCE(override.normalized_name, 'person:' || speaker.user_id),
       'proposal_speaker', speaker.id, strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM proposal_speakers speaker
  JOIN users person ON person.id = speaker.user_id
  JOIN (
    SELECT stated.id, stated.organization_name, stated.job_title,
           CASE WHEN stated.organization_name IS NOT NULL THEN lower(trim(
             replace(replace(replace(replace(
               replace(replace(replace(stated.organization_name, char(9), ' '), char(10), ' '), char(13), ' '),
             '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '))) END AS normalized_name
      FROM (
        SELECT id,
               NULLIF(trim(CAST(json_extract(profile_overrides_json, '$.organizationName') AS TEXT)), '') AS organization_name,
               NULLIF(trim(CAST(json_extract(profile_overrides_json, '$.jobTitle') AS TEXT)), '') AS job_title
          FROM proposal_speakers
         WHERE json_valid(profile_overrides_json)
      ) stated
  ) override ON override.id = speaker.id
 WHERE person.pii_redacted_at IS NULL
   AND (override.organization_name IS NOT NULL OR override.job_title IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1
       FROM identities held
       JOIN organizations organization ON organization.id = held.organization_id
      WHERE held.user_id = speaker.user_id
        AND (override.organization_name IS NULL OR organization.normalized_name = override.normalized_name)
        AND (override.job_title IS NULL OR held.job_title IS override.job_title));

INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'proposal_speaker_affiliation_override_removed', 'proposal_speaker',
       speaker.id,
       json_object(
         'organizationName', json_object('from', json_extract(speaker.profile_overrides_json, '$.organizationName'), 'to', NULL),
         'jobTitle', json_object('from', json_extract(speaker.profile_overrides_json, '$.jobTitle'), 'to', NULL)),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'proposal', speaker.proposal_id
  FROM proposal_speakers speaker
 WHERE json_valid(speaker.profile_overrides_json)
   AND (json_type(speaker.profile_overrides_json, '$.organizationName') IS NOT NULL
        OR json_type(speaker.profile_overrides_json, '$.jobTitle') IS NOT NULL);

UPDATE proposal_speakers
   SET profile_overrides_json = json_remove(profile_overrides_json, '$.organizationName', '$.jobTitle')
 WHERE json_valid(profile_overrides_json)
   AND (json_type(profile_overrides_json, '$.organizationName') IS NOT NULL
        OR json_type(profile_overrides_json, '$.jobTitle') IS NOT NULL);

INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'affiliation_review_opened', 'affiliation_review', review.id,
       json_object(
         'organizationName', json_object('from', NULL, 'to', review.organization_name),
         'jobTitle', json_object('from', NULL, 'to', review.job_title),
         'emailDomain', json_object('from', NULL, 'to', review.email_domain),
         'sourceType', json_object('from', NULL, 'to', review.source_type)),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL
  FROM affiliation_reviews review;

-- The rule's working tables served steps 2 and 3 only.
DROP TABLE affiliation_domain_facts;
DROP TABLE affiliation_resolutions;
DROP TABLE affiliation_free_email_domains;

-- Step 4. The identity a person's session acted as when it wrote the audit
-- row: the organization affiliation or individual capacity they spoke for.
-- NULL for system, public and API-key actors, and while a person holding
-- several identities had not chosen one. No foreign key, like the row's other
-- actor columns: the audit trail outlives any identity it names. No index:
-- rows are read by scope, entity, actor and time, never by acting identity.
ALTER TABLE audit_log ADD COLUMN actor_identity_id TEXT;

-- Earlier rows of every person-backed actor type (admin, member, user — the
-- shared USER_BACKED_AUDIT_ACTOR_TYPES) name an identity only where it is
-- certain: the actor held exactly one identity at the row's instant. A
-- migration-sourced identity stands for the affiliation the user record
-- already carried, so when it is the person's only identity it also covers
-- the rows written before it started. Older rows may carry a space-separated
-- timestamp, so instants compare through julianday().
UPDATE audit_log
   SET actor_identity_id = (
         SELECT identity.id
           FROM identities identity
          WHERE identity.user_id = audit_log.actor_id
            AND identity.started_at IS NOT NULL
            AND (julianday(identity.started_at) <= julianday(audit_log.created_at)
                 OR (identity.source = 'migration'
                     AND NOT EXISTS (SELECT 1 FROM identities other
                                      WHERE other.user_id = identity.user_id AND other.id <> identity.id)))
            AND (identity.ended_at IS NULL OR julianday(identity.ended_at) > julianday(audit_log.created_at))
       )
 WHERE actor_type IN ('admin', 'member', 'user')
   AND actor_id IS NOT NULL
   AND actor_identity_id IS NULL
   AND (
         SELECT COUNT(*)
           FROM identities identity
          WHERE identity.user_id = audit_log.actor_id
            AND identity.started_at IS NOT NULL
            AND (julianday(identity.started_at) <= julianday(audit_log.created_at)
                 OR (identity.source = 'migration'
                     AND NOT EXISTS (SELECT 1 FROM identities other
                                      WHERE other.user_id = identity.user_id AND other.id <> identity.id)))
            AND (identity.ended_at IS NULL OR julianday(identity.ended_at) > julianday(audit_log.created_at))
       ) = 1;

-- Step 5a. A biography and links belong to an identity, never to the person
-- as well. The person's own copy completes their primary identity where it is
-- blank, else their individual identity, and is recorded in the audit trail
-- either way before the column goes.
INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'person_profile_moved_to_identity', 'user', person.id,
       json_object(
         'biography', json_object('from', NULLIF(trim(COALESCE(person.biography, '')), ''), 'to', NULL),
         'links', json_object('from', CASE WHEN json_valid(person.links_json) THEN json(person.links_json) END, 'to', NULL)),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL
  FROM users person
 WHERE NULLIF(trim(COALESCE(person.biography, '')), '') IS NOT NULL
    OR (json_valid(person.links_json) AND json_type(person.links_json) = 'array' AND json_array_length(person.links_json) > 0);

CREATE TABLE person_profile_carry AS
SELECT person.id AS user_id,
       NULLIF(trim(COALESCE(person.biography, '')), '') AS biography,
       CASE WHEN json_valid(person.links_json) AND json_type(person.links_json) = 'array'
                 AND json_array_length(person.links_json) > 0 THEN person.links_json END AS links_json,
       (SELECT held.id FROM identities held
         WHERE held.user_id = person.id
           AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL
         ORDER BY held.is_default DESC, held.organization_id IS NULL, held.started_at, held.id
         LIMIT 1) AS primary_identity_id,
       (SELECT held.id FROM identities held
         WHERE held.user_id = person.id AND held.organization_id IS NULL
           AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL
         LIMIT 1) AS individual_identity_id
  FROM users person
 WHERE person.merged_into_user_id IS NULL AND person.pii_redacted_at IS NULL
   AND (NULLIF(trim(COALESCE(person.biography, '')), '') IS NOT NULL
        OR (json_valid(person.links_json) AND json_type(person.links_json) = 'array' AND json_array_length(person.links_json) > 0));

-- The identity each value completes: the primary one when it is blank there,
-- else the individual one when it is blank there.
CREATE TABLE person_profile_targets AS
SELECT carry.user_id, 'biography' AS field, carry.biography AS value,
       CASE WHEN EXISTS (SELECT 1 FROM identities held WHERE held.id = carry.primary_identity_id
                          AND NULLIF(trim(COALESCE(held.biography, '')), '') IS NULL) THEN carry.primary_identity_id
            WHEN EXISTS (SELECT 1 FROM identities held WHERE held.id = carry.individual_identity_id
                          AND NULLIF(trim(COALESCE(held.biography, '')), '') IS NULL) THEN carry.individual_identity_id
       END AS identity_id
  FROM person_profile_carry carry WHERE carry.biography IS NOT NULL
UNION ALL
SELECT carry.user_id, 'links', carry.links_json,
       CASE WHEN EXISTS (SELECT 1 FROM identities held WHERE held.id = carry.primary_identity_id
                          AND COALESCE(held.links_json, '[]') IN ('', '[]')) THEN carry.primary_identity_id
            WHEN EXISTS (SELECT 1 FROM identities held WHERE held.id = carry.individual_identity_id
                          AND COALESCE(held.links_json, '[]') IN ('', '[]')) THEN carry.individual_identity_id
       END
  FROM person_profile_carry carry WHERE carry.links_json IS NOT NULL;

INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'identity_profile_completed', 'identity', target.identity_id,
       json_object(
         'source', json_object('from', NULL, 'to', 'person'),
         target.field, json_object('from', NULL, 'to', CASE WHEN target.field = 'links' THEN json(target.value) ELSE target.value END)),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL
  FROM person_profile_targets target
 WHERE target.identity_id IS NOT NULL;

UPDATE identities
   SET biography = COALESCE((SELECT target.value FROM person_profile_targets target
                              WHERE target.identity_id = identities.id AND target.field = 'biography'), biography),
       links_json = COALESCE((SELECT target.value FROM person_profile_targets target
                               WHERE target.identity_id = identities.id AND target.field = 'links'), links_json),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id IN (SELECT target.identity_id FROM person_profile_targets target WHERE target.identity_id IS NOT NULL);

DROP TABLE person_profile_targets;
DROP TABLE person_profile_carry;

-- Step 5b. A proposal no longer keeps its own copy of a speaker's name,
-- biography, links or photo: the person owns the name and photo, and the
-- identity they speak as owns the biography and links. Each proposal copy is
-- first recorded in full in the audit trail, then completes only what the
-- person or identity left blank — the most recent proposal's value wins — and
-- never replaces a value they already hold, the person's own (step 5a)
-- included. The working table names, per
-- roster row, the identity the speaker speaks as (chosen, else individual when
-- they chose to take part as one, else primary) and the copy it carried.
CREATE TABLE proposal_speaker_profile_carry AS
SELECT speaker.id AS speaker_id, speaker.proposal_id, speaker.user_id, speaker.created_at,
       CASE WHEN speaker.acting_identity_id IS NOT NULL THEN speaker.acting_identity_id
            WHEN speaker.acting_identity_selected_at IS NOT NULL THEN (
              SELECT held.id FROM identities held
               WHERE held.user_id = speaker.user_id AND held.organization_id IS NULL
                 AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL
               LIMIT 1)
            ELSE (
              SELECT held.id FROM identities held
               WHERE held.user_id = speaker.user_id
                 AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL
               ORDER BY held.is_default DESC, held.organization_id IS NULL, held.started_at, held.id
               LIMIT 1) END AS identity_id,
       NULLIF(trim(CAST(json_extract(speaker.profile_overrides_json, '$.firstName') AS TEXT)), '') AS first_name,
       NULLIF(trim(CAST(json_extract(speaker.profile_overrides_json, '$.lastName') AS TEXT)), '') AS last_name,
       NULLIF(trim(CAST(json_extract(speaker.profile_overrides_json, '$.biography') AS TEXT)), '') AS biography,
       CASE WHEN json_type(speaker.profile_overrides_json, '$.links') = 'array'
                 AND json_array_length(speaker.profile_overrides_json, '$.links') > 0
              THEN json_extract(speaker.profile_overrides_json, '$.links')
            WHEN json_type(speaker.profile_overrides_json, '$.links') = 'text'
                 AND json_valid(json_extract(speaker.profile_overrides_json, '$.links'))
                 AND json_type(json_extract(speaker.profile_overrides_json, '$.links')) = 'array'
                 AND json_array_length(json_extract(speaker.profile_overrides_json, '$.links')) > 0
              THEN json_extract(speaker.profile_overrides_json, '$.links') END AS links_json,
       CASE WHEN speaker.headshot_override_set = 1 THEN speaker.headshot_r2_key END AS headshot_r2_key,
       CASE WHEN speaker.headshot_override_set = 1 THEN speaker.headshot_updated_at END AS headshot_updated_at,
       speaker.profile_overrides_json AS overrides_json,
       speaker.headshot_override_set
  FROM proposal_speakers speaker
  JOIN users person ON person.id = speaker.user_id
 WHERE person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
   AND ((json_valid(speaker.profile_overrides_json) AND speaker.profile_overrides_json <> '{}')
        OR speaker.headshot_override_set = 1);

-- Every removed proposal copy, in full, before anything is carried.
INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'proposal_speaker_profile_override_removed', 'proposal_speaker',
       carry.speaker_id,
       json_object(
         'profileOverrides', json_object('from', json(carry.overrides_json), 'to', NULL),
         'headshotR2Key', json_object('from', carry.headshot_r2_key, 'to', NULL),
         'headshotOverrideSet', json_object('from', carry.headshot_override_set, 'to', NULL)),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'proposal', carry.proposal_id
  FROM proposal_speaker_profile_carry carry;

-- A blank name of the person takes the most recent proposal's spelling.
INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'person_name_completed_from_proposal', 'user', person.id,
       json_object(
         'firstName', json_object('from', person.first_name, 'to', CASE WHEN NULLIF(trim(COALESCE(person.first_name, '')), '') IS NULL THEN (
           SELECT carry.first_name FROM proposal_speaker_profile_carry carry
            WHERE carry.user_id = person.id AND carry.first_name IS NOT NULL
            ORDER BY carry.created_at DESC, carry.speaker_id DESC LIMIT 1) ELSE person.first_name END),
         'lastName', json_object('from', person.last_name, 'to', CASE WHEN NULLIF(trim(COALESCE(person.last_name, '')), '') IS NULL THEN (
           SELECT carry.last_name FROM proposal_speaker_profile_carry carry
            WHERE carry.user_id = person.id AND carry.last_name IS NOT NULL
            ORDER BY carry.created_at DESC, carry.speaker_id DESC LIMIT 1) ELSE person.last_name END)),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL
  FROM users person
 WHERE (NULLIF(trim(COALESCE(person.first_name, '')), '') IS NULL
        AND EXISTS (SELECT 1 FROM proposal_speaker_profile_carry carry WHERE carry.user_id = person.id AND carry.first_name IS NOT NULL))
    OR (NULLIF(trim(COALESCE(person.last_name, '')), '') IS NULL
        AND EXISTS (SELECT 1 FROM proposal_speaker_profile_carry carry WHERE carry.user_id = person.id AND carry.last_name IS NOT NULL));

UPDATE users
   SET first_name = CASE WHEN NULLIF(trim(COALESCE(first_name, '')), '') IS NULL THEN COALESCE((
         SELECT carry.first_name FROM proposal_speaker_profile_carry carry
          WHERE carry.user_id = users.id AND carry.first_name IS NOT NULL
          ORDER BY carry.created_at DESC, carry.speaker_id DESC LIMIT 1), first_name) ELSE first_name END,
       last_name = CASE WHEN NULLIF(trim(COALESCE(last_name, '')), '') IS NULL THEN COALESCE((
         SELECT carry.last_name FROM proposal_speaker_profile_carry carry
          WHERE carry.user_id = users.id AND carry.last_name IS NOT NULL
          ORDER BY carry.created_at DESC, carry.speaker_id DESC LIMIT 1), last_name) ELSE last_name END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id IN (SELECT entry.entity_id FROM audit_log entry WHERE entry.action = 'person_name_completed_from_proposal');

-- A blank photo of the person takes the most recent proposal photo; the
-- object stays where it is, which both keys resolve to.
INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'person_headshot_completed_from_proposal', 'user', person.id,
       json_object('headshotR2Key', json_object('from', NULL, 'to', (
         SELECT carry.headshot_r2_key FROM proposal_speaker_profile_carry carry
          WHERE carry.user_id = person.id AND carry.headshot_r2_key IS NOT NULL
          ORDER BY carry.created_at DESC, carry.speaker_id DESC LIMIT 1))),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL
  FROM users person
 WHERE person.headshot_r2_key IS NULL
   AND EXISTS (SELECT 1 FROM proposal_speaker_profile_carry carry WHERE carry.user_id = person.id AND carry.headshot_r2_key IS NOT NULL);

UPDATE users
   SET headshot_r2_key = (
         SELECT carry.headshot_r2_key FROM proposal_speaker_profile_carry carry
          WHERE carry.user_id = users.id AND carry.headshot_r2_key IS NOT NULL
          ORDER BY carry.created_at DESC, carry.speaker_id DESC LIMIT 1),
       headshot_updated_at = COALESCE((
         SELECT carry.headshot_updated_at FROM proposal_speaker_profile_carry carry
          WHERE carry.user_id = users.id AND carry.headshot_r2_key IS NOT NULL
          ORDER BY carry.created_at DESC, carry.speaker_id DESC LIMIT 1), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE headshot_r2_key IS NULL
   AND id IN (SELECT entry.entity_id FROM audit_log entry WHERE entry.action = 'person_headshot_completed_from_proposal');

-- A blank biography or links of the identity spoken as take the most recent proposal's.
INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'identity_profile_completed', 'identity', identity.id,
       json_object(
         'source', json_object('from', NULL, 'to', 'proposal_speaker'),
         'biography', json_object('from', identity.biography, 'to', CASE WHEN NULLIF(trim(COALESCE(identity.biography, '')), '') IS NULL THEN (
           SELECT carry.biography FROM proposal_speaker_profile_carry carry
            WHERE carry.identity_id = identity.id AND carry.biography IS NOT NULL
            ORDER BY carry.created_at DESC, carry.speaker_id DESC LIMIT 1) ELSE identity.biography END),
         'links', json_object('from', json(COALESCE(identity.links_json, '[]')), 'to', json(CASE WHEN COALESCE(identity.links_json, '[]') IN ('', '[]') THEN COALESCE((
           SELECT carry.links_json FROM proposal_speaker_profile_carry carry
            WHERE carry.identity_id = identity.id AND carry.links_json IS NOT NULL
            ORDER BY carry.created_at DESC, carry.speaker_id DESC LIMIT 1), '[]') ELSE identity.links_json END))),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL
  FROM identities identity
 WHERE identity.ended_at IS NULL AND identity.blocked_at IS NULL
   AND ((NULLIF(trim(COALESCE(identity.biography, '')), '') IS NULL
        AND EXISTS (SELECT 1 FROM proposal_speaker_profile_carry carry WHERE carry.identity_id = identity.id AND carry.biography IS NOT NULL))
    OR (COALESCE(identity.links_json, '[]') IN ('', '[]')
        AND EXISTS (SELECT 1 FROM proposal_speaker_profile_carry carry WHERE carry.identity_id = identity.id AND carry.links_json IS NOT NULL)));

UPDATE identities
   SET biography = CASE WHEN NULLIF(trim(COALESCE(biography, '')), '') IS NULL THEN COALESCE((
         SELECT carry.biography FROM proposal_speaker_profile_carry carry
          WHERE carry.identity_id = identities.id AND carry.biography IS NOT NULL
          ORDER BY carry.created_at DESC, carry.speaker_id DESC LIMIT 1), biography) ELSE biography END,
       links_json = CASE WHEN COALESCE(links_json, '[]') IN ('', '[]') THEN COALESCE((
         SELECT carry.links_json FROM proposal_speaker_profile_carry carry
          WHERE carry.identity_id = identities.id AND carry.links_json IS NOT NULL
          ORDER BY carry.created_at DESC, carry.speaker_id DESC LIMIT 1), links_json) ELSE links_json END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id IN (SELECT entry.entity_id FROM audit_log entry
               WHERE entry.action = 'identity_profile_completed' AND entry.actor_type = 'system'
                 AND json_extract(entry.details_json, '$.source.to') = 'proposal_speaker');

DROP TABLE proposal_speaker_profile_carry;

-- Step 5. Nothing reads or writes the copies any more: the person keeps the
-- name and photo, the identity the organization, title, biography and links.
-- No index, view or trigger names these columns, so SQLite drops them in
-- place without rebuilding either table.
ALTER TABLE users DROP COLUMN organization_name;
ALTER TABLE users DROP COLUMN job_title;
ALTER TABLE users DROP COLUMN biography;
ALTER TABLE users DROP COLUMN links_json;
ALTER TABLE proposal_speakers DROP COLUMN profile_overrides_json;
ALTER TABLE proposal_speakers DROP COLUMN headshot_override_set;
ALTER TABLE proposal_speakers DROP COLUMN headshot_r2_key;
ALTER TABLE proposal_speakers DROP COLUMN headshot_updated_at;
-- Registration facts are reconciled against identities, not copied into an
-- audit history. A name alone cannot establish a new organization affiliation.
-- Unrepresented historical facts stay in the existing review queue; matching
-- facts and empty values need no additional record.
-- A missing current title can be filled only by one consistent registration
-- title for that already established organization identity. An explicit
-- selected identity is authoritative; other held identities are not substituted.
WITH registration_titles AS (
  SELECT registration.user_id, registration.registration_identity_id AS identity_id,
         organization.id AS organization_id, NULLIF(trim(registration.registration_job_title), '') AS job_title
  FROM registrations registration
  JOIN users person ON person.id = registration.user_id
  JOIN organizations organization ON organization.normalized_name = lower(trim(
    replace(replace(replace(replace(
      replace(replace(replace(registration.registration_organization_name, char(9), ' '), char(10), ' '), char(13), ' '),
    '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')))
  WHERE person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
    AND NULLIF(trim(registration.registration_job_title), '') IS NOT NULL
)
UPDATE identities SET job_title = (
  SELECT MIN(stated.job_title) FROM registration_titles stated
  WHERE stated.user_id = identities.user_id AND stated.organization_id = identities.organization_id
    AND (stated.identity_id IS NULL OR stated.identity_id = identities.id)),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE identities.job_title IS NULL AND identities.organization_id IS NOT NULL
  AND identities.started_at IS NOT NULL AND identities.ended_at IS NULL AND identities.blocked_at IS NULL
  AND (SELECT COUNT(DISTINCT stated.job_title) FROM registration_titles stated
       WHERE stated.user_id = identities.user_id AND stated.organization_id = identities.organization_id
         AND (stated.identity_id IS NULL OR stated.identity_id = identities.id)) = 1;
-- Bind a formerly unselected registration only when its explicit facts name
-- exactly one already-held organization identity. Never guess across matches.
UPDATE registrations SET registration_identity_id = (
  SELECT MIN(held.id) FROM identities held JOIN organizations organization ON organization.id = held.organization_id
  WHERE held.user_id = registrations.user_id
    AND organization.normalized_name = lower(trim(replace(replace(replace(replace(
      replace(replace(replace(registrations.registration_organization_name, char(9), ' '), char(10), ' '), char(13), ' '),
      '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')))
    AND (NULLIF(trim(registrations.registration_job_title), '') IS NULL
         OR held.job_title IS trim(registrations.registration_job_title)) HAVING COUNT(*) = 1)
WHERE registration_identity_id IS NULL
  AND NULLIF(trim(registration_organization_name), '') IS NOT NULL
  AND EXISTS (SELECT 1 FROM users person WHERE person.id = registrations.user_id
              AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL);
-- Title-only facts fit the established personal-title projection. Preserve a
-- single consistent value only when no current title or organization replaces it.
INSERT INTO individual_job_titles(user_id, job_title, created_at, updated_at)
SELECT registration.user_id, MIN(trim(registration.registration_job_title)),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM registrations registration JOIN users person ON person.id = registration.user_id
WHERE person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
  AND NULLIF(trim(registration.registration_organization_name), '') IS NULL
  AND NULLIF(trim(registration.registration_job_title), '') IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM individual_job_titles title WHERE title.user_id = registration.user_id)
  AND EXISTS(SELECT 1 FROM identities held WHERE held.user_id = registration.user_id AND held.organization_id IS NULL
             AND (registration.registration_identity_id IS NULL OR held.id = registration.registration_identity_id))
  AND NOT EXISTS(SELECT 1 FROM identities held WHERE held.user_id = registration.user_id AND held.organization_id IS NOT NULL
                 AND held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL)
GROUP BY registration.user_id HAVING COUNT(DISTINCT trim(registration.registration_job_title)) = 1;
INSERT INTO affiliation_reviews (
  id, user_id, organization_name, normalized_name, job_title, email_domain, group_key, source_type, source_id, created_at
)
SELECT lower(hex(randomblob(16))), registration.user_id, written.organization_name, written.normalized_name,
       written.job_title, NULL, COALESCE(written.normalized_name, 'person:' || registration.user_id),
       'registration', registration.id, strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM registrations registration
  JOIN users person ON person.id = registration.user_id
  JOIN (
    SELECT id, NULLIF(trim(registration_organization_name), '') AS organization_name,
           NULLIF(trim(registration_job_title), '') AS job_title,
           CASE WHEN NULLIF(trim(registration_organization_name), '') IS NOT NULL THEN lower(trim(
             replace(replace(replace(replace(
               replace(replace(replace(registration_organization_name, char(9), ' '), char(10), ' '), char(13), ' '),
             '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '))) END AS normalized_name
      FROM registrations
  ) written ON written.id = registration.id
 WHERE person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
   AND (written.organization_name IS NOT NULL OR written.job_title IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1 FROM identities held
     JOIN organizations organization ON organization.id = held.organization_id
     WHERE held.user_id = registration.user_id
       AND (registration.registration_identity_id IS NULL OR held.id = registration.registration_identity_id)
       AND (written.organization_name IS NULL OR organization.normalized_name = written.normalized_name)
       AND (written.job_title IS NULL OR held.job_title IS written.job_title))
   AND NOT (written.organization_name IS NULL
     AND (registration.registration_identity_id IS NULL OR EXISTS (
       SELECT 1 FROM identities selected WHERE selected.id = registration.registration_identity_id
         AND selected.user_id = registration.user_id AND selected.organization_id IS NULL))
     AND EXISTS (
     SELECT 1 FROM individual_job_titles title
     WHERE title.user_id = registration.user_id AND title.job_title IS written.job_title));
-- Audit only the review pointer, not a second copy of its personal facts.
INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
SELECT lower(hex(randomblob(16))), 'system', NULL, 'registration_affiliation_review_opened', 'registration',
       registration.id,
       json_object('reviewId', review.id, 'registrationIdentityId', registration.registration_identity_id),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'event', registration.event_id
  FROM affiliation_reviews review
  JOIN registrations registration ON registration.id = review.source_id
 WHERE review.source_type = 'registration';
ALTER TABLE registrations DROP COLUMN registration_organization_name;
ALTER TABLE registrations DROP COLUMN registration_job_title;

-- ── Organization merges ────────────────────────────────────────────────────
-- Staff merge a duplicate organization into the one that stays. An
-- identity's organization never changes, so the duplicate keeps its record,
-- marked with the organization it was merged into: its ended identities,
-- history and credits still name it, its slug and id lead to the target, and
-- it leaves every directory and picker. A merge into an organization that is
-- itself merged later is re-pointed, so the column always names a live
-- organization. Who merged what is in the audit log.
ALTER TABLE organizations ADD COLUMN merged_into_organization_id TEXT REFERENCES organizations(id);
ALTER TABLE organizations ADD COLUMN merged_at TEXT;
CREATE INDEX organizations_merged_into ON organizations(merged_into_organization_id)
  WHERE merged_into_organization_id IS NOT NULL;

-- ── Membership belongs to an identity ──────────────────────────────────────
-- An identity, personal or organization, holds a membership; a user does not.
-- An organization membership resolves through members.organization_id and an
-- individual membership names the personal identity that holds it. The
-- members table is rebuilt without user_id (owner-approved rebuild; see the
-- membership identity rebuild record). Rows keep their ids, so every table
-- that references members(id) keeps its rows; foreign keys are deferred to the
-- end of the migration's transaction and must all hold again by then.
PRAGMA defer_foreign_keys = TRUE;

-- Each individual membership moves to the personal identity its person held
-- before this migration: the live one, else the only one they ever held. Only
-- a member who held none falls back to the personal identity created above.
-- Nothing is guessed: a row with no such identity stays NULL here and the new
-- table's members_holder check aborts the whole migration for review.
CREATE TABLE members_identity_rebuild AS
SELECT member.id, member.member_type, member.organization_id, member.status, member.tier,
       member.data_json, member.member_since, member.created_at, member.updated_at,
       CASE WHEN member.member_type = 'individual' THEN COALESCE(
         (SELECT MIN(identity.id) FROM identities identity
           WHERE identity.user_id = member.user_id
             AND identity.organization_id IS NULL
             AND identity.started_at IS NOT NULL
             AND identity.ended_at IS NULL
             AND identity.blocked_at IS NULL
             AND identity.id NOT IN (SELECT created.entity_id FROM audit_log created
                                      WHERE created.action = 'identity_created_from_profile'
                                        AND created.entity_type = 'identity')
          HAVING COUNT(*) = 1),
         (SELECT MIN(identity.id) FROM identities identity
           WHERE identity.user_id = member.user_id
             AND identity.organization_id IS NULL
             AND identity.id NOT IN (SELECT created.entity_id FROM audit_log created
                                      WHERE created.action = 'identity_created_from_profile'
                                        AND created.entity_type = 'identity')
          HAVING COUNT(*) = 1),
         (SELECT MIN(identity.id) FROM identities identity
           WHERE identity.user_id = member.user_id
             AND identity.organization_id IS NULL
             AND identity.started_at IS NOT NULL
             AND identity.ended_at IS NULL
             AND identity.blocked_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM identities held
                              WHERE held.user_id = member.user_id
                                AND held.organization_id IS NULL
                                AND held.id NOT IN (SELECT created.entity_id FROM audit_log created
                                                     WHERE created.action = 'identity_created_from_profile'
                                                       AND created.entity_type = 'identity'))
          HAVING COUNT(*) = 1)
       ) END AS identity_id
  FROM members member;

-- Everything that names members.user_id goes before the table does. A
-- personal identity no longer requires a membership, so the identity
-- membership-scope trigger is not recreated (the identity section may have
-- dropped it already).
DROP VIEW identity_member_capacities;
DROP TRIGGER IF EXISTS trg_identities_member_scope_insert;
DROP TABLE members;

CREATE TABLE members (
  id              TEXT NOT NULL PRIMARY KEY,
  member_type     TEXT NOT NULL CHECK (member_type IN ('individual', 'organization')),
  identity_id     TEXT REFERENCES identities(id),
  organization_id TEXT REFERENCES organizations(id),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending', 'lapsed')),
  tier            TEXT,
  data_json       TEXT,
  member_since    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(identity_id),
  UNIQUE(organization_id),
  CONSTRAINT members_holder CHECK (
    (member_type = 'individual' AND identity_id IS NOT NULL AND organization_id IS NULL) OR
    (member_type = 'organization' AND organization_id IS NOT NULL AND identity_id IS NULL)
  )
);

INSERT INTO members (id, member_type, identity_id, organization_id, status, tier, data_json, member_since,
                     created_at, updated_at)
SELECT id, member_type, identity_id, organization_id, status, tier, data_json, member_since, created_at, updated_at
  FROM members_identity_rebuild;
DROP TABLE members_identity_rebuild;

CREATE INDEX idx_members_type_status ON members(member_type, status);
CREATE INDEX idx_members_active_organization_notifications
  ON members(organization_id, id)
  WHERE status = 'active' AND organization_id IS NOT NULL;

CREATE TRIGGER protect_membership_context_delete
BEFORE DELETE ON members
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM user_roles WHERE context_type = 'organization' AND context_id = OLD.id)
   OR EXISTS (SELECT 1 FROM permission_grants WHERE context_type = 'organization' AND context_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'MEMBERSHIP_HAS_AUTHORIZATION_CONTEXT');
END;

-- An individual membership is held by a personal identity, and stays with it.
CREATE TRIGGER trg_members_identity_insert
BEFORE INSERT ON members
WHEN NEW.identity_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM identities identity WHERE identity.id = NEW.identity_id AND identity.organization_id IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'MEMBER_IDENTITY_INVALID');
END;

CREATE TRIGGER trg_members_identity_update
BEFORE UPDATE OF identity_id, organization_id, member_type ON members
WHEN NEW.identity_id IS NOT OLD.identity_id
  OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.member_type IS NOT OLD.member_type
BEGIN
  SELECT RAISE(ABORT, 'MEMBER_HOLDER_IMMUTABLE');
END;

-- An identity resolves to the membership it holds: an organization identity
-- through its organization, a personal identity through members.identity_id.
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
    JOIN members member ON member.identity_id = identity.id
    JOIN member_category_assignments category ON category.member_id = member.id
   WHERE identity.organization_id IS NULL;

-- These five audit actions originate only in this migration. Their temporary
-- payloads have finished serving the identity backfill; the normalized
-- identity/review owns personal facts, so audit keeps references and reasons.
UPDATE audit_log SET details_json = json_remove(details_json,
  '$.profileOrganizationName', '$.organizationName', '$.jobTitle', '$.domain', '$.verifiedEmailDomain', '$.emailDomain')
WHERE actor_type = 'system' AND action IN (
  'identity_created_from_profile', 'identity_job_title_backfilled',
  'individual_job_title_retained', 'proposal_speaker_affiliation_override_removed', 'affiliation_review_opened')
  AND json_valid(details_json);

-- ── Person profile addresses ────────────────────────────────────────────────
-- Each person with a public contribution has one long-lived public profile
-- address, /people/<slug>/. A speaker's is minted from the name they approved
-- for publication when an agenda revision is approved; anybody else's from
-- their account name, by the scheduled issuance for a public group seat,
-- leadership term or election candidacy. A stored slug never follows later
-- profile edits; only an appearance approved under a different name moves the
-- person to a new address, and every earlier address of that person stays
-- reserved for them and redirects to the current one. Slugs are never reused
-- by another person. Erasing the account removes its addresses.
CREATE TABLE person_profile_slugs (
 slug TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 retired_at TEXT
);
CREATE UNIQUE INDEX person_profile_slugs_current ON person_profile_slugs(user_id) WHERE retired_at IS NULL;
CREATE INDEX person_profile_slugs_user ON person_profile_slugs(user_id,created_at);
INSERT INTO scheduled_jobs(job_key,interval_seconds,next_run_at)
VALUES('person_profile_addresses',300,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ── Session page addresses ──────────────────────────────────────────────────
-- Each session with its own public page has a readable address,
-- /events/<event>/sessions/<slug>/, issued from its approved title when an
-- agenda revision is approved. One row per issued slug: an approved title
-- change retires the current row and issues (or restores) another, and every
-- retired slug and the session's ID address redirect to the current one. A
-- slug is unique within its event and never given to another session, so the
-- rows outlive a deleted occurrence and occurrence_id carries no foreign key.
CREATE TABLE session_page_slugs (
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 slug TEXT NOT NULL,
 occurrence_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 retired_at TEXT,
 PRIMARY KEY(event_id,slug)
);
CREATE UNIQUE INDEX session_page_slugs_current ON session_page_slugs(occurrence_id) WHERE retired_at IS NULL;
CREATE INDEX session_page_slugs_occurrence ON session_page_slugs(occurrence_id,created_at);

-- ── Location live streams ───────────────────────────────────────────────────
-- The live stream organizers configure for an agenda location: one usual
-- stream per location (day_date NULL) and optional replacements for single
-- event days (day_date is a YYYY-MM-DD calendar date in the event's zone).
-- Operational rather than part of an agenda revision, so a replaced broadcast
-- applies at once without a new publication. provider names the player
-- ('youtube' today; the shared contract owns that vocabulary) and stream_ref
-- is that provider's own reference. The virtual room releases a reference
-- only to registered attendees and event staff; no public projection reads it.
CREATE TABLE event_agenda_room_streams (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 room_id TEXT NOT NULL REFERENCES event_agenda_rooms(id) ON DELETE CASCADE,
 day_date TEXT,
 provider TEXT NOT NULL,
 stream_ref TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX event_agenda_room_streams_usual ON event_agenda_room_streams(room_id) WHERE day_date IS NULL;
CREATE UNIQUE INDEX event_agenda_room_streams_day ON event_agenda_room_streams(room_id,day_date) WHERE day_date IS NOT NULL;
CREATE INDEX event_agenda_room_streams_event ON event_agenda_room_streams(event_id,room_id);

-- ── Live session rooms ──────────────────────────────────────────────────────
-- Each live session room is a SQLite-backed Durable Object that holds the
-- room's questions, polls, votes, reaction counts and stage while the session
-- runs, and erases that storage days after the session ends.
-- These tables are its durable copy for reporting: the room upserts every
-- changed question, poll and its reaction totals here, together with its staff
-- actions' audit rows, in one D1 batch shortly after each change. The copy is
-- idempotent, so the room's alarm can retry it. Status is the shared policy
-- vocabulary (assets/shared/live-session-policy.ts), not a CHECK, so the
-- moderation lifecycle can evolve. occurrence_id carries no foreign key: the
-- record of what an audience asked outlives a later agenda edit that removes
-- the occurrence.
CREATE TABLE event_session_questions (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL,
 author_user_id TEXT NOT NULL REFERENCES users(id),
 anonymous INTEGER NOT NULL CHECK(anonymous IN (0,1)),
 body TEXT NOT NULL,
 status TEXT NOT NULL,
 vote_count INTEGER NOT NULL CHECK(vote_count>=0),
 asked_at TEXT NOT NULL,
 answered_at TEXT,
 moderated_by TEXT REFERENCES users(id),
 moderated_at TEXT,
 -- An operator's rewrite of the shown text; body keeps the author's own words.
 display_text TEXT,
 rewritten_by TEXT REFERENCES users(id),
 rewritten_at TEXT,
 -- Set when the author was anonymized: body is emptied and display_text cleared.
 redacted_at TEXT,
 copied_at TEXT NOT NULL
);
CREATE INDEX event_session_questions_occurrence ON event_session_questions(event_id,occurrence_id,asked_at,id);
CREATE INDEX event_session_questions_author ON event_session_questions(author_user_id,asked_at);
-- Reactions are counted, never stored per click.
CREATE TABLE event_session_reaction_totals (
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL,
 reaction TEXT NOT NULL,
 total INTEGER NOT NULL CHECK(total>=0),
 copied_at TEXT NOT NULL,
 PRIMARY KEY(event_id,occurrence_id,reaction)
);
-- A poll reaches the copy once it opens; drafts stay in the room. A poll's
-- question is a form field, stored as the shared form-field contract's JSON so
-- reporting reads it with the forms results views. Only counts are copied:
-- how many answered and how often each answer value was chosen. Who answered
-- what lives in the room while the poll is open and is erased when it closes.
-- Status is the shared policy vocabulary.
CREATE TABLE event_session_polls (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL,
 field_json TEXT NOT NULL CHECK(json_valid(field_json)),
 show_results INTEGER NOT NULL CHECK(show_results IN (0,1)),
 status TEXT NOT NULL,
 respondents INTEGER NOT NULL CHECK(respondents>=0),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 opened_by TEXT REFERENCES users(id),
 opened_at TEXT,
 closed_by TEXT REFERENCES users(id),
 closed_at TEXT,
 copied_at TEXT NOT NULL
);
CREATE INDEX event_session_polls_occurrence ON event_session_polls(event_id,occurrence_id,created_at,id);
-- One row per answer value chosen: a choice's stored value or a rating's score.
CREATE TABLE event_session_poll_tallies (
 poll_id TEXT NOT NULL REFERENCES event_session_polls(id) ON DELETE CASCADE,
 value TEXT NOT NULL,
 vote_count INTEGER NOT NULL CHECK(vote_count>=0),
 PRIMARY KEY(poll_id,value)
);
-- Anonymizing a person asks every room holding their questions to forget
-- them; the live_session_erasures job delivers each request to its room and
-- retries until the room confirms.
CREATE TABLE event_session_room_erasures (
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 occurrence_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 requested_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_error TEXT,
 completed_at TEXT,
 PRIMARY KEY(event_id,occurrence_id,user_id)
);
CREATE INDEX event_session_room_erasures_due ON event_session_room_erasures(attempts,requested_at,event_id,occurrence_id,user_id) WHERE completed_at IS NULL;
INSERT INTO scheduled_jobs(job_key,interval_seconds,next_run_at)
VALUES('live_session_erasures',60,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
-- Broadcast overlay layouts. An output holds what is on air; a layout picks
-- which of its elements show and where, and each browser source names
-- one. The built-in layouts are shared reference data
-- (assets/shared/live-overlay-layout-presets.ts) and need no row; a row is a
-- layout the organizers saved: a changed built-in one under the preset's
-- slug, or one of their own. A slug is fixed once saved because source links
-- carry it. The element boxes are one validated JSON document: they are
-- drawn, never filtered or joined.
CREATE TABLE event_live_overlay_layouts (
 event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 slug TEXT NOT NULL CHECK(length(slug) BETWEEN 1 AND 40),
 name TEXT NOT NULL,
 preset TEXT,
 elements_json TEXT NOT NULL CHECK(json_valid(elements_json)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 updated_by_user_id TEXT REFERENCES users(id),
 PRIMARY KEY(event_id,slug)
);
-- The event's shared element positions. Each element of a layout either
-- shares the event's position for it (its `shared` flag in elements_json),
-- so moving it once moves it on every layout that shares it, or keeps the
-- layout's own box. One row per event once organizers move a shared
-- position; until then the built-in positions (Full frame's boxes) apply.
CREATE TABLE event_live_overlay_positions (
 event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 elements_json TEXT NOT NULL CHECK(json_valid(elements_json)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 updated_by_user_id TEXT REFERENCES users(id)
);
-- The retired event-wide setting placed each graphic at its standard size,
-- scaled by a percentage and aligned to a side of the frame, for every
-- layout at once. It becomes the event's shared positions: each element
-- keeps the built-in box's size scaled by its percentage, at the same side
-- inside the title-safe margins it used. Elements the setting did not know
-- keep their built-in boxes. Retiring a key no client may send keeps each
-- event's revision.
WITH base(element, x, y, w, h, horizontal, vertical) AS (VALUES
  ('lowerThird', 0.025, 0.7185, 0.65, 0.1926, 'left', 'bottom'),
  ('question', 0.025, 0.237, 0.4375, 0.5259, 'left', 'middle'),
  ('poll', 0.5375, 0.237, 0.4375, 0.5259, 'right', 'middle'),
  ('timer', 0.8, 0.0444, 0.175, 0.1111, 'right', 'top'),
  ('ticker', 0, 0.9259, 1, 0.0741, 'center', 'bottom'),
  ('schedule', 0.1, 0.1, 0.8, 0.8, 'center', 'middle'),
  ('panelists', 0.05, 0.1, 0.9, 0.8, 'center', 'middle'),
  ('checkIn', 0.725, 0.2, 0.25, 0.6, 'right', 'middle'),
  ('reactions', 0.7771, 0.0444, 0.1979, 0.9111, 'right', 'middle'),
  ('stageDisplay', 0, 0, 1, 1, 'center', 'middle'),
  ('stageMessage', 0.05, 0.0222, 0.9, 0.1407, 'center', 'top')
), legacy AS (
  SELECT id AS event_id, json_extract(settings_json,'$.liveOverlayLayout') AS layout
    FROM events
   WHERE json_valid(settings_json) AND json_type(settings_json,'$.liveOverlayLayout') = 'object'
), sized AS (
  SELECT legacy.event_id, base.element,
         coalesce(json_extract(legacy.layout,'$.' || base.element || '.horizontal'), base.horizontal) AS horizontal,
         coalesce(json_extract(legacy.layout,'$.' || base.element || '.vertical'), base.vertical) AS vertical,
         base.x AS base_x, base.y AS base_y,
         round(base.w * min(100, max(25, coalesce(json_extract(legacy.layout,'$.' || base.element || '.scalePercent'), 100))) / 100.0, 4) AS w,
         round(base.h * min(100, max(25, coalesce(json_extract(legacy.layout,'$.' || base.element || '.scalePercent'), 100))) / 100.0, 4) AS h,
         json_type(legacy.layout,'$.' || base.element) IS NOT NULL AS known
    FROM legacy CROSS JOIN base
)
INSERT INTO event_live_overlay_positions(event_id,elements_json,created_at,updated_at)
SELECT event_id,
       json_group_object(element, json_object(
         'x', CASE WHEN NOT known THEN base_x
                   WHEN horizontal = 'left' THEN 0.025
                   WHEN horizontal = 'right' THEN round(0.975 - w, 4)
                   ELSE round((1 - w) / 2, 4) END,
         'y', CASE WHEN NOT known THEN base_y
                   WHEN vertical = 'top' THEN 0.0444
                   WHEN vertical = 'bottom' THEN round(0.9111 - h, 4)
                   ELSE round((1 - h) / 2, 4) END,
         'w', w, 'h', h, 'horizontal', horizontal, 'vertical', vertical)),
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM sized GROUP BY event_id;
UPDATE events SET settings_json = json_remove(settings_json,'$.liveOverlayLayout')
 WHERE json_valid(settings_json) AND json_type(settings_json,'$.liveOverlayLayout') IS NOT NULL;
-- Operating a room's control desk and moderating its questions is its own
-- capability, held by administrators and event organizers and grantable to
-- other staff per event.
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),candidate.role_id,'agenda:live_moderate',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT 'role-admin' AS role_id UNION ALL SELECT 'role-event_organizer') AS candidate
WHERE NOT EXISTS(SELECT 1 FROM role_permissions existing WHERE existing.role_id=candidate.role_id AND existing.permission='agenda:live_moderate');

-- Claiming a domain links everyone who already verified an address on it,
-- through the same rule a fresh verification uses. One run per claim walks
-- the people in user-id order, so a large domain is linked in bounded,
-- resumable chunks by the scheduler.
CREATE TABLE organization_domain_link_runs (
  id TEXT NOT NULL PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  domain TEXT NOT NULL,
  requested_by_user_id TEXT REFERENCES users(id),
  cursor_user_id TEXT,
  examined INTEGER NOT NULL DEFAULT 0 CHECK(examined >= 0),
  linked INTEGER NOT NULL DEFAULT 0 CHECK(linked >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX organization_domain_link_runs_open ON organization_domain_link_runs(created_at, id) WHERE completed_at IS NULL;
INSERT INTO scheduled_jobs(job_key,interval_seconds,next_run_at)
VALUES('organization_domain_linking',300,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- A person an address linked to an organization automatically is told once,
-- and may answer "not my organization", which ends that identity.
CREATE TABLE organization_link_notices (
  identity_id TEXT NOT NULL PRIMARY KEY REFERENCES identities(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  domain TEXT NOT NULL,
  created_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE INDEX organization_link_notices_open ON organization_link_notices(user_id, created_at) WHERE answered_at IS NULL;

-- ── Personal public profile ─────────────────────────────────────────────────
-- A person's public profile at /people/<slug>/ shows every identity they hold
-- or held (its organization, title, period, biography and links), ended ones
-- as past. Identities are not hidden in principle: only staff may withhold one
-- from the public profile, and every change is audited on the identity. An
-- identity never creates a page on its own; it shows on a page a public
-- contribution earned. Additive, with no backfill.
ALTER TABLE identities ADD COLUMN hidden_from_public_profile INTEGER NOT NULL DEFAULT 0
  CHECK (hidden_from_public_profile IN (0, 1));

-- ── Independent speaker disclosures ─────────────────────────────────────────
-- A speaker who takes part as an individual first completes the independence
-- disclosure (assets/shared/schemas/independent-capacity.ts): no current
-- employer, client or contract connected to the topic, relevant former
-- employers or clients, current position, personal accountability and the
-- IPR Agreement. Each completion is one immutable record of the wording
-- version and the answers, linked to the proposal speaker it qualifies; a
-- later completion or a switch to an organization supersedes it. Reviewers
-- verify the current record or request organizational representation; the
-- review columns change only through that audited use case. review_status and
-- email_domain_kind are shared-contract vocabularies, not CHECKs, so they can
-- evolve. Anonymizing the person clears the free-text answers.
CREATE TABLE proposal_speaker_independent_disclosures (
 id TEXT PRIMARY KEY,
 proposal_speaker_id TEXT NOT NULL REFERENCES proposal_speakers(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 text_version TEXT NOT NULL,
 answers_json TEXT NOT NULL CHECK(json_valid(answers_json)),
 email_domain_kind TEXT NOT NULL,
 attested_at TEXT NOT NULL,
 superseded_at TEXT,
 review_status TEXT NOT NULL,
 reviewed_by TEXT REFERENCES users(id),
 reviewed_at TEXT
);
CREATE UNIQUE INDEX proposal_speaker_independent_disclosures_current
  ON proposal_speaker_independent_disclosures(proposal_speaker_id) WHERE superseded_at IS NULL;
CREATE INDEX proposal_speaker_independent_disclosures_history
  ON proposal_speaker_independent_disclosures(proposal_speaker_id,attested_at,id);
CREATE INDEX proposal_speaker_independent_disclosures_user
  ON proposal_speaker_independent_disclosures(user_id);

-- Private notes for the program committee: read in proposal review, never published.
ALTER TABLE session_proposals ADD COLUMN committee_notes TEXT;

-- Someone applying on behalf of an organization names their job title: approval creates their organization identity,
-- which always has one. Individual applicants are not asked (the shared application projection hides the question).
UPDATE form_fields SET required=1
WHERE key='job_title' AND form_id=(SELECT id FROM forms WHERE key='membership-application');

-- Link session contents to the accepted proposal they came from, once. An accepted-proposal import names its proposal
-- in its source key. A legacy import does not, so it is linked when exactly one accepted proposal of the same event
-- has the same title, ignoring case and surrounding spaces; an ambiguous or unmatched title stays unlinked.
UPDATE event_agenda_contents SET proposal_id=SUBSTR(source_key,10)
WHERE proposal_id IS NULL AND source_key LIKE 'proposal:%'
  AND EXISTS(SELECT 1 FROM session_proposals proposal WHERE proposal.id=SUBSTR(event_agenda_contents.source_key,10) AND proposal.event_id=event_agenda_contents.event_id);
UPDATE event_agenda_contents SET proposal_id=(
  SELECT proposal.id FROM session_proposals proposal
  WHERE proposal.event_id=event_agenda_contents.event_id AND proposal.status='accepted' AND proposal.deleted_at IS NULL
    AND LOWER(TRIM(proposal.title))=LOWER(TRIM(event_agenda_contents.title)))
WHERE proposal_id IS NULL AND source_key LIKE 'legacy:%'
  AND (SELECT COUNT(*) FROM session_proposals proposal
       WHERE proposal.event_id=event_agenda_contents.event_id AND proposal.status='accepted' AND proposal.deleted_at IS NULL
         AND LOWER(TRIM(proposal.title))=LOWER(TRIM(event_agenda_contents.title)))=1;

-- Bounded pre-normalization scan evidence; existing historical rows have no captured prefix.
ALTER TABLE event_scan_attempts ADD COLUMN scanned_value TEXT CHECK(scanned_value IS NULL OR length(scanned_value)<=64);
ALTER TABLE event_scan_attempts ADD COLUMN scanned_value_truncated INTEGER CHECK(scanned_value_truncated IS NULL OR scanned_value_truncated IN (0,1));

-- Pending non-proposer invitation claims keep the same roster row and proposal.
-- Signed mailbox proof, target-account session, invitation generation/secret,
-- duplicate checks and audit remain inside the application atomic command.
DROP TRIGGER trg_proposal_speaker_identity_immutable;
CREATE TRIGGER trg_proposal_speaker_identity_immutable
BEFORE UPDATE OF id, proposal_id, user_id ON proposal_speakers
FOR EACH ROW
WHEN OLD.id IS NOT NEW.id OR OLD.proposal_id IS NOT NEW.proposal_id
 OR (OLD.user_id IS NOT NEW.user_id AND (
   OLD.status NOT IN ('pending','invited') OR NEW.status IS NOT OLD.status
   OR OLD.role='proposer' OR NEW.role IS NOT OLD.role
   OR EXISTS(SELECT 1 FROM session_proposals WHERE id=OLD.proposal_id AND proposer_user_id=OLD.user_id)
   OR NEW.acting_identity_selected_at IS NULL
   OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL)
 ))
BEGIN
 SELECT RAISE(ABORT,'PROPOSAL_SPEAKER_IDENTITY_IMMUTABLE');
END;
CREATE TRIGGER trg_proposal_speaker_account_claim_source_revision
AFTER UPDATE OF user_id ON proposal_speakers
FOR EACH ROW WHEN OLD.user_id IS NOT NEW.user_id
BEGIN
 INSERT INTO event_participant_source_revisions(event_id,user_id,revision)
 SELECT event_id,OLD.user_id,1 FROM session_proposals WHERE id=NEW.proposal_id
 ON CONFLICT(event_id,user_id) DO UPDATE SET revision=event_participant_source_revisions.revision+1;
 INSERT INTO event_participant_source_revisions(event_id,user_id,revision)
 SELECT event_id,NEW.user_id,1 FROM session_proposals WHERE id=NEW.proposal_id
 ON CONFLICT(event_id,user_id) DO UPDATE SET revision=event_participant_source_revisions.revision+1;
 INSERT INTO proposal_speaker_roster_revisions(proposal_id,revision) VALUES(NEW.proposal_id,1)
 ON CONFLICT(proposal_id) DO UPDATE SET revision=proposal_speaker_roster_revisions.revision+1;
END;

-- Attendee self check-in. Check-in codes are derived from event days, rooms and
-- published sessions and signed with one per-event key; rotating the key
-- invalidates every printed or displayed code. Self check-ins and check-outs are
-- ordinary scan attempts and attendance observations, marked by their method.
CREATE TABLE event_attendance_point_keys (
 event_id TEXT PRIMARY KEY REFERENCES events(id),
 link_secret TEXT NOT NULL,
 generation INTEGER NOT NULL,
 issued_at TEXT NOT NULL,
 issued_by_user_id TEXT REFERENCES users(id)
);
-- Every self check-in is recorded with the scanner's standing at that moment
-- (in person, remote, not registered, no in-person place) and whether they
-- held a session booking. Vocabularies are enforced by the shared domain schemas.
ALTER TABLE event_scan_attempts ADD COLUMN capture_method TEXT NOT NULL DEFAULT 'staff';
ALTER TABLE event_scan_attempts ADD COLUMN attendance_point_kind TEXT;
ALTER TABLE event_scan_attempts ADD COLUMN attendee_standing TEXT;
ALTER TABLE event_scan_attempts ADD COLUMN session_booked INTEGER CHECK(session_booked IS NULL OR session_booked IN (0,1));
CREATE INDEX event_attendance_observations_venue_presence ON event_attendance_observations(event_id,capture_day_date,user_id,observed_at) WHERE occurrence_id IS NULL;
CREATE INDEX event_scan_attempts_self_check_ins ON event_scan_attempts(event_id,observed_at,id) WHERE capture_method='self';
CREATE INDEX event_scan_attempts_self_by_person ON event_scan_attempts(event_id,user_id,capture_day_date,request_hash,observed_at) WHERE capture_method='self';
CREATE INDEX event_attendance_observations_movement ON event_attendance_observations(event_id,user_id,observed_at) WHERE attendance_mode='physical';

-- An identity may be ended as of an earlier date. Seats and roles held through
-- it end then, but never before they began: a seat joined after the end date
-- closes the moment it opened instead of breaking left_at >= joined_at.
DROP TRIGGER trg_identities_end_capacities;
CREATE TRIGGER trg_identities_end_capacities
AFTER UPDATE OF ended_at, blocked_at ON identities
WHEN (OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL)
  OR (OLD.blocked_at IS NULL AND NEW.blocked_at IS NOT NULL)
BEGIN
  UPDATE group_memberships
  SET left_at = MAX(joined_at, COALESCE(NEW.ended_at, NEW.blocked_at)),
      updated_at = NEW.updated_at
  WHERE identity_id = NEW.id
    AND left_at IS NULL;

  UPDATE user_roles
  SET revoked_at = MAX(created_at, COALESCE(NEW.ended_at, NEW.blocked_at))
  WHERE identity_id = NEW.id
    AND revoked_at IS NULL;
END;

-- Standing policy is consortium configuration; changing the window never rewrites the ledger.
-- The activation instant prevents activity recorded before rollout from being backfilled.
CREATE TABLE standing_settings (
  id TEXT NOT NULL PRIMARY KEY CHECK (id = 'default'),
  window_months INTEGER NOT NULL CHECK (window_months > 0),
  activity_started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO standing_settings (id,window_months,activity_started_at,updated_at)
VALUES ('default',24,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO scheduled_jobs (job_key,interval_seconds,next_run_at)
VALUES ('standing_chair_terms',3600,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Automatic agenda awards retain a normalized link to their source occurrence.
-- Corrections are ledger entries, so neither agenda edits nor retries erase history.
CREATE TABLE standing_agenda_awards (
  award_id TEXT NOT NULL PRIMARY KEY REFERENCES user_standing_awards(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id)
);
CREATE INDEX standing_agenda_awards_occurrence ON standing_agenda_awards(occurrence_id, award_id);
CREATE INDEX events_standing_ended ON events(ends_at, id) WHERE ends_at IS NOT NULL;

INSERT INTO scheduled_jobs (job_key, interval_seconds, next_run_at)
VALUES ('standing_event_speakers', 3600, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Keep agreement authority separate from public logo display and historical support.
ALTER TABLE sponsorships ADD COLUMN ended_reason TEXT;
ALTER TABLE sponsorships ADD COLUMN logo_action_due_at TEXT;
CREATE INDEX sponsorships_logo_due ON sponsorships(logo_action_due_at, id)
  WHERE logo_action_due_at IS NOT NULL;
CREATE TABLE sponsorship_periods (
  id TEXT NOT NULL PRIMARY KEY,
  sponsorship_id TEXT NOT NULL REFERENCES sponsorships(id) ON DELETE CASCADE,
  tier TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  scheduled_end_at TEXT,
  ended_at TEXT,
  end_reason TEXT,
  recorded_at TEXT NOT NULL
);
CREATE UNIQUE INDEX sponsorship_periods_open ON sponsorship_periods(sponsorship_id)
  WHERE ended_at IS NULL;
CREATE INDEX sponsorship_periods_history ON sponsorship_periods(sponsorship_id, started_at, ended_at);

-- Existing rows supply their last known period, not invented earlier renewals or tiers.
-- A lapsed row without evidence of ever being active cannot acquire a courtesy logo.
INSERT INTO sponsorship_periods
  (id,sponsorship_id,tier,revision,started_at,scheduled_end_at,ended_at,end_reason,recorded_at)
SELECT 'import:'||sp.id,sp.id,sp.tier,sp.transition_revision,
  strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(
    (SELECT MAX(created_at) FROM sponsorship_events WHERE sponsorship_id=sp.id AND to_stage='active'
      AND (from_stage IS NULL OR from_stage<>'active')),sp.start_date)),
  strftime('%Y-%m-%dT%H:%M:%fZ',sp.renewal_date),
  CASE WHEN sp.pipeline_stage='active' THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',sp.updated_at) END,
  CASE WHEN EXISTS(SELECT 1 FROM payment_ledger_entries payment WHERE payment.purpose='sponsorship'
      AND payment.resource_type='sponsorship' AND payment.resource_id=sp.id AND payment.status='refunded') THEN 'refund'
    WHEN EXISTS(SELECT 1 FROM payment_ledger_entries payment WHERE payment.purpose='sponsorship'
      AND payment.resource_type='sponsorship' AND payment.resource_id=sp.id AND payment.status='disputed') THEN 'dispute'
    WHEN sp.pipeline_stage='lapsed' AND sp.renewal_date<=substr(sp.updated_at,1,10)
    THEN 'ordinary_expiry' WHEN sp.pipeline_stage<>'active' THEN 'termination' END,
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM sponsorships sp
WHERE sp.pipeline_stage IN ('active','lapsed')
  AND COALESCE((SELECT MAX(created_at) FROM sponsorship_events WHERE sponsorship_id=sp.id
    AND to_stage='active' AND (from_stage IS NULL OR from_stage<>'active')),sp.start_date) IS NOT NULL;

UPDATE sponsorships SET ended_reason=CASE
  WHEN EXISTS(SELECT 1 FROM payment_ledger_entries payment WHERE payment.purpose='sponsorship'
    AND payment.resource_type='sponsorship' AND payment.resource_id=sponsorships.id AND payment.status='refunded') THEN 'refund'
  WHEN EXISTS(SELECT 1 FROM payment_ledger_entries payment WHERE payment.purpose='sponsorship'
    AND payment.resource_type='sponsorship' AND payment.resource_id=sponsorships.id AND payment.status='disputed') THEN 'dispute'
  ELSE (SELECT end_reason FROM sponsorship_periods WHERE sponsorship_id=sponsorships.id) END
WHERE pipeline_stage IN ('active','lapsed');
UPDATE sponsorships SET logo_action_due_at=(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',scheduled_end_at,'+90 days')
  FROM sponsorship_periods WHERE sponsorship_id=sponsorships.id AND end_reason='ordinary_expiry')
WHERE sponsor_type='consortium' AND pipeline_stage='lapsed'
  AND tier IN ('Silver','Gold','Platinum','Titanium','Diamond');

CREATE TABLE sponsor_event_archives (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ended_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY(event_id,ended_at)
);
INSERT INTO scheduled_jobs (job_key,interval_seconds,next_run_at)
VALUES ('sponsor_logo_publication',3600,strftime('%Y-%m-%dT%H:%M:%fZ','now'));


-- An OAuth grant is a frozen ceiling over live canonical permissions, never an authority source.
CREATE TABLE oauth_authorizations (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  identity_id TEXT REFERENCES identities(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX oauth_authorizations_user ON oauth_authorizations(user_id,created_at,id);
CREATE INDEX oauth_authorizations_client ON oauth_authorizations(user_id,client_id,status);
CREATE INDEX oauth_authorizations_expiry ON oauth_authorizations(status,expires_at,id);
CREATE TABLE oauth_authorization_permissions (
  id TEXT NOT NULL PRIMARY KEY,
  authorization_id TEXT NOT NULL REFERENCES oauth_authorizations(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  context_type TEXT,
  context_id TEXT
);
CREATE UNIQUE INDEX oauth_authorization_permissions_scope ON oauth_authorization_permissions
  (authorization_id,permission,COALESCE(context_type,''),COALESCE(context_id,''));
CREATE TABLE oauth_authorization_completions (
  authorization_id TEXT NOT NULL PRIMARY KEY REFERENCES oauth_authorizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  request_ciphertext TEXT,
  redirect_ciphertext TEXT,
  attempt_until TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  processing_token TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX oauth_authorization_completions_due ON oauth_authorization_completions(status,next_attempt_at,authorization_id);
INSERT INTO scheduled_jobs(job_key,interval_seconds,next_run_at)
VALUES('oauth_authorization_completions',3600,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Private organization contact details (#251).
-- Private organization channels survive the departure of individual representatives.
CREATE TABLE organization_contact_details (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  email TEXT,
  phone TEXT,
  postal_address_json TEXT,
  country_code TEXT,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL REFERENCES users(id)
);

-- Explicit added-address sign-in consent (#246); existing aliases are delivery-only until opted in.
-- Older sessions do not identify the proved address; reauthenticate instead of guessing consent.
UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE revoked_at IS NULL;

CREATE TABLE user_email_sign_in_permissions (
  email_id TEXT PRIMARY KEY REFERENCES user_emails(id) ON DELETE CASCADE,
  revision TEXT NOT NULL UNIQUE,
  enabled_at TEXT NOT NULL,
  revoked_at TEXT
);

-- Keep the authentication marker after mailbox deletion so it cannot become primary-account access.
CREATE TABLE session_email_authentication (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  email_id TEXT REFERENCES user_emails(id) ON DELETE SET NULL,
  permission_revision TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_session_email_authentication_email ON session_email_authentication(email_id);

CREATE TRIGGER revoke_sessions_on_email_sign_in_permission_change
AFTER UPDATE ON user_email_sign_in_permissions
WHEN NEW.revision IS NOT OLD.revision OR NEW.revoked_at IS NOT NULL
BEGIN
  UPDATE sessions SET revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   WHERE id IN (SELECT session_id FROM session_email_authentication WHERE email_id = OLD.email_id);
END;
CREATE TRIGGER revoke_sessions_on_email_sign_in_permission_delete
BEFORE DELETE ON user_email_sign_in_permissions
BEGIN
  UPDATE sessions SET revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   WHERE id IN (SELECT session_id FROM session_email_authentication WHERE email_id = OLD.email_id);
END;

CREATE TRIGGER revoke_sign_in_on_email_authority_change
AFTER UPDATE OF normalized_email, verified_at, identity_id, user_id ON user_emails
WHEN NEW.normalized_email IS NOT OLD.normalized_email OR NEW.user_id IS NOT OLD.user_id
  OR NEW.verified_at IS NULL
  OR (OLD.identity_id IS NOT NULL AND NEW.identity_id IS NOT OLD.identity_id)
  OR (NEW.identity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM identities identity WHERE identity.id = NEW.identity_id AND identity.user_id = NEW.user_id
      AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL))
BEGIN
  UPDATE user_email_sign_in_permissions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE email_id = NEW.id AND revoked_at IS NULL;
END;

CREATE TRIGGER revoke_sign_in_on_identity_authority_change
AFTER UPDATE OF started_at, ended_at, blocked_at, user_id ON identities
WHEN NEW.started_at IS NULL OR NEW.ended_at IS NOT NULL OR NEW.blocked_at IS NOT NULL OR NEW.user_id IS NOT OLD.user_id
BEGIN
  UPDATE user_email_sign_in_permissions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE email_id IN (SELECT id FROM user_emails WHERE identity_id = NEW.id) AND revoked_at IS NULL;
END;

CREATE TRIGGER revoke_sessions_before_sign_in_email_delete
BEFORE DELETE ON user_emails
BEGIN
  UPDATE sessions SET revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   WHERE id IN (SELECT session_id FROM session_email_authentication WHERE email_id = OLD.id);
END;

CREATE TRIGGER revoke_email_sign_in_on_user_lifecycle_change
AFTER UPDATE OF active, pii_redacted_at, merged_into_user_id ON users
WHEN NEW.active = 0 OR NEW.pii_redacted_at IS NOT NULL OR NEW.merged_into_user_id IS NOT NULL
BEGIN
  UPDATE user_email_sign_in_permissions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE email_id IN (SELECT id FROM user_emails WHERE user_id = NEW.id) AND revoked_at IS NULL;
END;
