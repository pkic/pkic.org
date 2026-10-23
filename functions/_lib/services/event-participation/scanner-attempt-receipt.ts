import type { DatabaseLike } from "../../types";
import type {
  EventScanRequest,
  EventScanResponse,
} from "../../../../assets/shared/schemas/event-participation-scanning";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";

export interface ScannerAttemptReceipt {
  request_hash: string;
  outcome: EventScanResponse["outcome"];
  reason: EventScanResponse["reason"];
  attendanceRecorded: number;
  admissionDecision: EventScanResponse["admissionDecision"];
}

/** The same immutable attempt projection serves entry, departure, and their prepared preflight. */
export function prepareScannerAttemptReceipt(
  db: DatabaseLike,
  event: EventReadSelection,
  scan: Pick<EventScanRequest, "operationId" | "operatorUserId">,
) {
  const scope = eventReadIdSql(event);
  return db
    .prepare(`SELECT a.request_hash,a.outcome,a.reason,a.admission_decision AS admissionDecision,
    EXISTS(SELECT 1 FROM event_attendance_observations observation WHERE observation.attempt_id=a.id) AS attendanceRecorded
    FROM event_scan_attempts a WHERE a.operation_id=? AND a.event_id=${scope.sql} AND a.operator_user_id=?`)
    .bind(scan.operationId, ...scope.bindings, scan.operatorUserId);
}
