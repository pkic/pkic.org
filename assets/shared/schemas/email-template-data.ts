import { z } from "zod";

export const emailCustomAnswerRowSchema = z.object({ label: z.string(), displayValue: z.string() });
export type EmailCustomAnswerRow = z.infer<typeof emailCustomAnswerRowSchema>;
export const emailDayWaitlistSchema = z.object({ dayDate: z.string(), status: z.string() });
export type EmailDayWaitlist = z.infer<typeof emailDayWaitlistSchema>;
export const emailDayAttendanceSchema = z.object({
  dayLabel: z.string(),
  attendanceLabel: z.string(),
  statusLabel: z.string(),
  waitlistStatus: z.string(),
  isWaitlisted: z.boolean(),
  isWaitlistOffer: z.boolean(),
});
export type EmailDayAttendance = z.infer<typeof emailDayAttendanceSchema>;

/** Canonical item fields remain available to validation when a recipient's collection is empty. */
export function emailTemplateCollectionFields(): ReadonlyMap<string, readonly string[]> {
  return new Map<string, readonly string[]>([
    ["customAnswerRows", Object.keys(emailCustomAnswerRowSchema.shape)],
    ["dayAttendance", Object.keys(emailDayAttendanceSchema.shape)],
    ["dayWaitlist", Object.keys(emailDayWaitlistSchema.shape)],
  ]);
}
