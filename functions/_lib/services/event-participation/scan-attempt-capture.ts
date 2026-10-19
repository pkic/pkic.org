import type { EventScanRequest } from "../../../../assets/shared/schemas/event-participation-scanning";
import type { DatabaseLike } from "../../types";

/** Attach bounded original evidence inside the attempt's existing atomic write, never overwrite a replay. */
export function prepareAttemptCapturedValue(
  db: DatabaseLike,
  eventId: string,
  input: Pick<EventScanRequest, "operationId" | "operatorUserId" | "scannedValue" | "scannedValueTruncated">,
  requestHash: string,
) {
  return db
    .prepare(
      "UPDATE event_scan_attempts SET scanned_value=?,scanned_value_truncated=? WHERE operation_id=? AND event_id=? AND operator_user_id=? AND request_hash=? AND scanned_value IS NULL",
    )
    .bind(
      input.scannedValue,
      input.scannedValueTruncated ? 1 : 0,
      input.operationId,
      eventId,
      input.operatorUserId,
      requestHash,
    );
}
