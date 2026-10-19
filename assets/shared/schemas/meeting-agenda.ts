import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { z } from "zod";
import { utcInstantSchema } from "./api-common";
export const meetingAgendaItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10000).default(""),
  durationMinutes: z.number().int().min(1).max(480),
  speakerUserIds: z.array(z.string().uuid()).max(30).default([]),
});
export const meetingAgendaItemsSchema = z
  .array(meetingAgendaItemSchema)
  .max(100)
  .superRefine((items, context) => {
    if (new Set(items.map((item) => item.id)).size !== items.length)
      context.addIssue({ code: "custom", message: "Each agenda item must have a unique identity." });
    if (items.reduce((sum, item) => sum + item.durationMinutes, 0) > 1440)
      context.addIssue({ code: "custom", message: "A meeting agenda cannot exceed one day." });
  });
export const meetingAgendaScopeSchema = z.enum(["occurrence", "future", "template"]);
export const meetingAgendaSchema = z.object({
  seriesId: z.string(),
  occurrenceId: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  writeRevision: z.number().int().nonnegative(),
  formatVersion: z.number().int().nonnegative(),
  sourceFormatVersion: z.number().int().nonnegative().default(0),
  name: z.string().trim().min(1).max(200),
  items: meetingAgendaItemsSchema,
  startsAt: utcInstantSchema.nullable(),
  endsAt: utcInstantSchema.nullable(),
  timezone: z.string(),
  exception: z.boolean(),
  publishedAt: utcInstantSchema.nullable(),
});
export const meetingAgendaSaveSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  expectedWriteRevision: z.number().int().nonnegative(),
  expectedFormatVersion: z.number().int().nonnegative(),
  scope: meetingAgendaScopeSchema,
  fromOccurrenceId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(1).max(200),
  items: meetingAgendaItemsSchema,
});
export const meetingAgendaPublishSchema = z.object({ expectedRevision: z.number().int().nonnegative() });
export function meetingAgendaTimes(startsAt: string, items: z.infer<typeof meetingAgendaItemsSchema>) {
  let instant = new Date(startsAt).getTime();
  return items.map((item) => {
    const startAt = new Date(instant).toISOString();
    instant += item.durationMinutes * 60000;
    return { ...item, startAt, endAt: new Date(instant).toISOString() };
  });
}
export type MeetingAgenda = z.infer<typeof meetingAgendaSchema>;
export const meetingFormatCatalogQuerySchema = listQuerySchema(["name"] as const);
export const meetingFormatCatalogSchema = paginatedResponseSchema(
  "formats",
  z.object({
    seriesId: z.string(),
    version: z.number().int().positive(),
    name: z.string(),
    eventName: z.string(),
    items: meetingAgendaItemsSchema,
    createdAt: utcInstantSchema,
  }),
);
export const publishedMeetingAgendaResponseSchema = z.object({ agenda: meetingAgendaSchema.nullable() });
