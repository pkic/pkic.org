/**
 * Canonical SQL projection of the Member capacities a user may act through.
 * An active organization representation suppresses individual capacity so
 * participation always has unambiguous IPR attribution.
 */
const ACTIVE_USER_CAPACITIES_BODY = `
  SELECT input.user_id, member.id AS member_id, member.member_type,
         NULL AS organization_name, category.category_code AS membership_category
    FROM input
    JOIN members member ON member.user_id = input.user_id
     AND member.member_type = 'individual' AND member.status = 'active'
    JOIN member_category_assignments category ON category.member_id = member.id
   WHERE NOT EXISTS (
     SELECT 1 FROM organization_representatives represented
      WHERE represented.user_id = input.user_id
        AND represented.left_at IS NULL AND represented.blocked_at IS NULL
   )
  UNION ALL
  SELECT input.user_id, member.id, member.member_type, organization.name,
         category.category_code
    FROM input
    JOIN organization_representatives represented
      ON represented.user_id = input.user_id
     AND represented.left_at IS NULL AND represented.blocked_at IS NULL
    JOIN members member ON member.id = represented.member_id AND member.status = 'active'
    JOIN organizations organization ON organization.id = member.organization_id
    JOIN member_category_assignments category ON category.member_id = member.id`;

export function activeUserCapacitiesCte(inputSql = "VALUES (?)"): string {
  return `WITH input(user_id) AS (${inputSql}),
    active_user_capacities(
      user_id, member_id, member_type, organization_name, membership_category
    ) AS (${ACTIVE_USER_CAPACITIES_BODY}
    )`;
}

export const ACTIVE_USER_CAPACITIES_CTE = activeUserCapacitiesCte();
export const ALL_ACTIVE_USER_CAPACITIES_CTE = activeUserCapacitiesCte("SELECT id FROM users WHERE active = 1");

/**
 * Canonical correlated predicate for group self-service eligibility. The
 * aliases are trusted source constants, never request input.
 */
export function eligibleGroupCapacityPredicate(groupAlias: string, ruleAlias: string, allowManagedSql = "0"): string {
  return `(
    ${groupAlias}.eligibility_mode = 'open'
    OR (${groupAlias}.eligibility_mode = 'category' AND ${ruleAlias}.permits_join = 1)
    OR (${groupAlias}.eligibility_mode = 'managed' AND ${allowManagedSql} = 1)
  )`;
}

/** A child may be joined only while the same person participates in its parent. */
export function activeParentGroupMembershipPredicate(groupAlias: string, userBindingSql = "?"): string {
  return `(
    ${groupAlias}.parent_group_id IS NULL
    OR EXISTS (
      SELECT 1 FROM group_memberships parent_membership
      WHERE parent_membership.group_id = ${groupAlias}.parent_group_id
        AND parent_membership.user_id = ${userBindingSql}
        AND parent_membership.left_at IS NULL
    )
  )`;
}
