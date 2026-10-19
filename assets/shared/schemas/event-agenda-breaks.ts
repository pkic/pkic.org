import { z } from "zod";
import { utcInstantSchema, eventSlugParamsSchema } from "./api-common";
import { agendaOccurrenceFieldsSchema, agendaRevisionSchema, agendaSnapshotSchema } from "./event-agenda";
import { AGENDA_SCHEDULE_BATCH_LIMIT } from "./event-agenda-schedule";
import { authErrors, ok, requiresPermissions } from "./route-contract";
import { agendaSponsorIdsSchema } from "./event-agenda-sponsors";

const interval = z
  .object({ startAt: utcInstantSchema, endAt: utcInstantSchema })
  .strict()
  .refine((value) => value.endAt > value.startAt, { path: ["endAt"], message: "End time must follow start time" });
export const agendaBreaksCreateSchema = agendaRevisionSchema
  .extend({
    title: agendaOccurrenceFieldsSchema.shape.title,
    sponsorIds: agendaSponsorIdsSchema.optional(),
    intervals: z
      .array(interval)
      .min(1)
      .max(AGENDA_SCHEDULE_BATCH_LIMIT)
      .refine(
        (values) => new Set(values.map((value) => value.startAt)).size === values.length,
        "Choose each break interval once",
      ),
    roomIds: z
      .array(agendaOccurrenceFieldsSchema.shape.roomId.unwrap())
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, "Choose each location once")
      .nullable(),
  })
  .strict();

export const agendaBreaksCreateRouteSchema = {
  ...requiresPermissions("agenda:write"),
  tags: ["Event agenda"],
  summary: "Add a break on selected event days atomically",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: agendaBreaksCreateSchema } } },
  },
  responses: {
    ...ok("Updated agenda", agendaSnapshotSchema),
    ...authErrors({
      badRequest: "Choose valid event days and locations",
      conflict: "Agenda or event dates changed",
      notFound: "Event not found",
    }),
  },
};
