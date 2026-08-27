import { z } from "zod";
import { successResponseSchema, termKeyPattern, trimmedString, versionPattern } from "./api-common";
import { addDuplicateStringIssues } from "./refinements";

/**
 * Configuration contracts shared by every event-management surface. These are
 * intentionally not admin-prefixed: terms and attendance days belong to the
 * event domain, while authorization belongs to the route that exposes them.
 */
export const eventTermInputSchema = z.object({
  termKey: z.string().trim().regex(termKeyPattern),
  version: z.string().trim().regex(versionPattern),
  required: z.boolean().default(true),
  contentRef: trimmedString(1, 500).optional(),
  displayText: trimmedString(3, 4000),
  helpText: trimmedString(3, 2000).optional(),
});

export const eventTermsReplaceSchema = z
  .object({
    attendee: z.array(eventTermInputSchema).max(40).default([]),
    speaker: z.array(eventTermInputSchema).max(40).default([]),
    presentation: z.array(eventTermInputSchema).max(40).default([]),
  })
  .superRefine((value, ctx) => {
    for (const audience of ["attendee", "speaker", "presentation"] as const) {
      addDuplicateStringIssues(value[audience], ctx, {
        value: (term) => `${term.termKey}:${term.version}`,
        path: (index) => [audience, index, "termKey"],
        label: "Term version",
      });
    }
  });
export type EventTermsReplaceInput = z.infer<typeof eventTermsReplaceSchema>;

export const eventTermSchema = z.object({
  id: z.string(),
  audience_type: z.enum(["attendee", "speaker", "presentation"]),
  term_key: z.string(),
  version: z.string(),
  required: z.number(),
  content_ref: z.string().nullable(),
  display_text: z.string().nullable(),
  help_text: z.string().nullable(),
});

export const eventTermsResponseSchema = z.object({
  terms: z.object({
    attendee: z.array(eventTermSchema),
    speaker: z.array(eventTermSchema),
    presentation: z.array(eventTermSchema),
  }),
});
export const eventTermsReplaceResponseSchema = successResponseSchema;

export const eventAttendanceOptionSchema = z.object({
  value: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z_][a-z0-9_]*$/),
  label: trimmedString(1, 80),
  capacity: z.number().int().positive().nullable().optional(),
});
export type EventAttendanceOption = z.infer<typeof eventAttendanceOptionSchema>;

export const eventDayInputSchema = z
  .object({
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    label: trimmedString(1, 200).optional(),
    startTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    endTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    attendanceOptions: z.array(eventAttendanceOptionSchema).max(20).default([]),
  })
  .superRefine((value, ctx) => {
    addDuplicateStringIssues(value.attendanceOptions, ctx, {
      value: (option) => option.value,
      path: (index) => ["attendanceOptions", index, "value"],
      label: "Attendance option",
    });
  });

export const eventDaysReplaceSchema = z
  .object({ days: z.array(eventDayInputSchema).max(31) })
  .superRefine((value, ctx) => {
    addDuplicateStringIssues(value.days, ctx, {
      value: (day) => day.date,
      path: (index) => ["days", index, "date"],
      label: "Event day",
    });
  });
export type EventDaysReplaceInput = z.infer<typeof eventDaysReplaceSchema>;

/** Canonical configured event-day projection shared by management and attendance views. */
export const eventDayResponseSchema = z.object({
  id: z.string(),
  date: z.string(),
  label: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  sortOrder: z.number(),
  attendanceOptions: z.array(eventAttendanceOptionSchema),
  attendanceCounts: z.record(z.string(), z.number()),
});
export type EventDayResponse = z.infer<typeof eventDayResponseSchema>;

export const eventDaysResponseSchema = z.object({
  days: z.array(eventDayResponseSchema),
});
export type EventDay = EventDayResponse;
export const eventDaysReplaceResponseSchema = successResponseSchema.extend({ skipped: z.array(z.string()) });
