import { prepareScanCaptureDecision } from "./scan-capture-decision";
import type { EventScanRequest } from "../../../../assets/shared/schemas/event-participation-scanning";
import type { DatabaseLike, StatementLike } from "../../types";
import { batchFirst } from "../../db/pagination";
import { hashBadgeCredential } from "./badge-hash";
import { publishedSessionsSql } from "./published-schedule";

interface ScanLocation {
  room_id: string | null;
  additional_room_ids_json: string;
}

/** Replay, published destination, and badge recognition share one bounded read for entry and departure scans. */
export async function readScannerAttemptBasis<T>(
  db: DatabaseLike,
  eventId: string,
  scan: EventScanRequest,
  receipt: StatementLike,
) {
  const evidenceOnly = scan.action !== "checkout";
  const capture = prepareScanCaptureDecision(
    db,
    eventId,
    evidenceOnly ? { ...scan, offlineRight: undefined } : scan,
    evidenceOnly,
  );
  const statements = [
    receipt,
    ...(scan.occurrenceId
      ? [
          db
            .prepare(`SELECT room_id,additional_room_ids_json FROM (${publishedSessionsSql}) WHERE id=? AND event_id=?`)
            .bind(scan.occurrenceId, eventId),
        ]
      : []),
    db
      .prepare("SELECT id FROM event_badge_credentials WHERE event_id=? AND credential_hash=?")
      .bind(eventId, await hashBadgeCredential(scan.badgeId)),
  ];
  const captureIndex = statements.length;
  const results = await db.batch([...statements, ...capture.statements]);
  return {
    capture: () => capture.decode(results.slice(captureIndex)),
    replay: batchFirst<T>(results[0]),
    location: scan.occurrenceId ? batchFirst<ScanLocation>(results[1]) : null,
    badge: batchFirst<{ id: string }>(results[captureIndex - 1]),
  };
}
