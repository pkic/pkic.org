import { attendanceRowCaptureContext } from "./attendance-report-context";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import {
  attendanceExportKindSchema,
  attendanceExportLimits,
  attendancePeopleExportQuerySchema,
  attendanceAttemptsExportQuerySchema,
  attendanceSummaryExportQuerySchema,
} from "../../../../assets/shared/schemas/event-attendance-exports";
import {
  eventAttendancePersonSchema,
  attendanceAttemptSchema,
} from "../../../../assets/shared/schemas/event-attendance-reporting";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { all, first } from "../../db/queries";
import { permissionsAuthorizationEvidence, guardPermissionDatabase } from "../../auth/permissions";
import { AppError } from "../../errors";
import { encodeBoundedCsv } from "../../csv";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { attendancePeopleQuery } from "./attendance-people-report";
import { attendanceAttemptsQuery } from "./attendance-attempt-report";
import { eventAttendanceSummary } from "./attendance-summary";
import { eventScannerReconciliation } from "./scanner-reconciliation";
import { assertEventContactAccess, eventContactAccessSql } from "./evidence-retention";
import type { z } from "zod";

type ExportKind = z.infer<typeof attendanceExportKindSchema>;
const peopleColumns = [
  "userId",
  "displayName",
  "firstObservedAt",
  "lastObservedAt",
  "observationCount",
  "missingContextObservations",
  "capturedTimeZones",
  "physicalObservations",
  "virtualObservations",
  "importedObservations",
  "providerAssertedVirtualObservations",
  "reservedSessions",
  "savedSessions",
  "approvalPendingSessions",
] as const;
const attemptColumns = [
  "id",
  "userId",
  "displayName",
  "occurrenceId",
  "operatorUserId",
  "deviceId",
  "action",
  "outcome",
  "reason",
  "exceptionReason",
  "admissionDecision",
  "observedAt",
  "receivedAt",
  "clockVerification",
  "offlineReconciled",
] as const;
async function authorized(db: DatabaseLike, eventId: string, actor: AuthAdmin) {
  const evidence = permissionsAuthorizationEvidence(actor, [
    { permission: "agenda:attendance_read", context: { type: "event", id: eventId } },
  ]);
  if (!(await first(db, evidence.sql, [...evidence.bindings])))
    throw new AppError(403, "ATTENDANCE_EXPORT_PERMISSION_CHANGED", "Your attendance reporting permission changed.");
  return evidence;
}
/** One complete bounded SQL population; no mutable offset-page traversal or partial CSV. */
async function identityRows(
  db: DatabaseLike,
  eventId: string,
  actor: AuthAdmin,
  built: { sql: string; bindings: unknown[]; order: string },
  maxRows: number,
  columns: readonly string[],
) {
  const evidence = await authorized(db, eventId, actor);
  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT ${columns.map((column) => `export_row.${column}`).join(",")},COUNT(*) OVER() AS exportTotal FROM (${built.sql}) export_row WHERE EXISTS(${evidence.sql}) ORDER BY ${built.order} LIMIT ?`,
    [...built.bindings, ...evidence.bindings, maxRows + 1],
  );
  if (rows.length > maxRows || Number(rows[0]?.exportTotal ?? 0) > maxRows)
    throw new AppError(
      413,
      "ATTENDANCE_EXPORT_ROW_LIMIT",
      "Narrow the day or session scope; this export exceeds its row limit.",
    );
  await authorized(db, eventId, actor);
  await assertEventContactAccess(db, eventId);
  return rows;
}
function flatten(value: Record<string, unknown>, prefix = ""): Array<[string, unknown]> {
  return Object.entries(value).flatMap(([key, item]) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? flatten(item as Record<string, unknown>, `${prefix}${key}.`)
      : [[`${prefix}${key}`, item]],
  );
}
export async function exportAttendance(
  db: DatabaseLike,
  eventId: string,
  actor: AuthAdmin,
  kind: ExportKind,
  raw: unknown,
  limits: { people: number; attempts: number; maxBytes: number } = attendanceExportLimits,
) {
  const generatedAt = nowIso();
  await authorized(db, eventId, actor);
  const summary =
    kind === "summary"
      ? await eventAttendanceSummary(db, eventId, attendanceSummaryExportQuerySchema.parse(raw))
      : null;
  const reconciliation = summary?.sync.scannerReconciliation ?? (await eventScannerReconciliation(db, eventId));
  let rows: readonly unknown[][];
  let query: z.infer<typeof attendanceSummaryExportQuerySchema>;
  let rowCount: number;
  if (kind === "summary" && summary) {
    query = attendanceSummaryExportQuerySchema.parse(raw);
    await authorized(db, eventId, actor);
    const entries = flatten(summary as unknown as Record<string, unknown>);
    rows = [entries.map(([key]) => key), entries.map(([, value]) => value)];
    rowCount = 1;
  } else if (kind === "people") {
    const filters = attendancePeopleExportQuerySchema.parse(raw);
    query = filters;
    const built = await attendancePeopleQuery(db, eventId, filters);
    const data = await identityRows(db, eventId, actor, built, limits.people, peopleColumns);
    const people = data.map((row) => eventAttendancePersonSchema.parse(row));
    rows = [
      [
        ...peopleColumns,
        "deviceBacklog",
        "completeness",
        "clockVerification",
        "presenceDuration",
        "intentDayBasis",
        "intentTimeZone",
        "intentStartAt",
        "intentEndAt",
        "intentDayIntervalAvailable",
      ],
      ...people.map((row) => [
        ...peopleColumns.map((column) => row[column]),
        reconciliation.deviceBacklog,
        "not_established",
        "unverified",
        "not_established",
        "current_published_schedule_timezone",
        built.currentIntent.timeZone,
        built.currentIntent.startAt,
        built.currentIntent.endAt,
        built.currentIntent.dayIntervalAvailable,
      ]),
    ];
    rowCount = people.length;
  } else {
    const filters = attendanceAttemptsExportQuerySchema.parse(raw);
    query = filters;
    const data = await identityRows(
      db,
      eventId,
      actor,
      await attendanceAttemptsQuery(db, eventId, filters),
      limits.attempts,
      [
        ...attemptColumns.filter((column) => column !== "clockVerification"),
        "capture_day_date",
        "capture_time_zone",
        "capture_publication_revision",
        "capture_context_source",
      ],
    );
    const attempts = data.map((row) =>
      attendanceAttemptSchema.parse({
        captureContext: attendanceRowCaptureContext(row),
        ...row,
        clockVerification: "unverified",
        offlineReconciled: Boolean(row.offlineReconciled),
      }),
    );
    rows = [
      [
        ...attemptColumns,
        "captureState",
        "captureDayDate",
        "captureTimeZone",
        "capturePublicationRevision",
        "captureContextSource",
        "missingContextReason",
        "deviceBacklog",
        "completeness",
      ],
      ...attempts.map((row) => [
        ...attemptColumns.map((column) => row[column]),
        row.captureContext.state,
        ...(row.captureContext.state === "captured"
          ? [
              row.captureContext.dayDate,
              row.captureContext.timeZone,
              row.captureContext.publicationRevision,
              row.captureContext.source,
              null,
            ]
          : [null, null, null, null, row.captureContext.reason]),
        reconciliation.deviceBacklog,
        "not_established",
      ]),
    ];
    rowCount = attempts.length;
  }
  if (kind !== "summary") {
    const metadata = [
      "captured_calendar_date",
      eventId,
      query.dayDate ?? "",
      query.occurrenceId ?? "",
      query.attendanceMode ?? "",
      generatedAt,
      reconciliation.coverage,
      reconciliation.knownEpochs,
      reconciliation.openEpochs,
      reconciliation.closingEpochs,
      reconciliation.closedEpochs,
      reconciliation.missingDeclaredReceipts,
      reconciliation.unknownHighWaterEpochs,
      reconciliation.untrackedAttempts,
      reconciliation.unclosedGrants,
    ];
    rows = rows.map((row, index) =>
      index === 0
        ? [
            ...row,
            "dayClassificationBasis",
            "eventId",
            "scopeDayDate",
            "scopeOccurrenceId",
            "scopeAttendanceMode",
            "generatedAt",
            "scannerCoverage",
            "scannerKnownEpochs",
            "scannerOpenEpochs",
            "scannerClosingEpochs",
            "scannerClosedEpochs",
            "scannerMissingDeclaredReceipts",
            "scannerUnknownHighWaterEpochs",
            "scannerUntrackedAttempts",
            "scannerUnclosedGrants",
          ]
        : [...row, ...metadata],
    );
  }
  const csv = encodeBoundedCsv(rows, limits.maxBytes);
  await authorized(db, eventId, actor);
  if (kind !== "summary") await assertEventContactAccess(db, eventId);
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission: "agenda:attendance_read", context: { type: "event", id: eventId } }],
    () => new AppError(403, "ATTENDANCE_EXPORT_PERMISSION_CHANGED", "Your attendance reporting permission changed."),
  );
  await guarded.batch([
    ...(kind !== "summary"
      ? [
          prepareAuthorizationGuard(guarded, {
            sql: `SELECT 1 FROM events export_event WHERE export_event.id=? AND ${eventContactAccessSql("export_event.id")}`,
            bindings: [eventId],
          }),
        ]
      : []),
    prepareScopedAuditLog(
      guarded,
      { type: "event", id: eventId },
      "admin",
      actor.id,
      "agenda.attendance.exported",
      "event",
      eventId,
      {
        kind,
        rowCount,
        generatedAt,
        dayDate: query.dayDate ?? null,
        occurrenceId: query.occurrenceId ?? null,
        attendanceMode: query.attendanceMode ?? null,
        searchApplied: !!(raw as { q?: string }).q,
        deviceBacklog: reconciliation.deviceBacklog,
        scannerReconciliation: reconciliation,
        completeness: "not_established",
      },
    ),
  ]);
  return { csv, rowCount, generatedAt };
}
