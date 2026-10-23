import type { DatabaseLike } from "../../types";

interface ApplicationWorkingGroupRow {
  category_code: string;
  group_id: string;
}

/** Resolve bounded category selections together; the same policy serves a single applicant or the public catalog. */
export function prepareApplicationWorkingGroups(db: DatabaseLike, categories: { sql: string; bindings: unknown[] }) {
  return {
    statement: db
      .prepare(`SELECT category.code AS category_code,g.id AS group_id
      FROM (${categories.sql}) category
      JOIN groups g ON g.active = 1 AND g.type_key = 'working_group'
       AND (g.eligibility_mode = 'open' OR (g.eligibility_mode = 'category' AND EXISTS (
         SELECT 1 FROM group_membership_category_rules rule
          WHERE rule.group_id = g.id AND rule.membership_category_code = category.code AND rule.permits_join = 1
       ))) ORDER BY category.code,g.id`)
      .bind(...categories.bindings),
    decode(rows: ApplicationWorkingGroupRow[]) {
      const groups = new Map<string, string[]>();
      for (const row of rows) {
        const ids = groups.get(row.category_code) ?? [];
        ids.push(row.group_id);
        groups.set(row.category_code, ids);
      }
      return groups;
    },
  };
}

/** Public choices are the active working groups this category can request at application time. */
export async function eligibleApplicationWorkingGroupIds(db: DatabaseLike, categoryCode: string): Promise<string[]> {
  const read = prepareApplicationWorkingGroups(db, { sql: "SELECT ? AS code", bindings: [categoryCode] });
  return read.decode((await read.statement.all<ApplicationWorkingGroupRow>()).results ?? []).get(categoryCode) ?? [];
}
