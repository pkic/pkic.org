import { membershipApplicationCategorySchema } from "../../../assets/shared/schemas/member-applications";
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
} from "../../../assets/shared/schemas/membership-categories";

/** Synthetic catalog for organization and individual membership form tests. */
export const exampleMembershipCategories = MEMBERSHIP_CATEGORIES.map((code, displayOrder) =>
  membershipApplicationCategorySchema.parse({
    code,
    label: `Example ${code}`,
    fee: null,
    isIndividual: INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(code),
    displayOrder,
    description: null,
    requiresUniversityEmail: code === "H5",
    isVoting: false,
    revision: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }),
);
