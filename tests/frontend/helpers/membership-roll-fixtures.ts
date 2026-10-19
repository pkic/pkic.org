import type { MembershipCategoryCatalogEntry } from "../../../assets/shared/schemas/membership-categories";

/** One catalog entry, differing only in what a suite is about: code, label and kind. */
export function catalogEntry(code: string, label: string, isIndividual: boolean): MembershipCategoryCatalogEntry {
  return {
    code,
    label,
    description: null,
    displayOrder: 0,
    isIndividual,
    requiresUniversityEmail: false,
    isVoting: false,
    active: true,
    workflowVersionId: null,
    revision: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
