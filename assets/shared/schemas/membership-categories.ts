/** Shared contracts for the D1-managed membership category catalog. */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers.ts";

/** Baseline categories used by legacy membership imports and seed fixtures. */
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
export const membershipCategorySchema = z
  .string()
  .trim()
  .regex(
    /^[A-Z][A-Z0-9_-]{0,31}$/,
    "Use an uppercase category code of up to 32 letters, digits, underscores, or hyphens",
  );
export type MembershipCategory = z.infer<typeof membershipCategorySchema>;

/**
 * A bounded, unique selection from the configured category catalog. Reused by
 * every API that stores category filters so duplicate values cannot leak into
 * D1 JSON and create subtly different request/response contracts. It retains
 * caller order because that can be meaningful in a presentation context.
 */
export const MEMBERSHIP_CATEGORY_CATALOG_LIMIT = 200;

export const membershipCategorySelectionSchema = z
  .array(membershipCategorySchema)
  .max(MEMBERSHIP_CATEGORY_CATALOG_LIMIT)
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
  requiresUniversityEmail: z.boolean().default(false),
  isVoting: z.boolean(),
  active: z.boolean().default(true),
  workflowVersionId: databaseIdSchema.nullable().default(null),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type MembershipCategoryCatalogEntry = z.infer<typeof membershipCategoryCatalogEntrySchema>;

export const membershipCategoryCatalogResponseSchema = z.object({
  categories: z.array(membershipCategoryCatalogEntrySchema).max(MEMBERSHIP_CATEGORY_CATALOG_LIMIT),
});

export const membershipCategoryCatalogRouteSchema = {
  tags: ["Membership"],
  summary: "List the configured membership-category catalog",
  "x-pkic-auth": { required: true, scopes: ["membership:read"] },
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
export const membershipCategoryMutableSchema = membershipCategoryCatalogEntrySchema
  .pick({
    label: true,
    description: true,
    displayOrder: true,
    isVoting: true,
    active: true,
    workflowVersionId: true,
  })
  .extend({
    active: membershipCategoryCatalogEntrySchema.shape.active.unwrap(),
    workflowVersionId: membershipCategoryCatalogEntrySchema.shape.workflowVersionId.unwrap(),
  });
export const membershipCategoryUpdateSchema = membershipCategoryMutableSchema
  .partial()
  .extend({ expectedRevision: z.number().int().nonnegative() })
  .refine(({ expectedRevision: _expectedRevision, ...changes }) => Object.keys(changes).length > 0, {
    message: "At least one membership-category field must be updated",
  });
export type MembershipCategoryUpdate = z.infer<typeof membershipCategoryUpdateSchema>;
export const membershipCategoryResponseSchema = z.object({ category: membershipCategoryCatalogEntrySchema });

export const membershipCategoryCreateSchema = membershipCategoryCatalogEntrySchema
  .omit({ revision: true, updatedAt: true })
  .refine((category) => !category.requiresUniversityEmail || category.isIndividual, {
    path: ["requiresUniversityEmail"],
    message: "University email requirements apply to individual categories",
  });
export type MembershipCategoryCreate = z.infer<typeof membershipCategoryCreateSchema>;
export const membershipCategoryDeleteSchema = z.object({ expectedRevision: z.number().int().nonnegative() });
export const membershipCategoryDeleteResponseSchema = z.object({ deleted: z.literal(true) });

export const membershipCategoryUpdateRouteSchema = {
  tags: ["Membership"],
  summary: "Update configurable membership-category metadata",
  "x-pkic-auth": { required: true, scopes: ["membership:write"] },
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

/** Individual categories in legacy source records; live policy comes from the D1 catalog. */
export const INDIVIDUAL_MEMBERSHIP_CATEGORIES = new Set<string>(["H5", "H6", "H7"]);

export function isIndividualMembershipCategory(category: string): boolean {
  return INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(category);
}

/** members.status (migration 0000, deployed/immutable CHECK constraint — mirrored here, not duplicated ad hoc, per PR #1 review §1.3). */
export const MEMBER_STATUSES = ["active", "inactive", "pending", "lapsed"] as const;
export const memberStatusSchema = z.enum(MEMBER_STATUSES);
