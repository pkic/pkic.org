import { all } from "../../db/queries";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";

export interface ProvisioningGroupSelection {
  membershipCategory: string;
  workingGroupSlugs: string[];
  /** Staff provisioning may enter managed groups; application approval may only honor self-service-eligible requests. */
  allowManagedGroupEnrollment?: boolean;
  /** Whether an ineligible requested group rejects provisioning or is omitted from the approved request. */
  ineligibleGroupPolicy?: "reject" | "omit";
}

export interface ProvisionedGroup {
  id: string;
  slug: string;
  name: string;
}

interface ProvisioningGroupRow extends ProvisionedGroup {
  eligibility_mode: "open" | "category" | "managed";
  permits_join: number | null;
}

export async function resolveProvisioningGroups(
  db: DatabaseLike,
  input: ProvisioningGroupSelection,
): Promise<ProvisionedGroup[]> {
  const slugs = [...new Set(input.workingGroupSlugs)];
  if (slugs.length === 0) return [];
  // An application names its groups the way the form's option catalog did —
  // by id — or, for older and hand-written answers, by slug (#105).
  const slugFilter = buildD1JsonMembershipFilter("g.slug", slugs);
  const idFilter = buildD1JsonMembershipFilter("g.id", slugs);
  const rows = await all<ProvisioningGroupRow>(
    db,
    `SELECT g.id, g.slug, g.name, g.eligibility_mode, rule.permits_join
       FROM groups g
  LEFT JOIN group_membership_category_rules rule
         ON rule.group_id = g.id AND rule.membership_category_code = ?
      WHERE g.type_key = 'working_group' AND g.active = 1 AND (${slugFilter.sql} OR ${idFilter.sql})`,
    [input.membershipCategory, ...slugFilter.bindings, ...idFilter.bindings],
  );
  const byKey = new Map(rows.flatMap((row) => [[row.slug, row] as const, [row.id, row] as const]));
  const seen = new Set<string>();
  const requested = slugs.flatMap((requestedKey) => {
    const row = byKey.get(requestedKey);
    if (!row || seen.has(row.id)) return [];
    seen.add(row.id);
    return [row];
  });
  const allowManaged = input.allowManagedGroupEnrollment ?? true;
  const eligible = requested.filter(
    (group) =>
      group.eligibility_mode === "open" ||
      (group.eligibility_mode === "category" && group.permits_join === 1) ||
      (group.eligibility_mode === "managed" && allowManaged),
  );
  if ((input.ineligibleGroupPolicy ?? "reject") === "reject" && eligible.length !== requested.length) {
    const ineligible = requested.find((group) => !eligible.includes(group));
    throw new AppError(
      403,
      "GROUP_CAPACITY_INELIGIBLE",
      ineligible ? `The membership category is not eligible for ${ineligible.name}` : "A requested group is ineligible",
    );
  }
  return eligible.map(({ id, slug, name }) => ({ id, slug, name }));
}
