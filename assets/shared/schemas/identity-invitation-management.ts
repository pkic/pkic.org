import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { immediateIdentityActivationSchema } from "./identity";
import { successResponseSchema } from "./api-common";
import { authErrors, ok, requiresSession } from "./route-contract";

export const identityInvitationManagementSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), userId: databaseIdSchema }).strict(),
  immediateIdentityActivationSchema
    .omit({ mode: true })
    .extend({
      action: z.literal("activate"),
      userId: databaseIdSchema,
    })
    .strict(),
]);
export const identityInvitationManagementRouteSchema = {
  ...requiresSession(),
  tags: ["Organizations"],
  summary: "Manage a pending representative invitation",
  description:
    "Organization contacts and authorized staff may cancel a pending invitation. Immediate activation requires membership:write and identities:activate with a reason. Cancellation deletes the unaccepted association without creating former experience.",
  request: {
    params: z.object({ organizationId: databaseIdSchema, identityId: databaseIdSchema }),
    body: { required: true, content: { "application/json": { schema: identityInvitationManagementSchema } } },
  },
  responses: {
    ...ok("Invitation changed.", successResponseSchema),
    ...authErrors({ conflict: "The invitation or authorization changed, or participation prevents removal." }),
  },
};
