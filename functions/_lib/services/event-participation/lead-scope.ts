/** Exact sponsor scopes never inherit global or event administrative access. */
export function sponsorLeadPermissionSql(
  permission: "agenda:leads_view" | "agenda:leads_capture" | "agenda:leads_export",
  sponsorExpression = "?",
) {
  return `EXISTS(SELECT 1 FROM permission_grants g JOIN users operator ON operator.id=g.user_id
    WHERE g.user_id=? AND operator.active=1 AND g.permission='${permission}'
    AND g.context_type='event_sponsor' AND g.context_id=${sponsorExpression} AND g.revoked_at IS NULL
    AND (g.expires_at IS NULL OR g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
    OR EXISTS(SELECT 1 FROM user_roles role JOIN role_permissions rp ON rp.role_id=role.role_id
    JOIN users operator ON operator.id=role.user_id WHERE role.user_id=? AND operator.active=1
    AND role.member_id IS NULL AND rp.permission='${permission}'
    AND role.context_type='event_sponsor' AND role.context_id=${sponsorExpression} AND role.revoked_at IS NULL
    AND (role.expires_at IS NULL OR role.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`;
}
