/**
 * Membership category vocabulary — the single source of truth for the
 * fixed A-G/H1-H8 category list and the policy sets derived from it
 * (individual/org-less, voting rights). Previously independently declared
 * in admin-members.ts, member-applications.ts (both the shared schema and
 * the service), and admin-organizations.ts derived its org-tied filter from
 * yet another copy — flagged in PR #1 review as a DRY violation across API
 * and service layers.
 */
import { z } from "zod";

export const MEMBERSHIP_CATEGORIES = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "H7",
  "H8",
] as const;
export const membershipCategorySchema = z.enum(MEMBERSHIP_CATEGORIES);
export type MembershipCategory = z.infer<typeof membershipCategorySchema>;

/** D1-backed presentation and policy metadata returned to every category UI. */
export const membershipCategoryCatalogEntrySchema = z.object({
  code: membershipCategorySchema,
  label: z.string().min(1),
  description: z.string().nullable(),
  displayOrder: z.number().int().nonnegative(),
  isIndividual: z.boolean(),
  isVoting: z.boolean(),
});
export type MembershipCategoryCatalogEntry = z.infer<typeof membershipCategoryCatalogEntrySchema>;

export const membershipCategoryCatalogResponseSchema = z.object({
  categories: z.array(membershipCategoryCatalogEntrySchema),
});

export const membershipCategoryCatalogRouteSchema = {
  tags: ["Membership"],
  summary: "List the configured membership-category catalog",
  responses: {
    "200": {
      description: "Membership categories in configured display order.",
      content: {
        "application/json": { schema: membershipCategoryCatalogResponseSchema },
      },
    },
  },
};

/** Individual (org-less) membership categories — "NULL for individual categories H5/H6/H7" rule. */
export const INDIVIDUAL_MEMBERSHIP_CATEGORIES = new Set<string>(["H5", "H6", "H7"]);

export function isIndividualMembershipCategory(category: string): boolean {
  return INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(category);
}

/** Individual academic category that must use an institutional address. */
export const UNIVERSITY_EMAIL_MEMBERSHIP_CATEGORIES = ["H5"] as const;
const UNIVERSITY_EMAIL_MEMBERSHIP_CATEGORY_SET = new Set<string>(UNIVERSITY_EMAIL_MEMBERSHIP_CATEGORIES);

export function requiresUniversityEmail(category: string): boolean {
  return UNIVERSITY_EMAIL_MEMBERSHIP_CATEGORY_SET.has(category);
}

/** Categories with voting rights (forum + WG) — H categories never vote. */
export const VOTING_CATEGORY_LETTERS = ["A", "B", "C", "D", "E", "F", "G"] as const;
export const VOTING_CATEGORIES = new Set<string>(VOTING_CATEGORY_LETTERS);

/** members.status (migration 0000, deployed/immutable CHECK constraint — mirrored here, not duplicated ad hoc, per PR #1 review §1.3). */
export const MEMBER_STATUSES = ["active", "inactive", "pending", "lapsed"] as const;
export const memberStatusSchema = z.enum(MEMBER_STATUSES);
