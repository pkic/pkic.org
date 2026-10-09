import { sessionMaterialVersionsQuerySchema, sessionMaterialVersionsSchema } from "./event-session-history";
import {
  sessionHistoryMetadataSchema,
  sessionAppearanceChoicesSchema,
  sessionAppearanceChoicesQuerySchema,
} from "./event-session-history";
import { eventSlugParamsSchema } from "./api-common";
import { z } from "zod";
import {
  agendaSettingsSchema,
  agendaPeopleQuerySchema,
  agendaPeopleListSchema,
  agendaImportSchema,
  agendaImportResponseSchema,
  agendaSnapshotSchema,
  agendaRoomCreateSchema,
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaStaffingSchema,
  agendaAllocationSchema,
  agendaRevisionSchema,
  agendaPublicationSchema,
  agendaOccurrenceQuerySchema,
  agendaOccurrenceListSchema,
} from "./event-agenda";
import { ok, authErrors, requiresPermissions } from "./route-contract";
const responses = {
  ...ok("Updated agenda", agendaSnapshotSchema),
  ...authErrors({
    badRequest: "Invalid agenda request",
    conflict: "Schedule or revision conflict",
    notFound: "Event or session not found",
  }),
};
const common = { tags: ["Event agenda"], responses, ...requiresPermissions("agenda:write") };
export const agendaGetRouteSchema = {
  ...common,
  summary: "Read organizer agenda",
  request: { params: eventSlugParamsSchema },
  ...requiresPermissions("agenda:read"),
};
export const agendaOccurrencesGetRouteSchema = {
  ...common,
  summary: "List agenda occurrences",
  request: { params: eventSlugParamsSchema, query: agendaOccurrenceQuerySchema },
  responses: { ...responses, ...ok("Agenda occurrences", agendaOccurrenceListSchema) },
  ...requiresPermissions("agenda:read"),
};
export const agendaRoomCreateRouteSchema = {
  ...common,
  summary: "Create agenda room",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: agendaRoomCreateSchema } } },
  },
};
export const agendaOccurrenceCreateRouteSchema = {
  ...common,
  summary: "Create agenda occurrence",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: agendaOccurrenceCreateSchema } } },
  },
};
export const agendaOccurrencePatchRouteSchema = {
  ...common,
  summary: "Edit agenda occurrence",
  request: {
    params: eventSlugParamsSchema.extend({ occurrenceId: z.string().min(1) }),
    body: { content: { "application/json": { schema: agendaOccurrencePatchSchema } } },
  },
};
export const agendaStaffingRouteSchema = {
  ...common,
  summary: "Save shifts and pinned duties",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: agendaStaffingSchema } } },
  },
};
export const agendaAllocationRouteSchema = {
  ...common,
  summary: "Allocate shift duties",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: agendaAllocationSchema } } },
  },
};
export const agendaPublicationRouteSchema = {
  ...common,
  summary: "Freeze public agenda revision",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: agendaPublicationSchema } } },
  },
};

export const agendaImportRouteSchema = {
  ...common,
  summary: "Preview or import accepted proposals and historical occurrences",
  request: { params: eventSlugParamsSchema, body: { content: { "application/json": { schema: agendaImportSchema } } } },
  responses: { ...responses, ...ok("Import result", agendaImportResponseSchema) },
};

export const agendaPeopleRouteSchema = {
  ...common,
  summary: "Search event speakers and staff",
  request: { params: eventSlugParamsSchema, query: agendaPeopleQuerySchema },
  responses: { ...responses, ...ok("Event people", agendaPeopleListSchema) },
};

export const agendaSettingsRouteSchema = {
  ...common,
  summary: "Configure agenda travel buffers",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: agendaSettingsSchema } } },
  },
};

export const agendaSessionHistoryRouteSchema = {
  ...common,
  summary: "Correct session archive credits and material releases",
  request: {
    params: eventSlugParamsSchema.extend({ occurrenceId: z.string().min(1) }),
    body: {
      content: {
        "application/json": { schema: agendaRevisionSchema.extend({ history: sessionHistoryMetadataSchema }) },
      },
    },
  },
};

export const agendaRoomUpdateRouteSchema = {
  ...agendaRoomCreateRouteSchema,
  summary: "Update agenda location",
  request: {
    ...agendaRoomCreateRouteSchema.request,
    params: eventSlugParamsSchema.extend({ roomId: z.string().min(1).max(200) }),
  },
};

export const agendaHistoryIdentitiesRouteSchema = {
  ...common,
  summary: "Choose historical speaker acting representation",
  request: {
    params: eventSlugParamsSchema.extend({ occurrenceId: z.string().min(1) }),
    query: sessionAppearanceChoicesQuerySchema,
  },
  responses: { ...responses, ...ok("Speaker acting identities", sessionAppearanceChoicesSchema) },
  ...requiresPermissions("agenda:read"),
};

export const agendaHistoryMaterialsRouteSchema = {
  ...agendaHistoryIdentitiesRouteSchema,
  summary: "Choose a reviewed session presentation version",
  request: { ...agendaHistoryIdentitiesRouteSchema.request, query: sessionMaterialVersionsQuerySchema },
  responses: { ...responses, ...ok("Session uploaded versions", sessionMaterialVersionsSchema) },
};
