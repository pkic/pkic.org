import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { successResponseSchema } from "./api-common";
import { ownEmailAddressesListQuerySchema, ownEmailAddressesListResponseSchema } from "./own-email-addresses";
import { authErrors, ok, requiresSession } from "./route-contract";

export const representationEmailChangeSchema = z
  .object({
    previousEmailId: databaseIdSchema.nullable(),
    emailId: databaseIdSchema.nullable(),
  })
  .strict();
const params = z.object({ userId: databaseIdSchema, identityId: databaseIdSchema });
export const representationEmailOptionsResponseSchema = ownEmailAddressesListResponseSchema.extend({
  emailId: databaseIdSchema.nullable(),
});
export const representationEmailOptionsRouteSchema = {
  ...requiresSession(),
  "x-pkic-mcp": { expose: true, scopes: ["users:read"], readonly: true },
  tags: ["Identities"],
  summary: "List verified email choices for a representation",
  description: "The account owner or staff with users:read can read the person's eligible verified addresses.",
  request: { params, query: ownEmailAddressesListQuerySchema },
  responses: {
    ...ok("Verified addresses and current selection.", representationEmailOptionsResponseSchema),
    ...authErrors({ conflict: "The representation or its authorization changed." }),
  },
};
export const representationEmailChangeRouteSchema = {
  ...requiresSession(),
  tags: ["Identities"],
  summary: "Change a representation's verified email address",
  "x-pkic-mcp": { expose: true, scopes: ["membership:write"], readonly: false },
  description:
    "The account owner or staff with membership:write changes the email selection without changing the organization, role, group seats, or account sign-in permissions.",
  request: {
    params,
    body: { required: true, content: { "application/json": { schema: representationEmailChangeSchema } } },
  },
  responses: {
    ...ok("Representation email changed.", successResponseSchema),
    ...authErrors({ conflict: "The address is unverified, unavailable, or the representation changed." }),
  },
};
