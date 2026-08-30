/** Cross-group self-participation feed: open form placements the current user may submit. */
import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { groupIdSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema, paginationQuerySchemaWithDefaults } from "./pagination";

export const memberFormPlacementSchema = z.object({
  placementId: databaseIdSchema,
  formId: databaseIdSchema,
  title: z.string(),
  purpose: z.string(),
  ownerGroupId: groupIdSchema,
  ownerGroupName: z.string(),
  opensAt: utcInstantSchema.nullable(),
  closesAt: utcInstantSchema.nullable(),
  acceptingResponses: z.boolean(),
  hasSubmitted: z.boolean(),
});
export type MemberFormPlacement = z.infer<typeof memberFormPlacementSchema>;

export const currentUserFormsListQuerySchema = paginationQuerySchemaWithDefaults();
export type CurrentUserFormsListQuery = z.infer<typeof currentUserFormsListQuerySchema>;

export const currentUserFormsListResponseSchema = paginatedResponseSchema("forms", memberFormPlacementSchema);
export type CurrentUserFormsListResponse = z.infer<typeof currentUserFormsListResponseSchema>;
