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

/** Individual (org-less) membership categories — "NULL for individual categories H5/H6/H7" rule. */
export const INDIVIDUAL_MEMBERSHIP_CATEGORIES = new Set<string>(["H5", "H6", "H7"]);

export function isIndividualMembershipCategory(category: string): boolean {
  return INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(category);
}

/** Categories with voting rights (forum + WG) — H categories never vote. */
export const VOTING_CATEGORIES = new Set<string>(["A", "B", "C", "D", "E", "F", "G"]);

/** members.status (migration 0000, deployed/immutable CHECK constraint — mirrored here, not duplicated ad hoc, per PR #1 review §1.3). */
export const MEMBER_STATUSES = ["active", "inactive", "pending", "lapsed"] as const;
export const memberStatusSchema = z.enum(MEMBER_STATUSES);
