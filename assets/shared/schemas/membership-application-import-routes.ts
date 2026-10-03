import { z } from "zod";
import { requiresPermissions } from "./route-contract";
import { databaseIdSchema } from "./identifiers";
import {
  membershipApplicationImportRequestSchema,
  membershipApplicationImportResponseSchema,
  membershipApplicationActivationRequestSchema,
  membershipApplicationActivationResponseSchema,
} from "./membership-application-import";

export const membershipApplicationImportRouteSchema = {
  ...requiresPermissions("membership:approve"),
  tags: ["Membership"],
  summary: "Import one reconciled membership application from GitHub",
  request: {
    body: { content: { "application/json": { schema: membershipApplicationImportRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Imported or already present, with no external effects.",
      content: { "application/json": { schema: membershipApplicationImportResponseSchema } },
    },
  },
};
export const membershipApplicationActivationRouteSchema = {
  ...requiresPermissions("membership:approve"),
  tags: ["Membership"],
  summary: "Activate reconciled imported application processing",
  request: {
    params: z.object({ id: databaseIdSchema }),
    body: { content: { "application/json": { schema: membershipApplicationActivationRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Portal owns subsequent processing.",
      content: { "application/json": { schema: membershipApplicationActivationResponseSchema } },
    },
  },
};
