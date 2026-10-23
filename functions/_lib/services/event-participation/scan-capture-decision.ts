import type { EventScanRequest } from "../../../../assets/shared/schemas/event-participation-scanning";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { AppError } from "../../errors";
import { prepareAttendanceCapture } from "./attendance-capture-context";

/** Resolve after recognizing the badge so unavailable history still leaves an unsuccessful attempt. */
export function prepareScanCaptureDecision(
  db: DatabaseLike,
  eventId: string,
  scan: EventScanRequest,
  evidenceOnly = false,
) {
  const read = prepareAttendanceCapture(
    db,
    eventId,
    {
      observedAt: scan.observedAt,
      operatorUserId: scan.operatorUserId,
      deviceId: scan.deviceId,
      occurrenceId: scan.occurrenceId,
      roomId: scan.roomId,
      offlineRight: scan.offlineRight,
      capturePublicationRevision: scan.capturePublicationRevision,
      nativeEventContext: scan.nativeEventContext,
    },
    !scan.offlineRight && !evidenceOnly,
  );
  return {
    statements: read.statements,
    decode(results: D1StatementResult[]) {
      try {
        const { resolved, operational } = read.decode(results);
        const context = resolved.context;
        const missingPublication =
          scan.capturePublicationRevision === null &&
          !scan.offlineRight &&
          !(context.state === "captured" && context.source === "native_event_manifest");
        return {
          ...resolved,
          values:
            context.state === "captured"
              ? [context.dayDate, context.timeZone, context.publicationRevision, context.source]
              : [null, null, null, null],
          sql: missingPublication
            ? "0=1"
            : `EXISTS(${resolved.contextEvidence.sql})${operational ? ` AND EXISTS(${operational.sql})` : ""}`,
          bindings: missingPublication ? [] : [...resolved.contextEvidence.bindings, ...(operational?.bindings ?? [])],
        };
      } catch (error) {
        if (!(error instanceof AppError) || !error.code.startsWith("ATTENDANCE_CAPTURE_CONTEXT_")) throw error;
        return {
          context: { state: "missing" as const, reason: "not_captured" as const },
          admissionDayDate: null,
          values: [null, null, null, null],
          sql: "0=1",
          bindings: [],
        };
      }
    },
  };
}

export async function scanCaptureDecision(
  db: DatabaseLike,
  eventId: string,
  scan: EventScanRequest,
  evidenceOnly = false,
) {
  const read = prepareScanCaptureDecision(db, eventId, scan, evidenceOnly);
  return read.decode(read.statements.length ? await db.batch(read.statements) : []);
}
