import { z } from "zod";
import { eventIdSchema, termKeyPattern, versionPattern } from "./api-common";

/** Canonical public event identity embedded in event workflow responses. */
export const eventSummarySchema = z.object({
  id: eventIdSchema,
  slug: z.string(),
  name: z.string(),
});

/** Canonical configurable event term returned to attendee and speaker frontends. */
export const requiredTermSchema = z.object({
  termKey: z.string().trim().regex(termKeyPattern),
  version: z.string().trim().regex(versionPattern),
  required: z.boolean(),
  contentRef: z.string().nullable(),
  displayText: z.string().nullable().optional(),
  helpText: z.string().nullable().optional(),
});

export const eventDayDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/);

/** Configurable per-day attendance option identifier. */
export const eventAttendanceTypeValueSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z_][a-z0-9_]*$/, "Invalid attendance type");

export const eventAttendanceOptionSchema = z.object({
  value: eventAttendanceTypeValueSchema,
  label: z.string(),
  spotsRemainingPercent: z.number().nullable().optional(),
});

/** Shared event-day read model used by registration and form APIs. */
export const eventDayReadModelSchema = z.object({
  dayDate: eventDayDateSchema,
  label: z.string().nullable(),
  inPersonCapacity: z.number().int().nonnegative().nullable(),
  sortOrder: z.number().int(),
  attendanceOptions: z.array(eventAttendanceOptionSchema),
});

export type EventSummary = z.infer<typeof eventSummarySchema>;
export type RequiredTerm = z.infer<typeof requiredTermSchema>;
export type EventDayReadModel = z.infer<typeof eventDayReadModelSchema>;
