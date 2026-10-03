-- One additive migration for agenda, participation and scoped phone scanning.
CREATE TABLE event_agenda_state (event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 0, travel_minutes INTEGER NOT NULL DEFAULT 0 CHECK(travel_minutes >= 0), published_revision INTEGER, updated_at TEXT NOT NULL);
CREATE TABLE event_agenda_rooms (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, name TEXT NOT NULL, setup_minutes INTEGER NOT NULL DEFAULT 0 CHECK(setup_minutes >= 0), capacity INTEGER CHECK(capacity >= 0), UNIQUE(event_id,name));
CREATE TABLE event_agenda_occurrences (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', presentation_url TEXT,recording_url TEXT,start_at TEXT, end_at TEXT, room_id TEXT REFERENCES event_agenda_rooms(id), admission_policy TEXT NOT NULL DEFAULT 'preference', remote_capacity INTEGER CHECK(remote_capacity >= 0), capacity INTEGER CHECK(capacity >= 0), visibility TEXT NOT NULL DEFAULT 'public', kind TEXT NOT NULL DEFAULT 'session', source_key TEXT, CHECK((start_at IS NULL AND end_at IS NULL) OR (start_at IS NOT NULL AND end_at > start_at)), UNIQUE(event_id,source_key));
CREATE INDEX event_agenda_occurrences_schedule ON event_agenda_occurrences(event_id,start_at,id);
CREATE INDEX event_agenda_occurrences_room ON event_agenda_occurrences(event_id,room_id,start_at,end_at);
CREATE TABLE event_agenda_occurrence_speakers (occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(occurrence_id,user_id));
CREATE INDEX event_agenda_speaker_schedule ON event_agenda_occurrence_speakers(user_id,occurrence_id);
CREATE TABLE event_agenda_blocks (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,name TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,room_id TEXT REFERENCES event_agenda_rooms(id),roles_json TEXT NOT NULL,role_requirements_json TEXT NOT NULL DEFAULT '[]',CHECK(end_at > start_at));
CREATE TABLE event_agenda_role_members (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),roles_json TEXT NOT NULL,seniority TEXT NOT NULL DEFAULT 'junior',attendance_mode TEXT NOT NULL DEFAULT 'physical',available_from TEXT,available_until TEXT,max_minutes INTEGER CHECK(max_minutes > 0),PRIMARY KEY(event_id,user_id));
CREATE TABLE event_agenda_assignments (block_id TEXT NOT NULL REFERENCES event_agenda_blocks(id) ON DELETE CASCADE,role TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN(0,1)),PRIMARY KEY(block_id,role));
CREATE TABLE event_agenda_publications (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,UNIQUE(event_id,revision));
CREATE TABLE agenda_session_participations (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),attendance_mode TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(occurrence_id,user_id));
CREATE INDEX agenda_participation_capacity ON agenda_session_participations(occurrence_id,status,attendance_mode);
CREATE TABLE event_badge_credentials (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),user_id TEXT NOT NULL REFERENCES users(id),credential_hash TEXT NOT NULL UNIQUE,revoked_at TEXT,created_at TEXT NOT NULL);
CREATE INDEX event_badge_users ON event_badge_credentials(event_id,user_id);
CREATE INDEX event_badge_manifest ON event_badge_credentials(event_id,id);
CREATE TABLE event_scan_attempts (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT REFERENCES event_agenda_occurrences(id),badge_id TEXT REFERENCES event_badge_credentials(id),sponsor_id TEXT REFERENCES sponsorships(id),user_id TEXT REFERENCES users(id),operator_user_id TEXT NOT NULL REFERENCES users(id),device_id TEXT NOT NULL,operation_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,outcome TEXT NOT NULL,reason TEXT NOT NULL,exception_reason TEXT,action TEXT NOT NULL,observed_at TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX event_scan_attempts_target ON event_scan_attempts(event_id,occurrence_id,observed_at,id);
CREATE TABLE event_attendance_observations (id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL UNIQUE REFERENCES event_scan_attempts(id),event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),attendance_mode TEXT NOT NULL,observed_at TEXT NOT NULL);
CREATE INDEX event_attendance_target ON event_attendance_observations(event_id,occurrence_id,user_id);
CREATE TABLE event_sponsor_leads (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),sponsor_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),operator_user_id TEXT NOT NULL REFERENCES users(id),observed_at TEXT NOT NULL,UNIQUE(event_id,sponsor_id,user_id));
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))), 'role-admin', permission, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT 'agenda:scan' AS permission UNION ALL SELECT 'agenda:admit_exceptions' UNION ALL SELECT 'agenda:attendance_read' UNION ALL SELECT 'agenda:leads_capture' UNION ALL SELECT 'agenda:leads_export') AS candidate
WHERE NOT EXISTS(SELECT 1 FROM role_permissions existing WHERE existing.role_id='role-admin' AND existing.permission=candidate.permission);
CREATE TABLE event_session_admissions (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),operation_id TEXT NOT NULL UNIQUE,admitted_at TEXT NOT NULL,UNIQUE(occurrence_id,user_id));
CREATE INDEX event_session_admissions_capacity ON event_session_admissions(occurrence_id,user_id);

INSERT INTO email_template_versions(id,template_key,version,subject_template,body,content_type,checksum_sha256,status,created_at)
VALUES('template-agenda-changed-v1','agenda_changed',1,'Your schedule has changed — {{eventName}}','The organizers have approved changes to **{{eventName}}** that affect a session in your personal agenda. Open the event portal to review your updated schedule before attending. Your existing registration remains in place.','markdown','','active',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

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
