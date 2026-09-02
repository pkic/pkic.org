import { z } from "zod";
import { jsonErrorResponse } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import {
  currentUserIdentityCreateSchema,
  currentUserIdentityAcceptSchema,
  identitiesListQuerySchema,
  identitiesListResponseSchema,
  identityCreateSchema,
  identityMutationResponseSchema,
  identityUpdateSchema,
} from "./identity";
import { requiresSession } from "./route-contract";

export const organizationIdentityCollectionParamsSchema = z.object({ organizationId: databaseIdSchema });
export const organizationIdentityParamsSchema = organizationIdentityCollectionParamsSchema.extend({
  identityId: databaseIdSchema,
});

/**
 * Creating an identity as one value: the organization the route reads from
 * its path and the identity it reads from the body. A form that picks the
 * organization and describes the identity at once validates through both.
 */
export const organizationIdentityCreateRequestSchema = z.intersection(
  organizationIdentityCollectionParamsSchema,
  identityCreateSchema,
);

export const organizationIdentitiesListRouteSchema = {
  ...requiresSession(),
  tags: ["Organizations"],
  summary: "List organization identities",
  description: "Filtering, search, sorting, counting, and pagination are executed in D1.",
  request: {
    params: organizationIdentityCollectionParamsSchema,
    query: identitiesListQuerySchema,
  },
  responses: {
    "200": {
      description: "A bounded identity page.",
      content: { "application/json": { schema: identitiesListResponseSchema } },
    },
    "403": jsonErrorResponse("An organization contact or authorized staff member is required."),
  },
};

export const organizationIdentityCreateRouteSchema = {
  ...requiresSession(),
  tags: ["Organizations"],
  summary: "Create an organization identity",
  description:
    "Organization contacts create a pending invitation. Immediate activation requires a user-backed staff session with both membership:write and identities:activate, a reason, and an attributable audit record.",
  request: {
    params: organizationIdentityCollectionParamsSchema,
    body: { required: true, content: { "application/json": { schema: identityCreateSchema } } },
  },
  responses: {
    "201": {
      description: "Identity created.",
      content: { "application/json": { schema: identityMutationResponseSchema } },
    },
    "403": jsonErrorResponse("An organization contact or the required staff permission is required."),
    "404": jsonErrorResponse("Organization not found."),
    "409": jsonErrorResponse("An active, pending, or blocked identity conflicts with this request."),
    "422": jsonErrorResponse("The selected email does not prove the organization relationship."),
  },
};

export const organizationIdentityUpdateRouteSchema = {
  ...requiresSession(),
  tags: ["Organizations"],
  summary: "Update an organization identity",
  description:
    "Updates either scoped profile data or one lifecycle transition. Immediate activation requires a user-backed staff session with both membership:write and identities:activate.",
  request: {
    params: organizationIdentityParamsSchema,
    body: { required: true, content: { "application/json": { schema: identityUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Identity updated.",
      content: { "application/json": { schema: identityMutationResponseSchema } },
    },
    "403": jsonErrorResponse("An organization contact or the required staff permission is required."),
    "409": jsonErrorResponse("The identity or authorization changed concurrently."),
  },
};

export const currentUserIdentitiesListRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "List the current user's acting identities",
  request: { query: identitiesListQuerySchema },
  responses: {
    "200": {
      description: "The current user's bounded identity page.",
      content: { "application/json": { schema: identitiesListResponseSchema } },
    },
  },
};

export const currentUserIdentityCreateRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Activate a claimed-domain identity for the current user",
  description:
    "Requires an exact verified email-domain claim and explicit organization-join action. Only this explicit acceptance may activate the canonical Member group enrollments; verifying an account or event email never does so.",
  request: {
    body: { required: true, content: { "application/json": { schema: currentUserIdentityCreateSchema } } },
  },
  responses: {
    "201": {
      description: "Identity activated.",
      content: { "application/json": { schema: identityMutationResponseSchema } },
    },
    "409": jsonErrorResponse("An identity or domain claim conflicts with this request."),
    "422": jsonErrorResponse("The selected verified email does not prove this organization relationship."),
  },
};

export const currentUserIdentityAcceptRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Accept the current user's pending identity invitation",
  description:
    "Activates only a pending identity owned by the signed-in user. Member and automatic group access begin in the same guarded D1 batch; merely receiving or verifying the invitation email grants no access.",
  request: {
    params: z.object({ identityId: databaseIdSchema }),
    body: { required: true, content: { "application/json": { schema: currentUserIdentityAcceptSchema } } },
  },
  responses: {
    "200": {
      description: "Identity invitation accepted.",
      content: { "application/json": { schema: identityMutationResponseSchema } },
    },
    "404": jsonErrorResponse("Pending identity invitation not found."),
    "409": jsonErrorResponse("The identity or user session changed while accepting the invitation."),
  },
};
