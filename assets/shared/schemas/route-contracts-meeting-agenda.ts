import {
  meetingFormatCatalogQuerySchema,
  meetingFormatCatalogSchema,
  publishedMeetingAgendaResponseSchema,
} from "./meeting-agenda";
import { z } from "zod";
import { meetingAgendaSchema, meetingAgendaSaveSchema, meetingAgendaPublishSchema } from "./meeting-agenda";
import { authErrors, ok, requiresSession } from "./route-contract";
import { groupReferenceSchema } from "./groups";
const params = z.object({ groupId: groupReferenceSchema, seriesId: z.string().uuid() });
export const meetingAgendaGetRouteSchema = {
  tags: ["Meeting agendas"],
  summary: "Read a versioned meeting format or occurrence agenda",
  ...requiresSession(),
  request: { params, query: z.object({ occurrenceId: z.string().uuid().optional() }) },
  responses: { ...ok("Meeting agenda", meetingAgendaSchema), ...authErrors({ notFound: "Meeting not found" }) },
};
export const meetingAgendaSaveRouteSchema = {
  ...meetingAgendaGetRouteSchema,
  summary: "Update one meeting, future drafts, or the reusable format",
  request: { params, body: { content: { "application/json": { schema: meetingAgendaSaveSchema } } } },
  responses: {
    ...ok("Saved meeting agenda", meetingAgendaSchema),
    ...authErrors({ conflict: "Agenda changed or immutable", notFound: "Meeting not found" }),
  },
};
export const meetingAgendaPublishRouteSchema = {
  ...meetingAgendaSaveRouteSchema,
  summary: "Freeze one approved meeting agenda",
  request: {
    params: params.extend({ occurrenceId: z.string().uuid() }),
    body: { content: { "application/json": { schema: meetingAgendaPublishSchema } } },
  },
};
export const meetingFormatCatalogRouteSchema = {
  ...meetingAgendaGetRouteSchema,
  summary: "Browse accessible reusable meeting format versions",
  request: { params: params.pick({ groupId: true }), query: meetingFormatCatalogQuerySchema },
  responses: { ...ok("Meeting formats", meetingFormatCatalogSchema), ...authErrors({ notFound: "Group not found" }) },
};
export const publishedMeetingAgendaRouteSchema = {
  ...meetingAgendaGetRouteSchema,
  summary: "Read approved meeting agenda as a participant",
  request: { params: params.extend({ occurrenceId: z.string().uuid() }) },
  responses: {
    ...ok("Approved meeting agenda", publishedMeetingAgendaResponseSchema),
    ...authErrors({ notFound: "Meeting not found" }),
  },
};
