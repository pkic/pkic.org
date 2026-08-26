/**
 * The managed membership category catalog (PR #1 review §1.5). The
 * canonical A-G/H1-H8 vocabulary and its individual/voting policy sets live
 * in assets/shared/schemas/membership-categories.ts (isomorphic — the same
 * source the frontend and API contracts use); this module owns the
 * category/aggregate-type compatibility policy built on top of it, plus a
 * read model for the `membership_categories` reference table (migration
 * 0035) for any caller that needs the DB-backed catalog directly rather
 * than the static list.
 */
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import {
  MEMBERSHIP_CATEGORIES,
  isIndividualMembershipCategory,
  membershipCategoryCatalogEntrySchema,
  type MembershipCategoryCatalogEntry,
} from "../../../../assets/shared/schemas/membership-categories";
import type { DatabaseLike } from "../../types";

/**
 * Category/aggregate-type compatibility, enforced once here rather than
 * left to whichever caller happens to remember to check it (PR #1 review:
 * individual-only categories were previously accepted for organization
 * aggregates and vice versa, with tests deliberately exercising the
 * invalid combinations). Uses the canonical shared vocabulary
 * (membership-categories.ts) rather than a DB round-trip — its parity with
 * the `membership_categories` reference table is itself covered by
 * tests/membership-aggregate.test.ts.
 */
export function assertCategoryCompatible(categoryCode: string, wantsIndividual: boolean): void {
  if (!(MEMBERSHIP_CATEGORIES as readonly string[]).includes(categoryCode)) {
    throw new AppError(422, "INVALID_MEMBERSHIP_CATEGORY", `Unknown membership category: ${categoryCode}`);
  }
  const isIndividual = isIndividualMembershipCategory(categoryCode);
  if (isIndividual !== wantsIndividual) {
    throw new AppError(
      422,
      "MEMBERSHIP_CATEGORY_TYPE_MISMATCH",
      wantsIndividual
        ? `Category ${categoryCode} is not an individual (org-less) membership category`
        : `Category ${categoryCode} is an individual (org-less) membership category and cannot be assigned to an organization`,
    );
  }
}

interface MembershipCategoryRow {
  code: string;
  label: string;
  description: string | null;
  display_order: number;
  is_individual: number;
  is_voting: number;
}

/** The DB-backed category reference table (consolidated migration 0035) — kept in parity with the shared TS vocabulary above by tests/membership-aggregate.test.ts. */
export async function listMembershipCategories(db: DatabaseLike): Promise<MembershipCategoryCatalogEntry[]> {
  const rows = await all<MembershipCategoryRow>(
    db,
    `SELECT code, label, description, display_order, is_individual, is_voting
       FROM membership_categories
      ORDER BY display_order, code`,
  );
  return rows.map((row) =>
    membershipCategoryCatalogEntrySchema.parse({
      code: row.code,
      label: row.label,
      description: row.description,
      displayOrder: row.display_order,
      isIndividual: row.is_individual === 1,
      isVoting: row.is_voting === 1,
    }),
  );
}
