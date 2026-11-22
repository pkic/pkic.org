-- Every event-team access role carries the event-scoped scanner actions.
-- Existing role assignments keep their own event context and expiry.
INSERT INTO role_permissions (id, role_id, permission, created_at)
SELECT lower(hex(randomblob(16))), role.id, action.permission,
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM roles role
CROSS JOIN (
  SELECT 'agenda:check' AS permission
  UNION ALL SELECT 'agenda:admit'
  UNION ALL SELECT 'agenda:attendance_record'
) action
WHERE role.id IN (
  'role-event_organizer',
  'role-program_committee',
  'role-event_moderator',
  'role-event_volunteer'
)
AND NOT EXISTS (
  SELECT 1 FROM role_permissions existing
  WHERE existing.role_id = role.id AND existing.permission = action.permission
);
