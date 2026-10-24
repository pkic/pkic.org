import { prepareScanCaptureDecision } from "./scan-capture-decision";
import type { EventScanRequest } from "../../../../assets/shared/schemas/event-participation-scanning";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { batchFirst } from "../../db/pagination";
import { hashBadgeCredential } from "./badge-hash";
import { publishedSessionsSql } from "./published-schedule";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { prepareScannerAttemptReceipt, type ScannerAttemptReceipt } from "./scanner-attempt-receipt";

interface ScanLocation {
  room_id: string | null;
  additional_room_ids_json: string;
}

/** Replay, published destination, and badge recognition share one bounded read for entry and departure scans. */
export async function readScannerAttemptBasis(db: DatabaseLike, eventId: string, scan: EventScanRequest) {
  const read = await prepareScannerAttemptBasis(db, eventId, scan);
  return read.decode(await db.batch(read.statements), eventId);
}

export type ScannerAttemptBasis = Awaited<ReturnType<typeof readScannerAttemptBasis>>;

export async function prepareScannerAttemptBasis(
  db: DatabaseLike,
  eventId: EventReadSelection,
  scan: EventScanRequest,
) {
  const scope = eventReadIdSql(eventId);
  const evidenceOnly = scan.action !== "checkout";
  const capture = prepareScanCaptureDecision(
    db,
    eventId,
    evidenceOnly ? { ...scan, offlineRight: undefined } : scan,
    evidenceOnly,
  );
  const statements = [
    prepareScannerAttemptReceipt(db, eventId, scan),
    ...(scan.occurrenceId
      ? [
          db
            .prepare(
              `SELECT room_id,additional_room_ids_json FROM (${publishedSessionsSql}) WHERE id=? AND event_id=${scope.sql}`,
            )
            .bind(scan.occurrenceId, ...scope.bindings),
        ]
      : []),
    db
      .prepare(`SELECT id FROM event_badge_credentials WHERE event_id=${scope.sql} AND credential_hash=?`)
      .bind(...scope.bindings, await hashBadgeCredential(scan.badgeId)),
  ];
  const captureIndex = statements.length;
  return {
    statements: [...statements, ...capture.statements],
    decode(results: D1StatementResult[], canonicalEventId: string) {
      return {
        capture: () => capture.decode(results.slice(captureIndex), canonicalEventId),
        replay: batchFirst<ScannerAttemptReceipt>(results[0]),
        location: scan.occurrenceId ? batchFirst<ScanLocation>(results[1]) : null,
        badge: batchFirst<{ id: string }>(results[captureIndex - 1]),
      };
    },
  };
}
