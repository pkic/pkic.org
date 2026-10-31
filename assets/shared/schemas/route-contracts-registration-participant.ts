import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { requiresSession, ok, authErrors } from "./route-contract";
import { registrationIdentityChangeSchema, registrationIdentityChangeResponseSchema } from "./registration-identity";
import {
  registrationManageReadRouteSchema,
  registrationManageUpdateRouteSchema,
} from "./route-contracts-registrations";

const params = z.object({ registrationId: databaseIdSchema });

export const registrationIdentityChangeRouteSchema = {
  ...requiresSession(),
  tags: ["Registrations"],
  summary: "Change the representation on your registration",
  request: { params, body: { content: { "application/json": { schema: registrationIdentityChangeSchema } } } },
  responses: {
    ...ok("Registration representation updated", registrationIdentityChangeResponseSchema),
    ...authErrors({ badRequest: "Invalid identity selection", conflict: "Registration representation changed" }),
  },
};

export const registrationParticipantReadRouteSchema = {
  ...registrationManageReadRouteSchema,
  ...requiresSession(),
  summary: "Read a registration owned by the signed-in identity",
  request: { params },
};

export const registrationParticipantUpdateRouteSchema = {
  ...registrationManageUpdateRouteSchema,
  ...requiresSession(),
  summary: "Update a registration owned by the signed-in identity",
  request: { ...registrationManageUpdateRouteSchema.request, params },
};
