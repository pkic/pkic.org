/**
 * Membership category vocabulary — the single source of truth for the
 * fixed A-G/H1-H8 category-code vocabulary and structural individual/org-less
 * policy. Editable labels, descriptions, ordering, and voting rights live in
 * D1. Previously independently declared in membership provisioning,
 * membership applications (both the shared schema and the service), and
 * organization management derived its org-tied filter from
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

/**
 * A bounded, unique selection from the fixed category vocabulary. Reused by
 * every API that stores category filters so duplicate values cannot leak into
 * D1 JSON and create subtly different request/response contracts. It retains
 * caller order because that can be meaningful in a presentation context.
 */
export const membershipCategorySelectionSchema = z
  .array(membershipCategorySchema)
  .max(MEMBERSHIP_CATEGORIES.length)
  .refine((categories) => new Set(categories).size === categories.length, {
    message: "Membership categories must not contain duplicates",
  });

export const MEMBERSHIP_CATEGORY_LABEL_MAX_LENGTH = 300;
export const MEMBERSHIP_CATEGORY_DESCRIPTION_MAX_LENGTH = 2000;

const membershipCategoryLabelSchema = z.string().trim().min(1).max(MEMBERSHIP_CATEGORY_LABEL_MAX_LENGTH);
const membershipCategoryDescriptionSchema = z
  .string()
  .trim()
  .max(MEMBERSHIP_CATEGORY_DESCRIPTION_MAX_LENGTH)
  .nullable();

/** D1-backed presentation and policy metadata returned to every category UI. */
export const membershipCategoryCatalogEntrySchema = z.object({
  code: membershipCategorySchema,
  label: membershipCategoryLabelSchema,
  description: membershipCategoryDescriptionSchema,
  displayOrder: z.number().int().nonnegative(),
  isIndividual: z.boolean(),
  isVoting: z.boolean(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string(),
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

export const membershipCategoryParamsSchema = z.object({ categoryCode: membershipCategorySchema });
export const membershipCategoryMutableSchema = membershipCategoryCatalogEntrySchema.pick({
  label: true,
  description: true,
  displayOrder: true,
  isVoting: true,
});
export const membershipCategoryUpdateSchema = membershipCategoryMutableSchema
  .partial()
  .extend({ expectedRevision: z.number().int().nonnegative() })
  .refine(({ expectedRevision: _expectedRevision, ...changes }) => Object.keys(changes).length > 0, {
    message: "At least one membership-category field must be updated",
  });
export type MembershipCategoryUpdate = z.infer<typeof membershipCategoryUpdateSchema>;
export const membershipCategoryResponseSchema = z.object({ category: membershipCategoryCatalogEntrySchema });

export const membershipCategoryUpdateRouteSchema = {
  tags: ["Membership"],
  summary: "Update configurable membership-category metadata",
  request: {
    params: membershipCategoryParamsSchema,
    body: { content: { "application/json": { schema: membershipCategoryUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Updated membership category.",
      content: { "application/json": { schema: membershipCategoryResponseSchema } },
    },
    "409": { description: "The membership category changed before the update was committed." },
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

/** members.status (migration 0000, deployed/immutable CHECK constraint — mirrored here, not duplicated ad hoc, per PR #1 review §1.3). */
export const MEMBER_STATUSES = ["active", "inactive", "pending", "lapsed"] as const;
export const memberStatusSchema = z.enum(MEMBER_STATUSES);
