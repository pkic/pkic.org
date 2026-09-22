import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";

/** Public choices are the active working groups this category can request at application time. */
export async function eligibleApplicationWorkingGroupIds(db: DatabaseLike, categoryCode: string): Promise<string[]> {
  const rows = await all<{ id: string }>(
    db,
    `SELECT g.id FROM groups g
     WHERE g.active = 1 AND g.type_key = 'working_group'
       AND (g.eligibility_mode = 'open' OR (g.eligibility_mode = 'category' AND EXISTS (
         SELECT 1 FROM group_membership_category_rules rule
          WHERE rule.group_id = g.id AND rule.membership_category_code = ? AND rule.permits_join = 1
       ))) ORDER BY g.id`,
    [categoryCode],
  );
  return rows.map((row) => row.id);
}
