/** Users whose names and portraits appear on active member pages, including organization rosters. */
export const PUBLIC_MEMBER_USER_SOURCE_SQL = `FROM users person
  JOIN identities identity ON identity.user_id=person.id
  JOIN members member ON (member.organization_id IS NULL AND member.identity_id=identity.id)
    OR (member.organization_id=identity.organization_id AND identity.show_on_organization_profile=1
      AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL)
  JOIN member_category_assignments assignment ON assignment.member_id=member.id
  JOIN membership_categories category ON category.code=assignment.category_code
  WHERE member.status='active'`;
