import { z } from "zod";
import {
  attendanceAttemptQuerySchema,
  attendanceScopeQuerySchema,
  eventAttendancePeopleQuerySchema,
} from "./event-attendance-reporting";
export const attendancePeopleExportQuerySchema = eventAttendancePeopleQuerySchema
  .omit({ limit: true, offset: true })
  .strict();
export const attendanceAttemptsExportQuerySchema = attendanceAttemptQuerySchema
  .omit({ limit: true, offset: true })
  .strict();
export const attendanceSummaryExportQuerySchema = attendanceScopeQuerySchema.strict();
export const attendanceExportKindSchema = z.enum(["people", "attempts", "summary"]);
export const attendanceExportLimits = {
  people: 10000,
  attempts: 100000,
  summary: 1,
  maxBytes: 20 * 1024 * 1024,
} as const;
