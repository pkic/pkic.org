/** Active leadership for requested groups, one row per identity and Member capacity.
 * Bind a JSON array of group IDs before the surrounding query's bindings.
 */
export function seatLeadershipJoinSql(seat: "gm" | "membership", scope: "groups" | "user" = "groups"): string {
  const requested =
    scope === "groups"
      ? "json_each(?)"
      : "(SELECT DISTINCT group_id AS value FROM group_memberships WHERE user_id = ? AND left_at IS NULL)";
  return `LEFT JOIN (
    SELECT ur.context_id AS group_id, ur.user_id, ur.identity_id, ur.member_id,
           MIN(CASE ur.role_id WHEN 'role-group_lead' THEN 0 ELSE 1 END) AS role_rank,
           COALESCE(
             MIN(CASE ur.role_id WHEN 'role-group_lead' THEN COALESCE(ur.title, gt.lead_title) END),
             MIN(COALESCE(ur.title, gt.deputy_lead_title))
           ) AS title
      FROM user_roles ur
      JOIN groups g ON g.id = ur.context_id
      JOIN group_types gt ON gt.key = g.type_key
      JOIN ${requested} requested_leadership_group ON requested_leadership_group.value = ur.context_id
     WHERE ur.context_type = 'group'
       AND ur.role_id IN ('role-group_lead', 'role-group_deputy_lead')
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     GROUP BY ur.context_id, ur.user_id, ur.identity_id, ur.member_id, gt.lead_title, gt.deputy_lead_title
  ) leadership
    ON leadership.group_id = ${seat}.group_id
   AND leadership.user_id = ${seat}.user_id
   AND leadership.identity_id = ${seat}.identity_id
   AND leadership.member_id = ${seat}.member_id
   AND ${seat}.left_at IS NULL`;
}
