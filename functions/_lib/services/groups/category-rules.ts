import type { GroupCategoryRulesResponse } from "../../../../assets/shared/schemas/groups";
import { groupCategoryRulesResponseSchema } from "../../../../assets/shared/schemas/groups";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";

interface GroupCategoryRuleRow {
  membership_category_code: string;
  permits_join: number;
  automatic_enrollment: number;
}

/** Read category rules for a group that the route already resolved and authorized. */
export async function getGroupCategoryRules(
  db: DatabaseLike,
  group: { id: string; revision: number },
): Promise<GroupCategoryRulesResponse> {
  const rows = await all<GroupCategoryRuleRow>(
    db,
    `SELECT membership_category_code, permits_join, automatic_enrollment
       FROM group_membership_category_rules
      WHERE group_id = ?
      ORDER BY membership_category_code`,
    [group.id],
  );
  return groupCategoryRulesResponseSchema.parse({
    groupId: group.id,
    revision: group.revision,
    rules: rows.map((row) => ({
      membershipCategory: row.membership_category_code,
      permitsJoin: row.permits_join === 1,
      automaticEnrollment: row.automatic_enrollment === 1,
    })),
  });
}
