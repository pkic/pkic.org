/** Current working-group chair/vice-chair SQL shared by admin reads and scheduled jobs. */

import { SYSTEM_ROLE_IDS } from "../../../assets/shared/schemas/access-control";

export const WORKING_GROUP_CHAIR_ROLE_ID = SYSTEM_ROLE_IDS.workingGroupChair;
export const WORKING_GROUP_VICE_CHAIR_ROLE_ID = SYSTEM_ROLE_IDS.workingGroupViceChair;

export type WorkingGroupLeadershipRoleId = typeof WORKING_GROUP_CHAIR_ROLE_ID | typeof WORKING_GROUP_VICE_CHAIR_ROLE_ID;

const ACTIVE_WORKING_GROUP_LEADERSHIP_FILTER_SQL = `
  ur.revoked_at IS NULL
  AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
`;

function rankedWorkingGroupLeadershipSql(rolePredicate: string, partitionBy: string): string {
  return `
    SELECT ur.context_id AS working_group_id, ur.id AS user_role_id, ur.role_id,
           u.id AS user_id, u.first_name, u.last_name, u.email, ur.expires_at,
           ROW_NUMBER() OVER (
             PARTITION BY ${partitionBy}
             ORDER BY ur.created_at DESC, ur.id DESC
           ) AS role_rank
      FROM user_roles ur
      JOIN users u ON u.id = ur.user_id
     WHERE ur.context_type = 'working_group'
       AND ${rolePredicate}
       AND ${ACTIVE_WORKING_GROUP_LEADERSHIP_FILTER_SQL}
  `;
}

/** One current holder for a specific role in each working group. */
export function currentWorkingGroupRoleHolderSql(roleId: WorkingGroupLeadershipRoleId): string {
  return `
    SELECT working_group_id AS wg_id, user_role_id, user_id, first_name, last_name, email, expires_at
      FROM (${rankedWorkingGroupLeadershipSql(`ur.role_id = '${roleId}'`, "ur.context_id")})
     WHERE role_rank = 1
  `;
}

/**
 * CTEs containing the current holder of both leadership roles. Consumers may
 * group by `(working_group_id, user_id)` to deduplicate a dual-role holder.
 */
export const CURRENT_WORKING_GROUP_LEADERSHIP_CTES_SQL = `
  ranked_working_group_leadership AS (
    ${rankedWorkingGroupLeadershipSql(
      `ur.role_id IN ('${WORKING_GROUP_CHAIR_ROLE_ID}', '${WORKING_GROUP_VICE_CHAIR_ROLE_ID}')`,
      "ur.context_id, ur.role_id",
    )}
  ),
  current_working_group_leadership AS (
    SELECT working_group_id, user_role_id, role_id, user_id, first_name, last_name, email, expires_at
      FROM ranked_working_group_leadership
     WHERE role_rank = 1
  )
`;
