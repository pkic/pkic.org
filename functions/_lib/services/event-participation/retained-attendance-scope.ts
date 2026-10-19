import type { z } from "zod";
import {
  attendanceSummarySchema,
  type attendanceScopeQuerySchema,
} from "../../../../assets/shared/schemas/event-attendance-reporting";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { attendanceReportContext, type AttendanceReportContext } from "./attendance-report-context";

/** Binds retained populations to the actual fenced run, never another event's or an older completed run. */
export async function retainedAttendanceScope(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof attendanceScopeQuerySchema>,
  validatedContext?: AttendanceReportContext,
) {
  const key = JSON.stringify([query.dayDate ?? null, query.occurrenceId ?? null, query.attendanceMode ?? null]);
  const baseKey = JSON.stringify([null, query.occurrenceId ?? null, query.attendanceMode ?? null]);
  const row = await first<{
    activeRunId: string | null;
    purgedAt: string | null;
    runId: string | null;
    phase: string | null;
    summaryJson: string | null;
    baseJson: string | null;
  }>(
    db,
    `
    SELECT state.active_run_id AS activeRunId,state.purged_at AS purgedAt,run.id AS runId,run.phase,
      exact_grain.summary_json AS summaryJson,base_grain.summary_json AS baseJson
    FROM event_evidence_retention_state state
    LEFT JOIN event_evidence_retention_runs run ON run.event_id=state.event_id AND (
      (run.id=state.active_run_id AND run.status='running') OR
      (state.active_run_id IS NULL AND state.purged_at=run.completed_at AND run.status='complete'))
    LEFT JOIN event_evidence_retention_grains exact_grain ON exact_grain.run_id=run.id AND exact_grain.scope_key=?
    LEFT JOIN event_evidence_retention_grains base_grain ON base_grain.run_id=run.id AND base_grain.scope_key=?
    WHERE state.event_id=? ORDER BY run.started_at DESC,run.id DESC LIMIT 1`,
    [key, baseKey, eventId],
  );
  if (!row || (!row.activeRunId && !row.purgedAt)) return null;
  const context = validatedContext ?? (await attendanceReportContext(db, eventId, query));
  if (row.summaryJson && row.runId) {
    const summary = attendanceSummarySchema.parse(JSON.parse(row.summaryJson));
    summary.sync.scannerReconciliation.sourceState = row.purgedAt ? "purged" : "retention_in_progress";
    return { runId: row.runId, summary, empty: false, scopeKey: key };
  }
  if (!row.runId || row.phase === "aggregates")
    throw new AppError(
      409,
      "EVIDENCE_RETENTION_IN_PROGRESS",
      "Evidence removal is preparing complete retained attendance populations. Try again after that step completes.",
    );
  if (!query.dayDate || !row.baseJson)
    throw new AppError(
      404,
      "RETAINED_ATTENDANCE_SCOPE_NOT_FOUND",
      "No retained attendance population exists for this scope.",
    );
  // Enumeration covered every captured observation/attempt and every grant day before deletion began.
  // Absence proves zero selected-day rows; it cannot establish a calendar date for uncaptured evidence.
  const base = attendanceSummarySchema.parse(JSON.parse(row.baseJson));
  const summary = attendanceSummarySchema.parse({
    ...base,
    dayDate: query.dayDate,
    currentIntent: {
      timeZone: context.timeZone,
      startAt: context.intentStartAt,
      endAt: context.intentEndAt,
      dayIntervalAvailable: context.intentStartAt !== null,
    },
    observed: Object.fromEntries(Object.keys(base.observed).map((key) => [key, 0])),
    attempts: Object.fromEntries(Object.keys(base.attempts).map((key) => [key, 0])),
    classification: {
      ...base.classification,
      capturedTimeZones: 0,
      mixedTimeZones: false,
      dayFilterExcludesMissing: true,
    },
    sync: {
      ...base.sync,
      knownGrants: 0,
      unclosedGrants: 0,
      unclosedDevices: 0,
      revokedUnclosedGrants: 0,
      expiredUnclosedGrants: 0,
      reconciledAdmissions: 0,
      heldUnspentSlots: 0,
      lastReceivedAt: null,
      scannerReconciliation: {
        ...base.sync.scannerReconciliation,
        sourceState: row.purgedAt ? "purged" : "retention_in_progress",
      },
    },
  });
  return { runId: row.runId, summary, empty: true, scopeKey: key };
}
