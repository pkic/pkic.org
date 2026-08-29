import { z } from "zod";
import { jsonErrorResponse, utcInstantSchema } from "./api-common";
import {
  addDuplicateFormFieldIssues,
  eventFormsPurposeSchema,
  formDefinitionCreateBaseSchema,
  formPlacementSchema,
} from "./forms";
import { eventConfigurationRevisionSchema } from "./event-configuration";
import { groupEventParamsSchema } from "./group-events";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { requiresSession } from "./route-contract";

/** One exact, group-managed reusable form placed in an event flow. */
export const groupEventFormSchema = z.object({
  placement: formPlacementSchema,
  form: z.object({
    id: databaseIdSchema,
    key: z.string(),
    title: z.string(),
    description: z.string().nullable(),
  }),
});

export const groupEventFormResponseSchema = z.object({
  eventUpdatedAt: utcInstantSchema,
  purpose: eventFormsPurposeSchema,
  form: groupEventFormSchema.nullable(),
});

export const groupEventFormUpdateSchema = eventConfigurationRevisionSchema.extend({
  /** Existing reusable group form to attach, or null to remove the exact placement. */
  formId: databaseIdSchema.nullable(),
});

export const groupEventFormCreateSchema = eventConfigurationRevisionSchema.extend({
  definition: formDefinitionCreateBaseSchema
    .omit({ purpose: true })
    .safeExtend({ status: z.literal("active").default("active") })
    .superRefine(addDuplicateFormFieldIssues),
});

export const groupEventFormParamsSchema = groupEventParamsSchema.extend({ purpose: eventFormsPurposeSchema });
export const GROUP_EVENT_FORMS_SORT_COLUMNS = ["key", "title", "updated_at"] as const;
export const groupEventFormsQuerySchema = listQuerySchema(GROUP_EVENT_FORMS_SORT_COLUMNS);
export type GroupEventFormsQuery = z.infer<typeof groupEventFormsQuerySchema>;

export const groupEventAvailableFormSchema = z.object({
  id: databaseIdSchema,
  key: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  updatedAt: z.string(),
});

export const groupEventFormsResponseSchema = paginatedResponseSchema("forms", groupEventAvailableFormSchema);

export const groupEventFormGetRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Get one exact form placement for a managed group event",
  description:
    "Returns only the active placement selected for this event flow. It never applies legacy or installation fallback.",
  request: { params: groupEventFormParamsSchema },
  responses: {
    "200": {
      description: "The event revision and optional exact event-flow form placement.",
      content: { "application/json": { schema: groupEventFormResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
    "409": jsonErrorResponse("Meeting events must be configured through their meeting series."),
  },
};

export const groupEventFormPutRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Select or clear one exact form placement for a managed group event",
  description:
    "Atomically replaces the selected reusable group form for one event flow with an optimistic event revision check.",
  request: {
    params: groupEventFormParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupEventFormUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "The event-flow form placement was updated.",
      content: { "application/json": { schema: groupEventFormResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event or selected group form is not available."),
    "409": jsonErrorResponse("The event, form placement, or management authority changed; reload and retry."),
  },
};

export const groupEventFormCreateRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Create and select one exact form for a managed group event",
  description: "Creates a reusable group-owned form and its exact event-flow placement in one guarded D1 command.",
  request: {
    params: groupEventFormParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupEventFormCreateSchema } } },
  },
  responses: {
    "201": {
      description: "The event-flow form and exact placement were created.",
      content: { "application/json": { schema: groupEventFormResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
    "409": jsonErrorResponse("The event, form placement, or management authority changed; reload and retry."),
  },
};

export const groupEventFormsListRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "List reusable forms available to a managed group event flow",
  description: "Search, sorting, counting, and pagination execute in D1 over active group-owned form definitions.",
  request: { params: groupEventFormParamsSchema, query: groupEventFormsQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of reusable forms for the requested event-flow purpose.",
      content: { "application/json": { schema: groupEventFormsResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
  },
};
