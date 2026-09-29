import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { requiresSession } from "./route-contract";
import {
  registrationManageReadRouteSchema,
  registrationManageUpdateRouteSchema,
} from "./route-contracts-registrations";

const params = z.object({ registrationId: databaseIdSchema });

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
