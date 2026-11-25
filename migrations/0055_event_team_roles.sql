-- Event team roles each cover one job, so a person gets only the access that
-- job needs; people who do several jobs hold several roles on the event.
-- Role ids stay the same, so existing assignments keep working.

-- Studio operator: runs a room's studio. Split off from Volunteer.
INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at)
SELECT 'role-event_studio_operator', 'event_studio_operator', 'Runs the studio of a room at a specific event', 1,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE id = 'role-event_studio_operator');

INSERT INTO role_permissions (id, role_id, permission, created_at)
SELECT lower(hex(randomblob(16))), 'role-event_studio_operator', grant_row.permission, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT 'agenda:read' AS permission UNION ALL SELECT 'agenda:live_studio') AS grant_row
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions existing
  WHERE existing.role_id = 'role-event_studio_operator' AND existing.permission = grant_row.permission
);

-- Volunteer: check-in desk, printed badges and live moderation; no studio.
DELETE FROM role_permissions WHERE role_id = 'role-event_volunteer' AND permission = 'agenda:live_studio';

-- Check-in and live moderation belong to Volunteer and Moderator (and the
-- Organizer), not the reviewers.
DELETE FROM role_permissions
WHERE role_id = 'role-program_committee'
  AND permission IN ('agenda:check', 'agenda:admit', 'agenda:attendance_record', 'agenda:live_moderate');

-- Moderator: chat, questions and polls in the live room. Reviewing proposals
-- belongs to the Program Committee and check-in to Volunteer.
DELETE FROM role_permissions
WHERE role_id = 'role-event_moderator'
  AND permission IN ('proposals:read', 'proposals:score', 'agenda:check', 'agenda:admit', 'agenda:attendance_record');

INSERT INTO role_permissions (id, role_id, permission, created_at)
SELECT lower(hex(randomblob(16))), 'role-event_moderator', 'agenda:live_moderate', strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions existing
  WHERE existing.role_id = 'role-event_moderator' AND existing.permission = 'agenda:live_moderate'
);

UPDATE roles
SET description = CASE id
      WHEN 'role-event_organizer' THEN 'Manages everything at a specific event'
      WHEN 'role-program_committee' THEN 'Reviews proposals and builds the agenda of a specific event'
      WHEN 'role-event_moderator' THEN 'Moderates chat, questions and polls in the live rooms of a specific event'
      WHEN 'role-event_volunteer' THEN 'Checks people in, prints badges and moderates live rooms at a specific event'
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN ('role-event_organizer', 'role-program_committee', 'role-event_moderator', 'role-event_volunteer');
