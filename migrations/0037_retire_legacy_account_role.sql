-- Retire the last legacy account-role authorization dependency before dropping
-- its storage. Preserve live assignment, grant, and inherited leadership checks.
DROP TRIGGER trg_event_resource_management_guard_validate;

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


ALTER TABLE users DROP COLUMN role;
