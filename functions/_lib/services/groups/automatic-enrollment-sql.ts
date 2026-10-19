import { ACTIVE_USER_CAPACITY_DEFINITIONS, ALL_ACTIVE_USER_CAPACITY_DEFINITIONS } from "../membership/capacity-query";

export interface AutomaticEnrollmentScope {
  type: "user" | "group";
  id: string;
}
function capacityInput(scope: AutomaticEnrollmentScope) {
  const definitions = scope.type === "user" ? ACTIVE_USER_CAPACITY_DEFINITIONS : ALL_ACTIVE_USER_CAPACITY_DEFINITIONS;
  return { sql: `WITH ${definitions}`, definitions, bindings: scope.type === "user" ? [scope.id] : [] };
}

/** The exact seats reconciliation will end, shared with its committing public preimage. */
export function automaticEnrollmentRemovalSelection(scope: AutomaticEnrollmentScope) {
  const input = capacityInput(scope);
  const selectionSql = `SELECT membership.id FROM group_memberships membership
      JOIN groups g ON g.id=membership.group_id
      WHERE membership.${scope.type === "user" ? "user_id" : "group_id"}=? AND membership.left_at IS NULL
        AND (NOT EXISTS (SELECT 1 FROM active_user_capacities capacity
              WHERE capacity.user_id=membership.user_id AND capacity.member_id=membership.member_id)
          OR (g.allow_automatic_opt_out=1 AND EXISTS (SELECT 1 FROM group_automatic_enrollment_opt_outs opt_out
              WHERE opt_out.group_id=g.id AND opt_out.user_id=membership.user_id))
          OR (g.eligibility_mode='category' AND NOT EXISTS (SELECT 1 FROM active_user_capacities capacity
              JOIN group_membership_category_rules rule ON rule.group_id=g.id
                AND rule.membership_category_code=capacity.membership_category AND rule.permits_join=1
              WHERE capacity.user_id=membership.user_id AND capacity.member_id=membership.member_id))
          OR (membership.source='automatic_policy' AND NOT EXISTS (SELECT 1 FROM active_user_capacities capacity
              JOIN group_membership_category_rules rule ON rule.group_id=g.id
                AND rule.membership_category_code=capacity.membership_category AND rule.permits_join=1 AND rule.automatic_enrollment=1
              WHERE capacity.user_id=membership.user_id AND capacity.member_id=membership.member_id
                AND g.active=1 AND g.automatic_enrollment_mode='category')))`;
  return {
    sql: `${input.sql} ${selectionSql}`,
    selectionSql,
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
