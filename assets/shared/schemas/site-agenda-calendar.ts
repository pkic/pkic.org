import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { agendaOccurrenceSchema, agendaSnapshotSchema } from "./event-agenda";

export const PUBLIC_AGENDA_CANCELLATION_DAYS = 90;
export const PUBLIC_AGENDA_CALENDAR_ENTRY_LIMIT = 10000;
const entry = z.object({
  occurrenceId: agendaOccurrenceSchema.shape.id,
  sequence: z.number().int().nonnegative().max(2147483647),
  updatedAt: utcInstantSchema,
  startAt: utcInstantSchema,
  endAt: utcInstantSchema,
});
export const publicAgendaCalendarEntrySchema = z
  .discriminatedUnion("status", [
    entry
      .extend({
        status: z.literal("confirmed"),
        agendaPath: agendaSnapshotSchema.shape.publicAgendaPath.unwrap(),
        title: agendaOccurrenceSchema.shape.title,
        description: agendaOccurrenceSchema.shape.description,
        speakers: z.array(z.string()).max(1000),
        locations: z.array(z.string()).max(20),
        track: agendaOccurrenceSchema.shape.track,
      })
      .strict(),
    entry.extend({ status: z.literal("canceled") }).strict(),
  ])
  .refine((value) => value.endAt > value.startAt, "Calendar end must follow start");

/** Approved history is the basis; it does not attest that each revision was served. */
export const publicAgendaCalendarSchema = z
  .object({
    basis: z.literal("approved_history"),
    name: z.string(),
    timeZone: agendaSnapshotSchema.shape.timeZone,
    agendaPath: agendaSnapshotSchema.shape.publicAgendaPath.unwrap(),
    entries: z
      .array(publicAgendaCalendarEntrySchema)
      .max(PUBLIC_AGENDA_CALENDAR_ENTRY_LIMIT)
      .refine(
        (items) => new Set(items.map((item) => item.occurrenceId)).size === items.length,
        "Duplicate calendar occurrence",
      ),
  })
  .strict();
export type PublicAgendaCalendarEntry = z.infer<typeof publicAgendaCalendarEntrySchema>;
export type PublicAgendaCalendar = z.infer<typeof publicAgendaCalendarSchema>;
