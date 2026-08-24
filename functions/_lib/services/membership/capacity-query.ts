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
