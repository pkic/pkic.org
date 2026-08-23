import {
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
