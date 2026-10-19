/** Live seats through which an organization appears on a public group's Member list. */
export const PUBLIC_GROUP_MEMBER_SEAT_SOURCE_SQL = `FROM group_memberships membership
  JOIN groups g ON g.id=membership.group_id AND g.active=1
  JOIN users seated ON seated.id=membership.user_id AND seated.active=1
  JOIN identities identity ON identity.id=membership.identity_id
    AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
  WHERE membership.left_at IS NULL`;
