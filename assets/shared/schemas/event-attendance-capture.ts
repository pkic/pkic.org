import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { eventDayDateSchema } from "./event-read-models";
import { instantToDateTimeLocal } from "../timezone";
import { nativeEventCaptureProfileSchema } from "../native-event-capture";

/** A timezone identifier, never a viewer offset or ambiguous local abbreviation. */
export const attendanceCaptureTimeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((zone) => {
    if (zone !== "UTC" && !zone.includes("/")) return false;
    try {
      instantToDateTimeLocal("2000-01-01T00:00:00.000Z", zone);
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA timezone identifier.");
export const attendanceCaptureSourceSchema = z.enum([
  "published_manifest",
  "offline_grant",
  "server_receipt",
  "import_review",
  "native_event_manifest",
]);
export const nativeEventCaptureContextSchema = z
  .object({ profileKey: nativeEventCaptureProfileSchema, timeZone: attendanceCaptureTimeZoneSchema })
  .strict();
export type NativeEventCaptureContext = z.infer<typeof nativeEventCaptureContextSchema>;
/** Compose these fields into the scan and sponsor capture request schemas. */
const captureRequestFieldsSchema = z
  .object({
    capturePublicationRevision: z.number().int().nonnegative().nullable().optional(),
    nativeEventContext: nativeEventCaptureContextSchema.optional(),
  })
  .strict();
/** Composed request schemas retain this same refinement after spreading canonical fields. */
export function refineAttendanceCaptureIntent(
  value: z.infer<typeof captureRequestFieldsSchema> & {
    occurrenceId?: string | null;
    roomId?: string | null;
    offlineRight?: unknown;
  },
  validation: z.RefinementCtx,
) {
  if (!value.nativeEventContext) return;
  if (value.capturePublicationRevision !== null)
    validation.addIssue({
      code: "custom",
      path: ["capturePublicationRevision"],
      message: "Native event context requires an explicitly absent conference publication.",
    });
  for (const field of ["occurrenceId", "roomId", "offlineRight"] as const)
    if (value[field] != null)
      validation.addIssue({
        code: "custom",
        path: [field],
        message: "Native calendar capture applies only to event-wide observations.",
      });
}
export const attendanceCaptureRequestFieldsSchema =
  captureRequestFieldsSchema.superRefine(refineAttendanceCaptureIntent);
const captured = z
  .object({
    state: z.literal("captured"),
    dayDate: eventDayDateSchema,
    timeZone: attendanceCaptureTimeZoneSchema,
    publicationRevision: z.number().int().nonnegative().nullable(),
    source: attendanceCaptureSourceSchema,
  })
  .strict()
  .superRefine((context, validation) => {
    if (
      (context.source === "published_manifest" || context.source === "offline_grant") &&
      context.publicationRevision === null
    )
      validation.addIssue({
        code: "custom",
        path: ["publicationRevision"],
        message: "Published capture context requires its original publication revision.",
      });
    if (context.source === "native_event_manifest" && context.publicationRevision !== null)
      validation.addIssue({
        code: "custom",
        path: ["publicationRevision"],
        message: "Native event calendar capture has no conference publication revision.",
      });
  });
export const attendanceCaptureContextSchema = z.discriminatedUnion("state", [
  captured,
  z.object({ state: z.literal("missing"), reason: z.enum(["not_captured", "incomplete_capture"]) }).strict(),
]);
export type AttendanceCaptureContext = z.infer<typeof attendanceCaptureContextSchema>;
export type CapturedAttendanceContext = z.infer<typeof captured>;
export type AttendanceCaptureRequestFields = z.infer<typeof attendanceCaptureRequestFieldsSchema>;

/** UTC observation time keeps its meaning; this derives only its immutable event-calendar date. */
export function captureAttendanceContext(
  observedAt: string,
  input: Omit<CapturedAttendanceContext, "state" | "dayDate">,
): CapturedAttendanceContext {
  const instant = utcInstantSchema.parse(observedAt);
  const timeZone = attendanceCaptureTimeZoneSchema.parse(input.timeZone);
  return captured.parse({
    ...input,
    state: "captured",
    timeZone,
    dayDate: instantToDateTimeLocal(instant, timeZone).slice(0, 10),
  });
}
/** Null legacy columns remain explicit; current event settings are never a historical backfill. */
export function storedAttendanceCaptureContext(row: {
  capture_day_date: string | null;
  capture_time_zone: string | null;
  capture_publication_revision: number | null;
  capture_context_source: string | null;
}): AttendanceCaptureContext {
  if (
    row.capture_day_date === null &&
    row.capture_time_zone === null &&
    row.capture_publication_revision === null &&
    row.capture_context_source === null
  )
    return { state: "missing", reason: "not_captured" };
  const result = captured.safeParse({
    state: "captured",
    dayDate: row.capture_day_date,
    timeZone: row.capture_time_zone,
    publicationRevision: row.capture_publication_revision,
    source: row.capture_context_source,
  });
  return result.success ? result.data : { state: "missing", reason: "incomplete_capture" };
}
