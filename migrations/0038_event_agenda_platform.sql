-- One additive migration for agenda, participation and scoped phone scanning.
-- Organization affiliations exist independently of organization membership.
DROP TRIGGER trg_identities_member_scope_insert;
CREATE TRIGGER trg_identities_member_scope_insert
BEFORE INSERT ON identities
WHEN NEW.organization_id IS NULL AND NOT EXISTS (
  SELECT 1
    FROM members member
    JOIN member_category_assignments category ON category.member_id = member.id
    JOIN membership_categories catalog ON catalog.code = category.category_code AND catalog.is_individual = 1
   WHERE member.user_id = NEW.user_id AND member.member_type = 'individual'
)
BEGIN
  SELECT RAISE(ABORT, 'IDENTITY_MEMBER_SCOPE_INVALID');
END;
DROP TRIGGER trg_identities_reject_individual_conflict_insert;
DROP TRIGGER trg_identities_reject_individual_conflict_update;
DROP TRIGGER trg_members_reject_organization_identity_insert;
DROP TRIGGER trg_members_reject_organization_identity_update;
ALTER TABLE proposal_speakers ADD COLUMN acting_identity_id TEXT REFERENCES identities(id);
ALTER TABLE proposal_speakers ADD COLUMN acting_identity_selected_at TEXT;
ALTER TABLE proposal_speakers ADD COLUMN acting_identity_snapshot_json TEXT;
CREATE INDEX proposal_speakers_acting_identity ON proposal_speakers(acting_identity_id) WHERE acting_identity_id IS NOT NULL;
CREATE TRIGGER proposal_speaker_identity_binding_insert BEFORE INSERT ON proposal_speakers
WHEN (NEW.acting_identity_selected_at IS NULL AND (NEW.acting_identity_id IS NOT NULL OR NEW.acting_identity_snapshot_json IS NOT NULL))
  OR (NEW.acting_identity_selected_at IS NOT NULL AND (NEW.acting_identity_snapshot_json IS NULL OR NOT json_valid(NEW.acting_identity_snapshot_json)))
  OR (NEW.acting_identity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM identities WHERE id=NEW.acting_identity_id AND user_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'PROPOSAL_SPEAKER_IDENTITY_BINDING_INVALID'); END;
CREATE TRIGGER proposal_speaker_identity_binding_update BEFORE UPDATE OF user_id,acting_identity_id,acting_identity_selected_at,acting_identity_snapshot_json ON proposal_speakers
WHEN (NEW.acting_identity_selected_at IS NULL AND (NEW.acting_identity_id IS NOT NULL OR NEW.acting_identity_snapshot_json IS NOT NULL))
  OR (NEW.acting_identity_selected_at IS NOT NULL AND (NEW.acting_identity_snapshot_json IS NULL OR NOT json_valid(NEW.acting_identity_snapshot_json)))
  OR (NEW.acting_identity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM identities WHERE id=NEW.acting_identity_id AND user_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'PROPOSAL_SPEAKER_IDENTITY_BINDING_INVALID'); END;
CREATE TABLE event_agenda_state (event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 0, travel_minutes INTEGER NOT NULL DEFAULT 0 CHECK(travel_minutes >= 0), published_revision INTEGER, updated_at TEXT NOT NULL);
CREATE TABLE event_agenda_rooms (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, name TEXT NOT NULL, setup_minutes INTEGER NOT NULL DEFAULT 0 CHECK(setup_minutes >= 0), capacity INTEGER CHECK(capacity >= 0), UNIQUE(event_id,name));
CREATE TABLE event_agenda_occurrences (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', presentation_url TEXT,recording_url TEXT,start_at TEXT, end_at TEXT, room_id TEXT REFERENCES event_agenda_rooms(id), admission_policy TEXT NOT NULL DEFAULT 'preference', remote_capacity INTEGER CHECK(remote_capacity >= 0), capacity INTEGER CHECK(capacity >= 0), visibility TEXT NOT NULL DEFAULT 'public', kind TEXT NOT NULL DEFAULT 'session', track TEXT, source_key TEXT, CHECK((start_at IS NULL AND end_at IS NULL) OR (start_at IS NOT NULL AND end_at > start_at)), UNIQUE(event_id,source_key));
CREATE INDEX event_agenda_occurrences_schedule ON event_agenda_occurrences(event_id,start_at,id);
CREATE INDEX event_agenda_occurrences_track ON event_agenda_occurrences(event_id,track,id);
CREATE INDEX event_agenda_occurrences_room ON event_agenda_occurrences(event_id,room_id,start_at,end_at);
CREATE TABLE event_agenda_occurrence_speakers (occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(occurrence_id,user_id));
CREATE INDEX event_agenda_speaker_schedule ON event_agenda_occurrence_speakers(user_id,occurrence_id);
CREATE TABLE event_agenda_blocks (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,name TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,room_id TEXT REFERENCES event_agenda_rooms(id),track TEXT,roles_json TEXT NOT NULL,role_requirements_json TEXT NOT NULL DEFAULT '[]',CHECK(end_at > start_at));
CREATE TABLE event_agenda_role_members (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),roles_json TEXT NOT NULL,seniority TEXT NOT NULL DEFAULT 'junior',attendance_mode TEXT NOT NULL DEFAULT 'physical',available_from TEXT,available_until TEXT,max_minutes INTEGER CHECK(max_minutes > 0),PRIMARY KEY(event_id,user_id));
CREATE UNIQUE INDEX event_agenda_blocks_event_identity ON event_agenda_blocks(event_id,id);
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
  id TEXT NOT NULL,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,block_id TEXT NOT NULL,
  role_id TEXT NOT NULL,post_id TEXT,ideal_count INTEGER NOT NULL CHECK(ideal_count > 0),
  seniority TEXT NOT NULL,
  attendance_mode TEXT NOT NULL,
  PRIMARY KEY(event_id,id),UNIQUE(event_id,id,block_id,role_id),
  FOREIGN KEY(event_id,block_id) REFERENCES event_agenda_blocks(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,role_id) REFERENCES event_agenda_staffing_roles(event_id,id),
  FOREIGN KEY(event_id,post_id) REFERENCES event_agenda_staffing_posts(event_id,id)
);
CREATE UNIQUE INDEX event_agenda_staffing_requirement_scope ON event_agenda_staffing_requirements(event_id,block_id,role_id,COALESCE(post_id,''));
CREATE TABLE event_agenda_staffing_positions (
  id TEXT NOT NULL,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,requirement_id TEXT NOT NULL,
  position_index INTEGER NOT NULL CHECK(position_index > 0),
  PRIMARY KEY(event_id,id),UNIQUE(event_id,requirement_id,position_index),
  FOREIGN KEY(event_id,requirement_id) REFERENCES event_agenda_staffing_requirements(event_id,id) ON DELETE CASCADE
);
CREATE TABLE event_agenda_assignments (
  position_id TEXT NOT NULL,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,role TEXT NOT NULL,post_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id),pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN(0,1)),
  PRIMARY KEY(event_id,position_id),
  FOREIGN KEY(event_id,position_id) REFERENCES event_agenda_staffing_positions(event_id,id) ON DELETE CASCADE,
  FOREIGN KEY(event_id,block_id) REFERENCES event_agenda_blocks(event_id,id),
  FOREIGN KEY(event_id,role) REFERENCES event_agenda_staffing_roles(event_id,id),
  FOREIGN KEY(event_id,post_id) REFERENCES event_agenda_staffing_posts(event_id,id)
);
CREATE TRIGGER event_agenda_assignment_position_binding_insert BEFORE INSERT ON event_agenda_assignments
WHEN NOT EXISTS(SELECT 1 FROM event_agenda_staffing_positions position JOIN event_agenda_staffing_requirements requirement ON requirement.id=position.requirement_id AND requirement.event_id=position.event_id
  WHERE position.id=NEW.position_id AND position.event_id=NEW.event_id AND requirement.block_id=NEW.block_id AND requirement.role_id=NEW.role AND requirement.post_id IS NEW.post_id)
BEGIN SELECT RAISE(ABORT,'AGENDA_ASSIGNMENT_POSITION_MISMATCH'); END;
CREATE TRIGGER event_agenda_assignment_position_binding_update BEFORE UPDATE ON event_agenda_assignments
WHEN NOT EXISTS(SELECT 1 FROM event_agenda_staffing_positions position JOIN event_agenda_staffing_requirements requirement ON requirement.id=position.requirement_id AND requirement.event_id=position.event_id
  WHERE position.id=NEW.position_id AND position.event_id=NEW.event_id AND requirement.block_id=NEW.block_id AND requirement.role_id=NEW.role AND requirement.post_id IS NEW.post_id)
BEGIN SELECT RAISE(ABORT,'AGENDA_ASSIGNMENT_POSITION_MISMATCH'); END;
CREATE INDEX event_agenda_assignments_person ON event_agenda_assignments(user_id,block_id);
CREATE TABLE event_agenda_schedule_guards (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),valid INTEGER NOT NULL,CONSTRAINT agenda_schedule_valid CHECK(valid=1));
CREATE TABLE event_agenda_publications (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,UNIQUE(event_id,revision));
CREATE TABLE agenda_session_participations (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),attendance_mode TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(occurrence_id,user_id));
CREATE INDEX agenda_participation_capacity ON agenda_session_participations(occurrence_id,status,attendance_mode);
CREATE TABLE event_badge_credentials (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),user_id TEXT NOT NULL REFERENCES users(id),credential_hash TEXT NOT NULL UNIQUE,revoked_at TEXT,created_at TEXT NOT NULL);
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

INSERT INTO email_template_versions(id,template_key,version,subject_template,body,content_type,checksum_sha256,status,created_at)
VALUES('template-agenda-changed-v1','agenda_changed',1,'Your schedule has changed — {{eventName}}','The organizers have approved changes to **{{eventName}}** that affect a session in your personal agenda. Open the event portal to review your updated schedule before attending. Your existing registration remains in place.','markdown','','active',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO email_template_versions(id,template_key,version,subject_template,body,content_type,checksum_sha256,status,created_at,message_type)
SELECT 'template-event-proposal-verify-v1','event_proposal_verify',1,'Verify your email for {{eventName}}','Use this short-lived link to verify your email address and continue your proposal for {{eventName}}.

{{verificationUrl}}

If you did not request this link, you can ignore this email.','text','','active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'transactional'
WHERE NOT EXISTS(SELECT 1 FROM email_template_versions WHERE template_key='event_proposal_verify');

INSERT INTO email_template_versions(id,template_key,version,subject_template,body,content_type,checksum_sha256,status,created_at)
SELECT 'template-proposal-representation-review-v1','proposal_representation_review',1,'Review your speaker representation — {{eventName}}','Hello {{firstName}},

Your proposal **{{proposalTitle}}** has been received for **{{eventName}}**.

Choose and save the identity you will speak as, or choose individual presentation. Your representation must be reviewed before the session can be approved for the agenda.

[Review my speaker representation]({{speakerManageUrl}})

This private link manages only your own speaker profile.','markdown','','active',strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS(SELECT 1 FROM email_template_versions WHERE template_key='proposal_representation_review');

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
-- Add to the single agenda migration; archive metadata belongs to the mutable draft.
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

-- Fold into the agenda platform migration; no standalone migration or remote application.
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
INSERT INTO email_template_versions(id,template_key,version,subject_template,body,content_type,checksum_sha256,status,created_at)
VALUES('template-agenda-session-reminder-v1','agenda_session_reminder',1,'Starting soon: {{sessionTitle}}','Your reserved session **{{sessionTitle}}** at **{{eventName}}** starts at {{sessionStart}}. Location: {{sessionLocation}}. Open your event agenda for the latest information.','markdown','','active',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
ALTER TABLE agenda_session_participations ADD COLUMN attendance_day_date TEXT;
INSERT INTO scheduled_jobs(job_key,interval_seconds,next_run_at) VALUES('agenda_participation',60,strftime('%Y-%m-%dT%H:%M:%fZ','now')),('agenda_reminders',60,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
ALTER TABLE event_agenda_occurrences ADD COLUMN access_policy TEXT NOT NULL DEFAULT 'open' CHECK(access_policy IN ('open','invitation'));
ALTER TABLE event_agenda_occurrences ADD COLUMN booking_opens_at TEXT;
ALTER TABLE event_agenda_occurrences ADD COLUMN booking_closes_at TEXT;
CREATE TABLE agenda_session_delegations(occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,revoked_at TEXT,PRIMARY KEY(occurrence_id,user_id));
CREATE TABLE agenda_session_invitation_audit(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,reason_code TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE agenda_session_invitations(id TEXT NOT NULL UNIQUE,event_id TEXT NOT NULL REFERENCES events(id),occurrence_id TEXT NOT NULL REFERENCES event_agenda_occurrences(id),user_id TEXT NOT NULL REFERENCES users(id),invited_by TEXT NOT NULL REFERENCES users(id),reason_code TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT,accepted_at TEXT,reply_context_json TEXT,reply_mode TEXT,reply_revision INTEGER NOT NULL DEFAULT 0,reply_sequence INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(occurrence_id,user_id));
INSERT INTO email_template_versions(id,template_key,version,subject_template,body,content_type,checksum_sha256,status,created_at)
VALUES('template-agenda-session-invitation-v1','agenda_session_invitation',1,'Session invitation: {{sessionTitle}}','You are invited to **{{sessionTitle}}** at **{{eventName}}**. Review the invitation in your event portal. An invitation does not register you for the event or reserve a seat.','markdown','','active',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
ALTER TABLE agenda_session_participations ADD COLUMN saved INTEGER NOT NULL DEFAULT 0 CHECK(saved IN (0,1));
ALTER TABLE agenda_session_participations ADD COLUMN allocation_revision INTEGER NOT NULL DEFAULT 0;
INSERT INTO email_template_versions(id,template_key,version,subject_template,body,content_type,checksum_sha256,status,created_at)
VALUES('template-agenda-session-booking-v1','agenda_session_booking',1,'Session registration updated: {{sessionTitle}}','Your registration for **{{sessionTitle}}** at **{{eventName}}** has changed to **{{participationStatus}}** ({{attendanceMode}}). Review your event portal for the current schedule and admission requirements. A preference or waitlist entry does not guarantee a seat.','markdown','','active',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

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
ALTER TABLE agenda_session_participations ADD COLUMN room_id TEXT REFERENCES event_agenda_rooms(id);
ALTER TABLE agenda_session_holds ADD COLUMN room_id TEXT REFERENCES event_agenda_rooms(id);
ALTER TABLE event_session_admissions ADD COLUMN room_id TEXT REFERENCES event_agenda_rooms(id);
ALTER TABLE event_offline_admission_grants ADD COLUMN room_id TEXT REFERENCES event_agenda_rooms(id);
ALTER TABLE event_scan_attempts ADD COLUMN room_id TEXT REFERENCES event_agenda_rooms(id);
ALTER TABLE event_attendance_observations ADD COLUMN room_id TEXT REFERENCES event_agenda_rooms(id);
ALTER TABLE agenda_session_invitations ADD COLUMN room_id TEXT REFERENCES event_agenda_rooms(id);
CREATE INDEX agenda_session_participations_room_capacity ON agenda_session_participations(occurrence_id,room_id,status,attendance_mode);
CREATE INDEX event_session_admissions_room_capacity ON event_session_admissions(occurrence_id,room_id);
CREATE INDEX event_offline_admission_grants_room_capacity ON event_offline_admission_grants(occurrence_id,room_id,closed_at);

-- Canonical session content and event placements.
CREATE TABLE event_agenda_contents(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'session',track TEXT,speaker_user_ids_json TEXT NOT NULL DEFAULT '[]',source_key TEXT,source_snapshot_json TEXT,source_review_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(event_id,source_key));
CREATE INDEX event_agenda_contents_event ON event_agenda_contents(event_id,title,id);
CREATE INDEX event_agenda_contents_track ON event_agenda_contents(event_id,track,id);
ALTER TABLE event_agenda_occurrences ADD COLUMN content_id TEXT REFERENCES event_agenda_contents(id);
CREATE INDEX event_agenda_occurrences_content ON event_agenda_occurrences(content_id,event_id);
CREATE TRIGGER event_agenda_occurrence_content_scope_insert BEFORE INSERT ON event_agenda_occurrences WHEN NEW.content_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM event_agenda_contents content WHERE content.id=NEW.content_id AND content.event_id=NEW.event_id) BEGIN SELECT RAISE(ABORT,'agenda_content_event_mismatch'); END;
CREATE TRIGGER event_agenda_occurrence_content_scope_update BEFORE UPDATE OF content_id,event_id ON event_agenda_occurrences WHEN NEW.content_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM event_agenda_contents content WHERE content.id=NEW.content_id AND content.event_id=NEW.event_id) BEGIN SELECT RAISE(ABORT,'agenda_content_event_mismatch'); END;
ALTER TABLE event_agenda_contents ADD COLUMN speaker_roles_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE event_agenda_occurrence_speakers ADD COLUMN role TEXT NOT NULL DEFAULT 'speaker';

ALTER TABLE event_agenda_blocks ADD COLUMN compatible_roles_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE event_agenda_blocks ADD COLUMN boundaries_json TEXT NOT NULL DEFAULT '{}';
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

-- Root merge instruction: the UNRELEASED base event_attendance_observations
-- attempt_id must be nullable; camera observations retain their unique attempt FK.
-- Imported evidence has its own provenance rather than fabricated scan attempts.
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
 PRIMARY KEY(build_id,event_id,occurrence_id,material_id),
 FOREIGN KEY(event_id,occurrence_id,version_id) REFERENCES session_presentation_versions(event_id,occurrence_id,id),
 FOREIGN KEY(event_id,occurrence_id) REFERENCES event_agenda_occurrences(event_id,id)
);
CREATE INDEX site_publication_document_lookup ON site_publication_document_manifests(build_id,occurrence_id,version_id,digest);
CREATE TRIGGER site_publication_document_manifest_immutable BEFORE UPDATE ON site_publication_document_manifests
BEGIN SELECT RAISE(ABORT,'PUBLICATION_DOCUMENT_MANIFEST_IMMUTABLE'); END;
CREATE TRIGGER site_publication_document_manifest_conflict BEFORE INSERT ON site_publication_document_manifests
WHEN EXISTS(SELECT 1 FROM site_publication_document_manifests old WHERE old.build_id=NEW.build_id AND old.event_id=NEW.event_id AND old.occurrence_id=NEW.occurrence_id AND old.material_id=NEW.material_id AND (old.snapshot_id<>NEW.snapshot_id OR old.version_id<>NEW.version_id OR old.digest<>NEW.digest OR old.object_etag<>NEW.object_etag OR old.grant_id IS NOT NEW.grant_id OR old.legacy_download_json IS NOT NEW.legacy_download_json))
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
