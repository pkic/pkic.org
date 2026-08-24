import {
  adminFormCreateResponseSchema,
  adminFormCreateSchema,
  adminFormsListQuerySchema,
  adminFormsListResponseSchema,
  adminFormSubmissionsQuerySchema,
  adminFormSubmissionsResponseSchema,
  adminFormSubmissionStatsQuerySchema,
  adminFormSubmissionStatsResponseSchema,
  adminFormUpdateSchema,
  adminFormUpdateResponseSchema,
} from "./admin-forms";
import { eventSlugParamsSchema, formKeyParamsSchema } from "./api-common";
import {
  formPlacementCreateResponseSchema,
  formPlacementCreateSchema,
  formPlacementUpdateSchema,
  formPlacementsListQuerySchema,
  formPlacementsListResponseSchema,
} from "./forms";
import { databaseIdSchema } from "./identifiers";

const formPlacementParamsSchema = formKeyParamsSchema.extend({ placementId: databaseIdSchema });

/**
 * Legacy browser form endpoint. The payload intentionally remains dynamic
 * FormData because the public join and sponsor shortcodes submit configured
 * fields, while the endpoint preserves the browser redirect contract.
 */
export const legacyFormSubmissionRouteSchema = {
  tags: ["Legacy forms"],
  summary: "Submit a legacy public form",
  description:
    "Accepts the join-membership and sponsor-interest browser forms and redirects to the trusted referring page with a success or error status.",
  responses: {
    "302": { description: "Redirect to the trusted referring page with the submission status." },
    "400": { description: "Missing or untrusted request origin." },
  },
};

const adminFormCreateResponses = {
  "201": {
    description: "Form created.",
    content: { "application/json": { schema: adminFormCreateResponseSchema } },
  },
  "400": { description: "Invalid form payload." },
  "401": { description: "Admin authorization required." },
  "403": { description: "Insufficient permission to create forms." },
  "409": { description: "A form with this key already exists." },
};

export const adminFormCreateRouteSchema = {
  tags: ["Admin forms"],
  summary: "Create a global form",
  description: "Creates an admin-managed global custom form and its field definitions.",
  request: {
    body: { content: { "application/json": { schema: adminFormCreateSchema } }, required: true },
  },
  responses: adminFormCreateResponses,
};

export const adminEventFormCreateRouteSchema = {
  ...adminFormCreateRouteSchema,
  summary: "Create an event form",
  description: "Creates an admin-managed custom form scoped to one event.",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: adminFormCreateSchema } }, required: true },
  },
};

export const adminFormsListRouteSchema = {
  tags: ["Admin forms"],
  summary: "List forms",
  description: "Returns every admin-managed custom form across scopes, with field and submission counts.",
  request: {
    query: adminFormsListQuerySchema,
  },
  responses: {
    "200": {
      description: "Paginated forms list.",
      content: { "application/json": { schema: adminFormsListResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
  },
};

export const adminEventFormsListRouteSchema = {
  tags: ["Admin forms"],
  summary: "List forms available to an event",
  description: "Returns a searchable, sortable, paginated list of event-scoped forms plus global fallback forms.",
  request: {
    params: eventSlugParamsSchema,
    query: adminFormsListQuerySchema,
  },
  responses: {
    "200": {
      description: "Paginated event and global forms list.",
      content: { "application/json": { schema: adminFormsListResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "Event not found." },
  },
};

export const adminFormSubmissionsListRouteSchema = {
  tags: ["Admin forms"],
  summary: "List form submissions",
  description:
    "Returns a paginated, searchable, sortable, filterable list of submissions for a form, including linked registration/proposal answers not yet backfilled into form_submissions.",
  request: {
    params: formKeyParamsSchema,
    query: adminFormSubmissionsQuerySchema,
  },
  responses: {
    "200": {
      description: "Paginated form submissions.",
      content: { "application/json": { schema: adminFormSubmissionsResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "Form not found." },
  },
};

export const adminFormSubmissionStatsRouteSchema = {
  tags: ["Admin forms"],
  summary: "Get form submission statistics",
  description: "Returns exact per-field aggregates computed in D1 for the complete filtered submission population.",
  request: {
    params: formKeyParamsSchema,
    query: adminFormSubmissionStatsQuerySchema,
  },
  responses: {
    "200": {
      description: "Aggregate form submission statistics.",
      content: { "application/json": { schema: adminFormSubmissionStatsResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "Form not found." },
  },
};

export const adminFormPlacementsListRouteSchema = {
  tags: ["Admin forms"],
  summary: "List form placements",
  description: "Returns the bounded response-set placements that reuse one form definition.",
  request: { params: formKeyParamsSchema, query: formPlacementsListQuerySchema },
  responses: {
    "200": {
      description: "Paginated form placements.",
      content: { "application/json": { schema: formPlacementsListResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "Form not found." },
  },
};

export const adminFormPlacementCreateRouteSchema = {
  tags: ["Admin forms"],
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
    "401": { description: "Admin authorization required." },
    "404": { description: "Form not found." },
    "409": { description: "This form already has the requested placement." },
  },
};

export const adminFormPlacementUpdateRouteSchema = {
  tags: ["Admin forms"],
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
    "401": { description: "Admin authorization required." },
    "404": { description: "Form or placement not found." },
    "409": { description: "The placement changed concurrently." },
  },
};

export const adminFormGetRouteSchema = {
  tags: ["Admin forms"],
  summary: "Get form configuration",
  description: "Returns editable form metadata and ordered field definitions for an admin-managed custom form.",
  request: {
    params: formKeyParamsSchema,
  },
  responses: {
    "200": { description: "Form metadata and fields." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Form not found." },
  },
};

export const adminFormPatchRouteSchema = {
  tags: ["Admin forms"],
  summary: "Update form configuration",
  description: "Updates form metadata and optionally replaces all field definitions for a custom form.",
  request: {
    params: formKeyParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: adminFormUpdateSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Updated form metadata and fields.",
      content: { "application/json": { schema: adminFormUpdateResponseSchema } },
    },
    "400": { description: "Invalid form payload." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Form not found." },
  },
};

export const adminFormDeleteRouteSchema = {
  tags: ["Admin forms"],
  summary: "Delete or archive form configuration",
  description:
    "Deletes an unused custom form, or archives it when submissions exist so historical submissions remain preserved.",
  request: {
    params: formKeyParamsSchema,
  },
  responses: {
    "200": { description: "Form deleted or archived successfully." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Form not found." },
  },
};
