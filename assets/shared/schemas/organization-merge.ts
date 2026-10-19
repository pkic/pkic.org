/**
 * Merging a duplicate organization (the source) into the one that stays (the
 * organization in the path). The source keeps its record, marked as merged,
 * so its history and its public address still lead somewhere; everything
 * live moves: active identities continue at the target, domain claims
 * become the target's additional domains, and sponsorships follow.
 */
import { z } from "zod";
import { jsonErrorResponse } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { organizationManagementParamsSchema } from "./organization-management";

export const organizationMergeCreateSchema = z.object({
  sourceOrganizationId: databaseIdSchema,
  /**
   * Both organizations hold a membership. Only the target's survives: the
   * source's membership ends with the merge, so staff confirm it explicitly.
   */
  endSourceMembership: z.boolean().default(false),
});
export type OrganizationMergeCreate = z.infer<typeof organizationMergeCreateSchema>;

/** The merge request as one value: the target from the path, the source from the body. */
export const organizationMergeRequestSchema = z.intersection(
  organizationManagementParamsSchema,
  organizationMergeCreateSchema,
);

export const organizationMergeResultSchema = z.object({
  organizationId: databaseIdSchema,
  sourceOrganizationId: databaseIdSchema,
  /** Active identities that continue at the target. */
  identitiesMoved: z.number().int().nonnegative(),
  /** Active identities ended because the person already represents the target. */
  identitiesEnded: z.number().int().nonnegative(),
  /** Pending invitations to the source, cancelled. */
  invitationsCancelled: z.number().int().nonnegative(),
  domainsMoved: z.array(z.string()),
  sponsorshipsMoved: z.number().int().nonnegative(),
  sourceMembershipEnded: z.boolean(),
});
export type OrganizationMergeResult = z.infer<typeof organizationMergeResultSchema>;
export const organizationMergeResponseSchema = z.object({ merge: organizationMergeResultSchema });

export const organizationMergeCreateRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true, scopes: ["organizations:write", "membership:write"] },
  summary: "Merge another organization into this one",
  description:
    "Moves the source organization's active identities (as successors), domain claims and sponsorships to this organization and marks the source as merged into it. Refused when the source holds the only membership (merge the other way), when both hold memberships and endSourceMembership is not set, or when the source has a pending profile review.",
  request: {
    params: organizationManagementParamsSchema,
    body: { required: true, content: { "application/json": { schema: organizationMergeCreateSchema } } },
  },
  responses: {
    "201": {
      description: "Organizations merged.",
      content: { "application/json": { schema: organizationMergeResponseSchema } },
    },
    "403": jsonErrorResponse("organizations:write and membership:write permissions required."),
    "404": jsonErrorResponse("Organization not found."),
    "409": jsonErrorResponse("The merge is unsafe as requested, or either organization changed or was merged."),
  },
};
