import { badgeCredentialSchema } from "./badge-credential";
import { requiresPermissions } from "./route-contract";
import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse, successResponseSchema, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { userCatalogItemSchema } from "./user-catalog";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { badgeDisplayRoleSchema } from "./participant-roles";
import { badgeTemplateBrandingSchema, eventBadgeTemplateSchema } from "./event-badge-template";
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
/** Issuance retries remain metadata-only; explicit authorized printing is a separate action. */
export const badgeIssueResponseSchema = z.discriminatedUnion("result", [
  badgeIssueResultSchema.extend({ result: z.literal("issued"), credential: badgeCredentialSchema }).strict(),
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
    reprintAvailable: z.boolean().default(false),
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
  request: {
    params: eventSlugParamsSchema,
    query: badgeCredentialsQuerySchema,
  },
  responses: {
    "200": {
      description: "Badge metadata",
      content: {
        "application/json": { schema: badgeCredentialsResponseSchema },
      },
    },
    "403": jsonErrorResponse("Event management permission required"),
  },
};
export const badgeCredentialRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Events"],
  summary: "Read event-owned badge metadata without credentials",
  request: {
    params: eventSlugParamsSchema.extend({ badgeId: databaseIdSchema }),
  },
  responses: {
    "200": {
      description: "Badge metadata",
      content: {
        "application/json": { schema: badgeCredentialMetadataSchema },
      },
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
    body: {
      content: { "application/json": { schema: badgeIssueRequestSchema } },
      required: true,
    },
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
  request: {
    params: eventSlugParamsSchema.extend({ badgeId: databaseIdSchema }),
  },
  responses: {
    "200": {
      description: "Badge revoked",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "403": jsonErrorResponse("Event management permission required"),
    "404": jsonErrorResponse("Badge unavailable"),
    "409": jsonErrorResponse("Badge changed or capture closed"),
  },
};

/** Printing never issues, replaces, or extends a credential. */
export const badgePrintingRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const badgePrintRequestSchema = z
  .object({ operationId: databaseIdSchema, printingRevision: badgePrintingRevisionSchema })
  .strict();
export type BadgePrintRequest = z.infer<typeof badgePrintRequestSchema>;
export const badgePrintResponseSchema = z
  .object({
    id: databaseIdSchema,
    svg: z.string().min(1).max(100000),
    displayName: badgeCredentialMetadataSchema.shape.displayName,
    firstName: userCatalogItemSchema.shape.first_name,
    lastName: userCatalogItemSchema.shape.last_name,
    organization: z.string().max(500).nullable(),
    badgeRole: badgeDisplayRoleSchema,
    printingRevision: badgePrintingRevisionSchema,
    expiresAt: utcInstantSchema,
  })
  .strict();
export const badgePrintingResponseSchema = z
  .object({
    revision: badgePrintingRevisionSchema,
    template: eventBadgeTemplateSchema.nullable(),
    branding: badgeTemplateBrandingSchema,
  })
  .strict();
export type BadgePrintingContext = z.infer<typeof badgePrintingResponseSchema>;
export const badgePrintingRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Events"],
  summary: "Prepare the current event badge template and approved sponsor artwork once per print document",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Transient authenticated event print context",
      content: { "application/json": { schema: badgePrintingResponseSchema } },
    },
    "403": jsonErrorResponse("Event management permission required or changed"),
    "409": jsonErrorResponse("Badge template or approved sponsor artwork changed"),
    "413": jsonErrorResponse("Owned sponsor artwork exceeds the print document limits"),
    "422": jsonErrorResponse("Badge template or approved sponsor artwork is invalid or requires replacement"),
    "503": jsonErrorResponse("Asset storage is unavailable"),
  },
};
export const badgePrintRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Events"],
  summary: "Prepare an existing active badge for printing without replacement",
  request: {
    params: eventSlugParamsSchema.extend({ badgeId: databaseIdSchema }),
    body: {
      content: { "application/json": { schema: badgePrintRequestSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Transient authenticated print artifact",
      content: { "application/json": { schema: badgePrintResponseSchema } },
    },
    "403": jsonErrorResponse("Event management permission required or changed"),
    "404": jsonErrorResponse("Badge unavailable"),
    "409": jsonErrorResponse("Badge inactive, changed, or has no recoverable print artifact"),
    "422": jsonErrorResponse("Badge template or sponsor configuration is invalid"),
    "503": jsonErrorResponse("Badge print encryption is unavailable"),
  },
};
