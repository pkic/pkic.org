import { z } from "zod";
import { apiErrorPayloadSchema, normalizedEmailSchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import {
  organizationRepresentativesListQuerySchema,
  organizationRepresentativesListResponseSchema,
  representativeAssociateSchema,
  representativeMutationResponseSchema,
  representativeRemoveSchema,
  representativeRestoreSchema,
  representationDomainAssessmentSchema,
} from "./organization-representation";

const jsonError = (description: string) => ({
  description,
  content: { "application/json": { schema: apiErrorPayloadSchema } },
});

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
    "403": jsonError("An organization contact or authorized staff member is required."),
  },
};

export const organizationRepresentativeAssociateRouteSchema = {
  tags: ["Organizations"],
  summary: "Associate an organization representative",
  description: "Association is immediate and does not require recipient acceptance.",
  request: {
    params: organizationRepresentativeCollectionParamsSchema,
    body: { required: true, content: { "application/json": { schema: representativeAssociateSchema } } },
  },
  responses: {
    "201": {
      description: "Representative associated.",
      content: { "application/json": { schema: representativeMutationResponseSchema } },
    },
    "403": jsonError("An organization contact or authorized staff member is required."),
    "409": jsonError("The association is active or blocked."),
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
    "409": jsonError("Already inactive or blocked."),
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
    "409": jsonError("Not currently blocked."),
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
