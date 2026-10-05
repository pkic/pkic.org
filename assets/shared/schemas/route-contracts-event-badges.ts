import { requiresPermissions } from "./route-contract";
import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse, successResponseSchema, utcInstantSchema } from "./api-common";
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
export const badgeIssueRequestSchema = z
  .object({
    operationId: databaseIdSchema,
    userId: databaseIdSchema,
    expiresAt: utcInstantSchema.optional(),
    replaceBadgeId: databaseIdSchema.optional(),
  })
  .strict();
export type BadgeIssueRequest = z.infer<typeof badgeIssueRequestSchema>;
const badgeIssueResultSchema = z.object({
  id: databaseIdSchema,
  expiresAt: utcInstantSchema,
  replacedBadgeId: databaseIdSchema.nullable(),
});
/** Completed retries return metadata only; printable bearers are never recoverable from storage. */
export const badgeIssueResponseSchema = z.discriminatedUnion("result", [
  badgeIssueResultSchema.extend({ result: z.literal("issued"), credential: databaseIdSchema }).strict(),
  badgeIssueResultSchema.extend({ result: z.literal("replayed"), credential: z.null() }).strict(),
]);
export type BadgeIssueResponse = z.infer<typeof badgeIssueResponseSchema>;
export const badgeCredentialStatusSchema = z.enum(["active", "expired", "revoked"]);
export const badgeCredentialMetadataSchema = z
  .object({
    id: databaseIdSchema,
    eventId: databaseIdSchema,
    userId: databaseIdSchema,
    displayName: userCatalogItemSchema.shape.first_name,
    createdAt: utcInstantSchema,
    expiresAt: utcInstantSchema.nullable(),
    revokedAt: utcInstantSchema.nullable(),
    status: badgeCredentialStatusSchema,
  })
  .strict();
export type BadgeCredentialMetadata = z.infer<typeof badgeCredentialMetadataSchema>;
export const badgeCredentialsQuerySchema = listQuerySchema(["createdAt", "expiresAt", "displayName"] as const).extend({
  userId: databaseIdSchema.optional(),
  status: badgeCredentialStatusSchema.optional(),
});
export const badgeCredentialsResponseSchema = paginatedResponseSchema("badges", badgeCredentialMetadataSchema);
export type BadgeCredentialsQuery = z.infer<typeof badgeCredentialsQuerySchema>;
export const badgeCredentialsRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Events"],
  summary: "List issued badge metadata without credentials",
  request: { params: eventSlugParamsSchema, query: badgeCredentialsQuerySchema },
  responses: {
    "200": {
      description: "Badge metadata",
      content: { "application/json": { schema: badgeCredentialsResponseSchema } },
    },
    "403": jsonErrorResponse("Event management permission required"),
  },
};
export const badgeCredentialRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Events"],
  summary: "Read event-owned badge metadata without credentials",
  request: { params: eventSlugParamsSchema.extend({ badgeId: databaseIdSchema }) },
  responses: {
    "200": {
      description: "Badge metadata",
      content: { "application/json": { schema: badgeCredentialMetadataSchema } },
    },
    "403": jsonErrorResponse("Event management permission required"),
    "404": jsonErrorResponse("Badge unavailable"),
  },
};
export const badgeIssueRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Events"],
  summary: "Issue or explicitly replace an opaque printable badge credential",
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
    "404": jsonErrorResponse("Selected badge unavailable"),
    "409": jsonErrorResponse("Badge ownership, registration or operation changed"),
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
    "404": jsonErrorResponse("Badge unavailable"),
    "409": jsonErrorResponse("Badge changed or capture closed"),
  },
};
