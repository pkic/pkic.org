import { ACTIVE_USER_CAPACITY_DEFINITIONS, ALL_ACTIVE_USER_CAPACITY_DEFINITIONS } from "../membership/capacity-query";

export interface AutomaticEnrollmentScope {
  type: "user" | "group";
  id: string;
}
function capacityInput(scope: AutomaticEnrollmentScope) {
  const definitions = scope.type === "user" ? ACTIVE_USER_CAPACITY_DEFINITIONS : ALL_ACTIVE_USER_CAPACITY_DEFINITIONS;
  return { sql: `WITH ${definitions}`, definitions, bindings: scope.type === "user" ? [scope.id] : [] };
}

/**
 * The exact seats reconciliation will end, shared with its committing public preimage.
 * One capacity join keeps the publication statement that embeds this source within D1's nesting limit.
 */
export function automaticEnrollmentRemovalSelection(scope: AutomaticEnrollmentScope) {
  const input = capacityInput(scope);
  const sourceSql = `FROM group_memberships membership
      JOIN groups g ON g.id=membership.group_id
      LEFT JOIN active_user_capacities capacity
        ON capacity.user_id=membership.user_id AND capacity.member_id=membership.member_id
      LEFT JOIN group_membership_category_rules rule ON rule.group_id=g.id
        AND rule.membership_category_code=capacity.membership_category AND rule.permits_join=1
      LEFT JOIN group_automatic_enrollment_opt_outs opt_out ON g.allow_automatic_opt_out=1
        AND opt_out.group_id=g.id AND opt_out.user_id=membership.user_id
      WHERE membership.${scope.type === "user" ? "user_id" : "group_id"}=? AND membership.left_at IS NULL
      GROUP BY membership.id
      HAVING COUNT(capacity.member_id)=0
        OR opt_out.user_id IS NOT NULL
        OR (g.eligibility_mode='category' AND COUNT(rule.group_id)=0)
        OR (membership.source='automatic_policy' AND NOT (g.active=1 AND g.automatic_enrollment_mode='category'
          AND COALESCE(MAX(rule.automatic_enrollment),0)=1))`;
  return {
    sql: `${input.sql} SELECT membership.id ${sourceSql}`,
    sourceSql,
    definitions: input.definitions,
    bindings: [...input.bindings, scope.id],
  };
}

/** Existing open capacities are excluded using the same key as INSERT OR IGNORE. */
export function automaticEnrollmentAdditionSelection(scope: AutomaticEnrollmentScope) {
  const input = capacityInput(scope);
  return {
    sql: `${input.sql} SELECT g.id AS group_id,capacity.user_id,capacity.identity_id,capacity.member_id
      FROM active_user_capacities capacity
      JOIN group_membership_category_rules rule ON rule.membership_category_code=capacity.membership_category
        AND rule.permits_join=1 AND rule.automatic_enrollment=1
      JOIN groups g ON g.id=rule.group_id AND g.active=1 AND g.parent_group_id IS NULL AND g.automatic_enrollment_mode='category'
      LEFT JOIN group_automatic_enrollment_opt_outs opt_out ON opt_out.group_id=g.id AND opt_out.user_id=capacity.user_id
      WHERE ${scope.type === "user" ? "capacity.user_id" : "g.id"}=? AND (g.allow_automatic_opt_out=0 OR opt_out.user_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM group_memberships existing WHERE existing.group_id=g.id
          AND existing.user_id=capacity.user_id AND existing.member_id=capacity.member_id AND existing.left_at IS NULL)
      ORDER BY g.id,capacity.user_id,capacity.member_id`,
    bindings: [...input.bindings, scope.id],
  };
}
