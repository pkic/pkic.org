import {
  formCreateResponseSchema,
  eventFormsListQuerySchema,
  formsListQuerySchema,
  formsListResponseSchema,
  formSubmissionsQuerySchema,
  formSubmissionsResponseSchema,
  formSubmissionStatsQuerySchema,
  formSubmissionStatsResponseSchema,
  formUpdateResponseSchema,
} from "./form-management";
import { eventSlugParamsSchema, formKeyParamsSchema } from "./api-common";
import {
  formPlacementCreateResponseSchema,
  formPlacementCreateSchema,
  formPlacementUpdateSchema,
  formPlacementsListQuerySchema,
  formPlacementsListResponseSchema,
  formDefinitionCreateSchema,
  formDefinitionUpdateSchema,
} from "./forms";
import { databaseIdSchema } from "./identifiers";

const formPlacementParamsSchema = formKeyParamsSchema.extend({ placementId: databaseIdSchema });
const eventFormKeyParamsSchema = eventSlugParamsSchema.merge(formKeyParamsSchema);

const formCreateResponses = {
  "201": {
    description: "Form created.",
    content: { "application/json": { schema: formCreateResponseSchema } },
  },
  "400": { description: "Invalid form payload." },
  "401": { description: "Form management authorization required." },
  "403": { description: "Insufficient permission to create forms." },
  "409": { description: "A form with this key already exists." },
};

export const formCreateRouteSchema = {
  tags: ["Forms"],
  summary: "Create a global form",
  description: "Creates a managed global custom form and its field definitions.",
  request: {
    body: { content: { "application/json": { schema: formDefinitionCreateSchema } }, required: true },
  },
  responses: formCreateResponses,
  "x-pkic-auth": { required: true, scopes: ["forms:write"] },
};

export const eventFormCreateRouteSchema = {
  ...formCreateRouteSchema,
  summary: "Create an event form",
  description: "Creates a managed custom form scoped to one event.",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: formDefinitionCreateSchema } }, required: true },
  },
  "x-pkic-auth": { required: true, scopes: ["events:write"] },
};

export const formsListRouteSchema = {
  tags: ["Forms"],
  summary: "List forms",
  description: "Returns global reusable form definitions with field and submission counts.",
  request: {
    query: formsListQuerySchema,
  },
  responses: {
    "200": {
      description: "Paginated forms list.",
      content: { "application/json": { schema: formsListResponseSchema } },
    },
    "401": { description: "Form management authorization required." },
  },
  "x-pkic-auth": { required: true, scopes: ["forms:read"] },
};

export const eventFormsListRouteSchema = {
  tags: ["Forms"],
  summary: "List forms available to an event",
  description: "Returns a searchable, sortable, paginated list of event-scoped forms plus global fallback forms.",
  request: {
    params: eventSlugParamsSchema,
    query: eventFormsListQuerySchema,
  },
  responses: {
    "200": {
      description: "Paginated event and global forms list.",
      content: { "application/json": { schema: formsListResponseSchema } },
    },
    "401": { description: "Form management authorization required." },
    "404": { description: "Event not found." },
  },
  "x-pkic-auth": { required: true, scopes: ["events:read"] },
};

export const formSubmissionsListRouteSchema = {
  tags: ["Forms"],
  summary: "List form submissions",
  description:
    "Returns a paginated, searchable, sortable, filterable list of submissions for a form, including linked registration/proposal answers not yet backfilled into form_submissions.",
  request: {
    params: formKeyParamsSchema,
    query: formSubmissionsQuerySchema,
  },
  responses: {
    "200": {
      description: "Paginated form submissions.",
      content: { "application/json": { schema: formSubmissionsResponseSchema } },
    },
    "401": { description: "Form management authorization required." },
    "404": { description: "Form not found." },
  },
  "x-pkic-auth": { required: true, scopes: ["forms:read"] },
};

export const formSubmissionStatsRouteSchema = {
  tags: ["Forms"],
  summary: "Get form submission statistics",
  description: "Returns exact per-field aggregates computed in D1 for the complete filtered submission population.",
  request: {
    params: formKeyParamsSchema,
    query: formSubmissionStatsQuerySchema,
  },
  responses: {
    "200": {
      description: "Aggregate form submission statistics.",
      content: { "application/json": { schema: formSubmissionStatsResponseSchema } },
    },
    "401": { description: "Form management authorization required." },
    "404": { description: "Form not found." },
  },
  "x-pkic-auth": { required: true, scopes: ["forms:read"] },
};

export const formPlacementsListRouteSchema = {
  tags: ["Forms"],
  summary: "List form placements",
  description: "Returns the bounded response-set placements that reuse one form definition.",
  request: { params: formKeyParamsSchema, query: formPlacementsListQuerySchema },
  responses: {
    "200": {
      description: "Paginated form placements.",
      content: { "application/json": { schema: formPlacementsListResponseSchema } },
    },
    "401": { description: "Form management authorization required." },
    "404": { description: "Form not found." },
  },
  "x-pkic-auth": { required: true, scopes: ["forms:read"] },
};

export const formPlacementCreateRouteSchema = {
  tags: ["Forms"],
  summary: "Place a reusable form",
  description: "Creates a distinct response set for an existing reusable form definition.",
  request: {
    params: formKeyParamsSchema,
    body: { content: { "application/json": { schema: formPlacementCreateSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Form placement created.",
      content: { "application/json": { schema: formPlacementCreateResponseSchema } },
    },
    "400": { description: "Invalid placement configuration." },
    "401": { description: "Form management authorization required." },
    "404": { description: "Form not found." },
    "409": { description: "This form already has the requested placement." },
  },
  "x-pkic-auth": { required: true, scopes: ["forms:write"] },
};

export const formPlacementUpdateRouteSchema = {
  tags: ["Forms"],
  summary: "Update a form placement",
  description: "Updates the audience, availability, context, or active state of one response set.",
  request: {
    params: formPlacementParamsSchema,
    body: { content: { "application/json": { schema: formPlacementUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Form placement updated.",
      content: { "application/json": { schema: formPlacementCreateResponseSchema } },
    },
    "400": { description: "Invalid placement configuration." },
    "401": { description: "Form management authorization required." },
    "404": { description: "Form or placement not found." },
    "409": { description: "The placement changed concurrently." },
  },
  "x-pkic-auth": { required: true, scopes: ["forms:write"] },
};

export const formGetRouteSchema = {
  tags: ["Forms"],
  summary: "Get form configuration",
  description: "Returns editable form metadata and ordered field definitions for a managed custom form.",
  request: {
    params: formKeyParamsSchema,
  },
  responses: {
    "200": { description: "Form metadata and fields." },
    "401": { description: "Form management authorization required." },
    "404": { description: "Form not found." },
  },
  "x-pkic-auth": { required: true, scopes: ["forms:read"] },
};

export const formPatchRouteSchema = {
  tags: ["Forms"],
  summary: "Update form configuration",
  description: "Updates form metadata and optionally replaces all field definitions for a custom form.",
  request: {
    params: formKeyParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: formDefinitionUpdateSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Updated form metadata and fields.",
      content: { "application/json": { schema: formUpdateResponseSchema } },
    },
    "400": { description: "Invalid form payload." },
    "401": { description: "Form management authorization required." },
    "403": { description: "Group-owned forms must be managed from the owning group context." },
    "404": { description: "Form not found." },
  },
  "x-pkic-auth": { required: true, scopes: ["forms:write"] },
};

export const formDeleteRouteSchema = {
  tags: ["Forms"],
  summary: "Delete or archive form configuration",
  description:
    "Deletes an unused custom form, or archives it when submissions exist so historical submissions remain preserved.",
  request: {
    params: formKeyParamsSchema,
  },
  responses: {
    "200": { description: "Form deleted or archived successfully." },
    "401": { description: "Form management authorization required." },
    "403": { description: "Group-owned forms must be managed from the owning group context." },
    "404": { description: "Form not found." },
  },
  "x-pkic-auth": { required: true, scopes: ["forms:write"] },
};

export const eventFormGetRouteSchema = {
  ...formGetRouteSchema,
  summary: "Get an event form configuration",
  request: { params: eventFormKeyParamsSchema },
  "x-pkic-auth": { required: true, scopes: ["events:read"] },
};

export const eventFormPatchRouteSchema = {
  ...formPatchRouteSchema,
  summary: "Update an event-owned form configuration",
  request: { ...formPatchRouteSchema.request, params: eventFormKeyParamsSchema },
  "x-pkic-auth": { required: true, scopes: ["events:write"] },
};

export const eventFormDeleteRouteSchema = {
  ...formDeleteRouteSchema,
  summary: "Delete or archive an event-owned form configuration",
  request: { params: eventFormKeyParamsSchema },
  "x-pkic-auth": { required: true, scopes: ["events:write"] },
};

export const eventFormSubmissionsListRouteSchema = {
  ...formSubmissionsListRouteSchema,
  summary: "List submissions for an event form",
  request: { ...formSubmissionsListRouteSchema.request, params: eventFormKeyParamsSchema },
  "x-pkic-auth": { required: true, scopes: ["events:read"] },
};

export const eventFormSubmissionStatsRouteSchema = {
  ...formSubmissionStatsRouteSchema,
  summary: "Get event form submission statistics",
  request: { ...formSubmissionStatsRouteSchema.request, params: eventFormKeyParamsSchema },
  "x-pkic-auth": { required: true, scopes: ["events:read"] },
};
