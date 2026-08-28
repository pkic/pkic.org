import { z } from "zod";
import { jsonErrorResponse, normalizedEmailSchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import {
  organizationRepresentativesListQuerySchema,
  organizationRepresentativesListResponseSchema,
  representativeAssociateSchema,
  representativeProfileUpdateSchema,
  representativeMutationResponseSchema,
  representativeRemoveSchema,
  representativeRestoreSchema,
  representationDomainAssessmentSchema,
} from "./organization-representation";

export const organizationRepresentativeCollectionParamsSchema = z.object({ organizationId: databaseIdSchema });
export const organizationRepresentativeParamsSchema = organizationRepresentativeCollectionParamsSchema.extend({
  userId: databaseIdSchema,
});

export const organizationRepresentativesListRouteSchema = {
  tags: ["Organizations"],
  summary: "List organization representatives",
  description: "Filtering, search, sorting, counting, and pagination are executed in D1.",
  request: {
    params: organizationRepresentativeCollectionParamsSchema,
    query: organizationRepresentativesListQuerySchema,
  },
  responses: {
    "200": {
      description: "A bounded representative page.",
      content: { "application/json": { schema: organizationRepresentativesListResponseSchema } },
    },
    "403": jsonErrorResponse("An organization contact or authorized staff member is required."),
  },
};

export const organizationRepresentativeAssociateRouteSchema = {
  tags: ["Organizations"],
  summary: "Associate an organization representative",
  description:
    "Association is immediate and does not require recipient acceptance. The direct-email variant requires an attributable membership:write staff session; organization contacts may only associate an existing user.",
  request: {
    params: organizationRepresentativeCollectionParamsSchema,
    body: { required: true, content: { "application/json": { schema: representativeAssociateSchema } } },
  },
  responses: {
    "201": {
      description: "Representative associated.",
      content: { "application/json": { schema: representativeMutationResponseSchema } },
    },
    "403": jsonErrorResponse("An organization contact or authorized staff member is required."),
    "404": jsonErrorResponse("Organization not found."),
    "409": jsonErrorResponse("The association is active or blocked."),
    "422": jsonErrorResponse("The organization has no membership category."),
  },
};

export const organizationRepresentativeUpdateRouteSchema = {
  tags: ["Organizations"],
  summary: "Update an organization representative profile setting",
  request: {
    params: organizationRepresentativeParamsSchema,
    body: { required: true, content: { "application/json": { schema: representativeProfileUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Representative updated.",
      content: { "application/json": { schema: representativeMutationResponseSchema } },
    },
    "403": jsonErrorResponse("An organization contact or authorized staff member is required."),
    "409": jsonErrorResponse("The representation or authorization changed concurrently."),
  },
};

export const organizationRepresentativeBlockRouteSchema = {
  tags: ["Organizations"],
  summary: "Remove and block an organization representative",
  request: {
    params: organizationRepresentativeParamsSchema,
    body: { required: true, content: { "application/json": { schema: representativeRemoveSchema } } },
  },
  responses: {
    "200": {
      description: "Representative blocked.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "409": jsonErrorResponse("Already inactive or blocked."),
  },
};

export const organizationRepresentativeRestoreRouteSchema = {
  tags: ["Organizations"],
  summary: "Explicitly restore a blocked organization representative",
  request: {
    params: organizationRepresentativeParamsSchema,
    body: { required: true, content: { "application/json": { schema: representativeRestoreSchema } } },
  },
  responses: {
    "200": {
      description: "Representative restored.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "409": jsonErrorResponse("Not currently blocked."),
  },
};

export const representationDomainAssessmentRouteSchema = {
  tags: ["Organizations"],
  summary: "Assess whether one of the caller's email addresses can establish representation",
  request: { query: z.object({ email: normalizedEmailSchema }) },
  responses: {
    "200": {
      description: "Domain evidence assessment.",
      content: { "application/json": { schema: representationDomainAssessmentSchema } },
    },
  },
};

export const representationReconcileResponseSchema = z.object({ representativeIds: z.array(databaseIdSchema) });
export const representationReconcileRouteSchema = {
  tags: ["Organizations"],
  summary: "Reconcile the caller's verified claimed-domain representations",
  responses: {
    "200": {
      description: "Newly associated durable relationships.",
      content: { "application/json": { schema: representationReconcileResponseSchema } },
    },
  },
};
