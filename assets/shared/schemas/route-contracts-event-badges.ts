import { requiresPermissions } from "./route-contract";
import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { userCatalogItemSchema } from "./user-catalog";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
export const badgeAttendeeQuerySchema = listQuerySchema(["email"] as const);
export const badgeAttendeesResponseSchema = paginatedResponseSchema(
  "users",
  userCatalogItemSchema
    .pick({ id: true, email: true, first_name: true, last_name: true })
    .extend({ organization_name: z.string().nullable().optional() }),
);
export const badgeAttendeesRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Events"],
  summary: "Find registered attendees for badge issuance",
  request: { params: eventSlugParamsSchema, query: badgeAttendeeQuerySchema },
  responses: {
    "200": {
      description: "Registered attendee choices",
      content: { "application/json": { schema: badgeAttendeesResponseSchema } },
    },
    "403": jsonErrorResponse("Event management permission required"),
  },
};
export const badgeIssueRequestSchema = z.object({ userId: databaseIdSchema }).strict();
export const badgeIssueResponseSchema = z.object({ id: databaseIdSchema, credential: databaseIdSchema }).strict();
export const badgeIssueRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Events"],
  summary: "Issue an opaque printable badge credential",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: badgeIssueRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Badge credential; returned only on issuance",
      content: { "application/json": { schema: badgeIssueResponseSchema } },
    },
    "403": jsonErrorResponse("Event management permission required"),
  },
};
export const badgeRevokeRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Events"],
  summary: "Revoke a badge credential",
  request: { params: eventSlugParamsSchema.extend({ badgeId: databaseIdSchema }) },
  responses: {
    "200": { description: "Badge revoked", content: { "application/json": { schema: successResponseSchema } } },
    "403": jsonErrorResponse("Event management permission required"),
  },
};
