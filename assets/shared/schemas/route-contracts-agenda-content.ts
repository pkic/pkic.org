import { z } from "zod";
import { requiresPermissions } from "./route-contract";
import { eventSlugParamsSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import {
  agendaContentCreateSchema,
  agendaContentPatchSchema,
  agendaContentPlacementSchema,
  agendaContentCopySchema,
  agendaContentQuerySchema,
  agendaContentsResponseSchema,
  agendaContentSchema,
  agendaContentPlacementResponseSchema,
} from "./event-agenda-content";
const base = { ...requiresPermissions("agenda:write"), tags: ["Events"] };
const params = eventSlugParamsSchema.extend({ contentId: databaseIdSchema });
const response = (schema: z.ZodType) => ({
  "200": { description: "Session content", content: { "application/json": { schema } } },
});
export const agendaContentsGetRouteSchema = {
  ...requiresPermissions("agenda:read"),
  tags: ["Events"],
  summary: "List reusable event session content",
  request: { params: eventSlugParamsSchema, query: agendaContentQuerySchema },
  responses: response(agendaContentsResponseSchema),
};
export const agendaContentCreateRouteSchema = {
  ...base,
  summary: "Create unscheduled session content",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: agendaContentCreateSchema } } },
  },
  responses: response(agendaContentSchema),
};
export const agendaContentPatchRouteSchema = {
  ...base,
  summary: "Update reusable content and its draft placements",
  request: { params, body: { required: true, content: { "application/json": { schema: agendaContentPatchSchema } } } },
  responses: response(agendaContentSchema),
};
export const agendaContentPlaceRouteSchema = {
  ...base,
  summary: "Add a repeated occurrence or independent copy",
  request: {
    params,
    body: { required: true, content: { "application/json": { schema: agendaContentPlacementSchema } } },
  },
  responses: response(agendaContentPlacementResponseSchema),
};
export const agendaOccurrencePlaceRouteSchema = {
  ...agendaContentPlaceRouteSchema,
  summary: "Repeat or independently copy an existing session occurrence",
  request: {
    ...agendaContentPlaceRouteSchema.request,
    params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema }),
  },
};
export const agendaContentCopyRouteSchema = {
  ...base,
  summary: "Copy substantive content into a new event",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: agendaContentCopySchema } } },
  },
  responses: response(agendaContentSchema),
};
