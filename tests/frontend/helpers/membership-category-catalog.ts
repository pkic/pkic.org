import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  membershipCategoryCatalogEntrySchema,
} from "../../../assets/shared/schemas/membership-categories";

/** Synthetic catalog for organization and individual membership form tests. */
export const exampleMembershipCategories = MEMBERSHIP_CATEGORIES.map((code, displayOrder) =>
  membershipCategoryCatalogEntrySchema.parse({
    code,
    label: `Example ${code}`,
    isIndividual: INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(code),
    displayOrder,
    description: null,
    requiresUniversityEmail: code === "H5",
    isVoting: false,
    revision: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }),
);
