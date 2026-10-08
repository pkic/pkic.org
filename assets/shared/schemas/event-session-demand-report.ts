import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { eventDayDateSchema } from "./event-read-models";
import { agendaAdmissionPolicySchema, agendaAccessPolicySchema } from "./event-agenda";
import { sessionDemandCountsSchema } from "./event-session-demand";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const sessionDemandReportSortColumns = [
  "title",
  "startAt",
  "preferences",
  "confirmed",
  "pending",
  "waitlisted",
  "occupied",
  "sessionCapacity",
] as const;
export const sessionDemandReportQuerySchema = listQuerySchema(sessionDemandReportSortColumns)
  .extend({
    dayDate: eventDayDateSchema.optional(),
    occurrenceId: databaseIdSchema.optional(),
    attendanceMode: z.enum(["physical", "remote"]).optional(),
    roomId: databaseIdSchema.optional(),
    admissionPolicy: agendaAdmissionPolicySchema.optional(),
    accessPolicy: agendaAccessPolicySchema.optional(),
  })
  .strict();
export const sessionDemandReportExportQuerySchema = sessionDemandReportQuerySchema.omit({ limit: true, offset: true });
export const sessionDemandReportLocationSchema = z
  .object({
    id: databaseIdSchema,
    name: z.string(),
    capacity: z.number().int().nonnegative().nullable(),
    occupied: z.number().int().nonnegative(),
  })
  .strict();
export const sessionDemandReportRowSchema = sessionDemandCountsSchema
  .extend({
    occurrenceId: databaseIdSchema,
    title: z.string(),
    startAt: utcInstantSchema.nullable(),
    endAt: utcInstantSchema.nullable(),
    admissionPolicy: agendaAdmissionPolicySchema,
    accessPolicy: agendaAccessPolicySchema,
    attendanceMode: z.enum(["physical", "remote"]),
    /** Distinct confirmed attendees, operational people and active organizer holds. */
    occupied: z.number().int().nonnegative(),
    /** Authored limit for this attendance mode; physical rooms retain separate limits below. */
    sessionCapacity: z.number().int().nonnegative().nullable(),
    locations: z.array(sessionDemandReportLocationSchema).max(20),
  })
  .strict();
export const sessionDemandReportMetadataSchema = z
  .object({
    eventId: databaseIdSchema,
    scheduleBasis: z.literal("published_agenda"),
    publishedRevision: z.number().int().nonnegative().nullable(),
    timeZone: z.string(),
    dayDate: eventDayDateSchema.nullable(),
    generatedAt: utcInstantSchema,
  })
  .strict();
export const sessionDemandReportResponseSchema = paginatedResponseSchema("sessions", sessionDemandReportRowSchema)
  .extend({ report: sessionDemandReportMetadataSchema })
  .strict();
export const sessionDemandReportExportLimits = { maxRows: 10_000, maxBytes: 20 * 1024 * 1024 } as const;
export type SessionDemandReportQuery = z.infer<typeof sessionDemandReportQuerySchema>;
export type SessionDemandReportExportQuery = z.infer<typeof sessionDemandReportExportQuerySchema>;
export type SessionDemandReportRow = z.infer<typeof sessionDemandReportRowSchema>;
export type SessionDemandReportResponse = z.infer<typeof sessionDemandReportResponseSchema>;
