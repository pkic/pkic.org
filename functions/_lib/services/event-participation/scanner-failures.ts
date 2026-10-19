import type { ScannerFailureRequest } from "../../../../assets/shared/schemas/event-scanner-failure";
import type { DatabaseLike } from "../../types";
import { hashBadgeCredential } from "./badge-hash";
import { nowIso } from "../../utils/time";

/** A local refusal never enters admission, attendance, checkout or sponsor lead business services. */
export async function recordScannerFailure(
  db: DatabaseLike,
  eventId: string,
  input: ScannerFailureRequest,
): Promise<void> {
  const outcome =
    input.reason === "malformed_credential" || input.reason === "unsupported_code" ? "unknown" : "unverified";
  await db.batch([
    db
      .prepare(
        `INSERT INTO event_scan_attempts(id,event_id,occurrence_id,room_id,sponsor_id,operator_user_id,device_id,operation_id,request_hash,outcome,reason,action,observed_at,created_at)
    SELECT ?,?,(SELECT id FROM event_agenda_occurrences WHERE id=? AND event_id=?),(SELECT id FROM event_agenda_rooms WHERE id=? AND event_id=?),(SELECT id FROM sponsorships WHERE id=? AND event_id=?),?,?,?,?,?,?,?,?,?
    ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        eventId,
        input.occurrenceId,
        eventId,
        input.roomId ?? null,
        eventId,
        input.sponsorId ?? null,
        eventId,
        input.operatorUserId,
        input.deviceId,
        input.operationId,
        await hashBadgeCredential(JSON.stringify(input)),
        outcome,
        input.reason,
        input.action,
        input.observedAt,
        nowIso(),
      ),
  ]);
}
