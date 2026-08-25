import { z } from "zod";
import {
  adminFormSubmissionSchema,
  adminFormSubmissionStatsQuerySchema,
  adminFormSubmissionStatSchema,
  adminFormSubmissionsQuerySchema,
} from "./admin-forms";
import { jsonErrorResponse, successResponseSchema } from "./api-common";
import {
  formDefinitionCreateSchema,
  formDefinitionUpdateSchema,
  formFieldDefinitionSchema,
  formPlacementPolicyUpdateSchema,
  formPlacementSchema,
  formPurposeSchema,
  formStatusSchema,
} from "./forms";
import { groupReferenceParamsSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { formGroupGrantSchemas } from "./resource-grants";

export const GROUP_FORMS_SORT_COLUMNS = ["title", "purpose", "audience", "opens_at", "created_at"] as const;

export const groupFormsListQuerySchema = listQuerySchema(GROUP_FORMS_SORT_COLUMNS).extend({
  purpose: formPurposeSchema.optional(),
  status: formStatusSchema.optional(),
  contextType: formPlacementSchema.shape.contextType.optional(),
  audience: z.string().trim().min(1).max(100).optional(),
  active: z.enum(["true", "false"]).default("true"),
});
export type GroupFormsListQuery = z.infer<typeof groupFormsListQuerySchema>;

export const groupFormReferenceSchema = z.object({
  id: databaseIdSchema,
  key: z.string(),
  purpose: formPurposeSchema,
  status: formStatusSchema,
  title: z.string(),
  description: z.string().nullable(),
  updatedAt: z.string(),
});

export const groupFormPlacementSummarySchema = z.object({
  form: groupFormReferenceSchema,
  placement: formPlacementSchema,
  capabilities: z.array(formGroupGrantSchemas.capabilitySchema).max(formGroupGrantSchemas.capabilities.length),
  acceptingResponses: z.boolean(),
});
export type GroupFormPlacementSummary = z.infer<typeof groupFormPlacementSummarySchema>;

export const groupFormsListResponseSchema = paginatedResponseSchema("forms", groupFormPlacementSummarySchema);

export const groupFormDefinitionResponseSchema = groupFormPlacementSummarySchema.extend({
  fields: z.array(formFieldDefinitionSchema),
});

export const groupFormDefinitionCreateSchema = formDefinitionCreateSchema.safeExtend({
  purpose: z.enum(["survey", "feedback"]),
});
export const groupFormDefinitionUpdateSchema = formDefinitionUpdateSchema;
export type GroupFormDefinitionCreateInput = z.infer<typeof groupFormDefinitionCreateSchema>;
export type GroupFormDefinitionUpdateInput = z.infer<typeof groupFormDefinitionUpdateSchema>;
export const groupFormDefinitionMutationResponseSchema = successResponseSchema.extend(
  groupFormDefinitionResponseSchema.shape,
);

const groupFormParamsSchema = groupReferenceParamsSchema.extend({ placementId: databaseIdSchema });

export const groupFormSubmissionSchema = z
  .object({
    answers: z.record(z.string().trim().min(1).max(80), z.unknown()),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value.answers).length > 50) {
      context.addIssue({ code: "custom", path: ["answers"], message: "A form response cannot exceed 50 fields" });
    }
  });
export type GroupFormSubmissionInput = z.infer<typeof groupFormSubmissionSchema>;

export const groupFormSubmissionResponseSchema = successResponseSchema.extend({ submissionId: databaseIdSchema });

export const groupFormSubmissionsQuerySchema = adminFormSubmissionsQuerySchema.omit({
  placementId: true,
  eventSlug: true,
});
export type GroupFormSubmissionsQuery = z.infer<typeof groupFormSubmissionsQuerySchema>;
export const groupFormSubmissionStatsQuerySchema = adminFormSubmissionStatsQuerySchema.omit({
  placementId: true,
  eventSlug: true,
});
export type GroupFormSubmissionStatsQuery = z.infer<typeof groupFormSubmissionStatsQuerySchema>;

export const groupFormSubmissionsResponseSchema = paginatedResponseSchema(
  "submissions",
  adminFormSubmissionSchema,
).extend({
  form: groupFormReferenceSchema,
  placement: formPlacementSchema,
});

export const groupFormSubmissionStatsResponseSchema = z.object({
  form: groupFormReferenceSchema,
  placement: formPlacementSchema,
  total: z.number().int().nonnegative(),
  stats: z.array(adminFormSubmissionStatSchema),
});

export const groupFormPlacementUpdateSchema = formPlacementPolicyUpdateSchema;
export type GroupFormPlacementUpdateInput = z.infer<typeof groupFormPlacementUpdateSchema>;

export const groupFormsListRouteSchema = {
  tags: ["Groups"],
  summary: "List forms available through a group",
  description: "Access filtering, search, sorting, counting, and pagination are executed in D1.",
  request: { params: groupReferenceParamsSchema, query: groupFormsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of owned and explicitly shared form placements.",
      content: { "application/json": { schema: groupFormsListResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("Group not found or not visible."),
  },
};

export const groupFormCreateRouteSchema = {
  tags: ["Groups"],
  summary: "Create a group survey or feedback form",
  description:
    "Creates one reusable form definition and its group-owned response placement in a single authorized D1 command.",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupFormDefinitionCreateSchema } } },
  },
  responses: {
    "201": {
      description: "Created group form definition and placement.",
      content: { "application/json": { schema: groupFormDefinitionMutationResponseSchema } },
    },
    "403": jsonErrorResponse("Effective group management permission is required."),
    "404": jsonErrorResponse("Group not found or not visible."),
    "409": jsonErrorResponse("A form with this key already exists or management authority changed."),
  },
};

export const groupFormDefinitionRouteSchema = {
  tags: ["Groups"],
  summary: "Get one group form definition",
  request: { params: groupFormParamsSchema },
  responses: {
    "200": {
      description: "The live form definition and its group-owned placement.",
      content: { "application/json": { schema: groupFormDefinitionResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("The form is not available through this group."),
  },
};

export const groupFormSubmissionCreateRouteSchema = {
  tags: ["Groups"],
  summary: "Submit a group survey or feedback form",
  request: {
    params: groupFormParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupFormSubmissionSchema } } },
  },
  responses: {
    "201": {
      description: "Form response recorded.",
      content: { "application/json": { schema: groupFormSubmissionResponseSchema } },
    },
    "403": jsonErrorResponse("The caller lacks the submit capability."),
    "404": jsonErrorResponse("The form is not available through this group or is not accepting responses."),
    "409": jsonErrorResponse("The form changed while the response was being saved."),
    "422": jsonErrorResponse("The answers do not satisfy the live form definition."),
  },
};

export const groupFormSubmissionsListRouteSchema = {
  tags: ["Groups"],
  summary: "List responses for one group form placement",
  description: "Filtering, search, sorting, counting, and pagination are executed in D1.",
  request: { params: groupFormParamsSchema, query: groupFormSubmissionsQuerySchema },
  responses: {
    "200": {
      description: "A bounded response page isolated to this placement.",
      content: { "application/json": { schema: groupFormSubmissionsResponseSchema } },
    },
    "403": jsonErrorResponse("Effective response-viewing capability is required."),
    "404": jsonErrorResponse("The form is not available through this group."),
  },
};

export const groupFormSubmissionStatsRouteSchema = {
  tags: ["Groups"],
  summary: "Get response statistics for one group form placement",
  description: "Exact aggregates are calculated in D1 over the same filtered response population as the list.",
  request: { params: groupFormParamsSchema, query: groupFormSubmissionStatsQuerySchema },
  responses: {
    "200": {
      description: "Placement-isolated form response statistics.",
      content: { "application/json": { schema: groupFormSubmissionStatsResponseSchema } },
    },
    "403": jsonErrorResponse("Effective response-viewing capability is required."),
    "404": jsonErrorResponse("The form is not available through this group."),
  },
};

export const groupFormPlacementUpdateRouteSchema = {
  tags: ["Groups"],
  summary: "Update one group form placement",
  description: "Updates placement policy without permitting resource ownership transfer.",
  request: {
    params: groupFormParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupFormPlacementUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Updated placement.",
      content: { "application/json": { schema: groupFormDefinitionResponseSchema } },
    },
    "403": jsonErrorResponse("Effective form-management capability is required."),
    "404": jsonErrorResponse("The form is not available through this group."),
    "409": jsonErrorResponse("The placement changed concurrently."),
  },
};

export const groupFormDefinitionUpdateRouteSchema = {
  tags: ["Groups"],
  summary: "Update an owned group form definition",
  description:
    "Updates editable metadata and fields only when this group owns both the definition and placement; shared placements remain owner-controlled.",
  request: {
    params: groupFormParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupFormDefinitionUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Updated group form definition and placement projection.",
      content: { "application/json": { schema: groupFormDefinitionMutationResponseSchema } },
    },
    "403": jsonErrorResponse("Effective management of the owning group and form placement is required."),
    "404": jsonErrorResponse("The owned form is not available through this group."),
    "409": jsonErrorResponse("The definition or management authority changed concurrently."),
  },
};
