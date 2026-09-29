/**
 * Bounded self-service feed of the organizations the current user actively
 * represents — powers the avatar-menu organization switcher and dashboard at
 * /portal/#/organizations/:organizationId. Distinct from
 * `organization-self-service.ts` (one organization's own detail once
 * selected) and `organization-management.ts` (the staff-facing roster).
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const userOrganizationSchema = z.object({
  organizationId: databaseIdSchema,
  memberId: databaseIdSchema,
  name: z.string(),
  // Nullable like organization-management.ts's list projection: category is
  // assigned once per organization aggregate via the same LEFT JOIN, so an
  // organization mid-provisioning (no category yet) must still round-trip.
  membershipCategory: z.string().nullable(),
  isOrgContact: z.boolean(),
  isPrimaryContact: z.boolean(),
  hasPendingReview: z.boolean(),
});
export type UserOrganization = z.infer<typeof userOrganizationSchema>;

export const USER_ORGANIZATIONS_SORT_COLUMNS = ["name"] as const;
export const userOrganizationsListQuerySchema = listQuerySchema(USER_ORGANIZATIONS_SORT_COLUMNS);
export type UserOrganizationsListQuery = z.infer<typeof userOrganizationsListQuerySchema>;

export const userOrganizationsListResponseSchema = paginatedResponseSchema("organizations", userOrganizationSchema);
