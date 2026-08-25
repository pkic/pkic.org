/** Current local group leadership SQL shared by admin reads and scheduled jobs. */

import { SYSTEM_ROLE_IDS } from "../../../assets/shared/schemas/access-control";

export const GROUP_LEAD_ROLE_ID = SYSTEM_ROLE_IDS.groupLead;
export const GROUP_DEPUTY_LEAD_ROLE_ID = SYSTEM_ROLE_IDS.groupDeputyLead;

export type GroupLeadershipRoleId = typeof GROUP_LEAD_ROLE_ID | typeof GROUP_DEPUTY_LEAD_ROLE_ID;

const ACTIVE_GROUP_LEADERSHIP_FILTER_SQL = `
  ur.revoked_at IS NULL
  AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
`;

function rankedGroupLeadershipSql(rolePredicate: string, partitionBy: string): string {
  return `
    SELECT ur.context_id AS group_id, ur.id AS user_role_id, ur.role_id,
           u.id AS user_id, u.first_name, u.last_name, u.email, ur.expires_at,
           ROW_NUMBER() OVER (
             PARTITION BY ${partitionBy}
             ORDER BY ur.created_at DESC, ur.id DESC
           ) AS role_rank
      FROM user_roles ur
      JOIN users u ON u.id = ur.user_id
     WHERE ur.context_type = 'group'
       AND ${rolePredicate}
       AND ${ACTIVE_GROUP_LEADERSHIP_FILTER_SQL}
  `;
}

/** Most recently assigned current holder for one local role in each group. */
export function currentGroupRoleHolderSql(roleId: GroupLeadershipRoleId): string {
  return `
    SELECT group_id, user_role_id, user_id, first_name, last_name, email, expires_at
      FROM (${rankedGroupLeadershipSql(`ur.role_id = '${roleId}'`, "ur.context_id")})
     WHERE role_rank = 1
  `;
}

/** Current local holders of both leadership roles. */
export const CURRENT_GROUP_LEADERSHIP_CTES_SQL = `
  ranked_group_leadership AS (
    ${rankedGroupLeadershipSql(
      `ur.role_id IN ('${GROUP_LEAD_ROLE_ID}', '${GROUP_DEPUTY_LEAD_ROLE_ID}')`,
      "ur.context_id, ur.role_id",
    )}
  ),
  current_group_leadership AS (
    SELECT group_id, user_role_id, role_id, user_id, first_name, last_name, email, expires_at
      FROM ranked_group_leadership
     WHERE role_rank = 1
  )
`;
