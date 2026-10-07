import QRCode from "qrcode";
import {
  badgePrintResponseSchema,
  type BadgePrintRequest,
} from "../../../../assets/shared/schemas/route-contracts-event-badges";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { badgeCredentialDisplayEvidence, getBadgeCredential } from "./badge-credentials";
import { recoverBadgeCredential, type BadgePrintEnvironment } from "./badge-print-protection";

interface PrintRow {
  id: string;
  user_id: string;
  credential_hash: string;
  print_credential_json: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}
/** The supplied database rechecks the caller's live event-management authority in the final batch. */
export async function prepareBadgePrint(
  db: DatabaseLike,
  environment: BadgePrintEnvironment,
  eventId: string,
  badgeId: string,
  actorId: string,
  request: BadgePrintRequest,
) {
  const row = await first<PrintRow>(
    db,
    `SELECT id,user_id,credential_hash,print_credential_json,created_at,expires_at,revoked_at
     FROM event_badge_credentials WHERE event_id=? AND id=?`,
    [eventId, badgeId],
  );
  if (!row) throw new AppError(404, "BADGE_NOT_FOUND", "Badge unavailable.");
  if (row.revoked_at || !row.expires_at || row.expires_at <= nowIso())
    throw new AppError(409, "BADGE_NOT_ACTIVE", "Only an active badge can be reprinted.");
  if (!row.print_credential_json)
    throw new AppError(
      409,
      "BADGE_PRINT_UNAVAILABLE",
      "This older badge has no recoverable print file. Use a saved original file or explicitly replace it.",
    );
  const credential = await recoverBadgeCredential(
    environment,
    {
      eventId,
      id: row.id,
      userId: row.user_id,
      credentialHash: row.credential_hash,
    },
    row.print_credential_json,
  );
  const svg = await QRCode.toString(credential, { type: "svg", errorCorrectionLevel: "M", margin: 4 });
  const metadata = await getBadgeCredential(db, eventId, badgeId);
  // No artifact leaves the service unless its exact captured row is still active and the event is open for evidence.
  await db.batch([
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM event_badge_credentials badge
        WHERE badge.event_id=? AND badge.id=? AND badge.user_id=? AND badge.credential_hash=?
        AND badge.print_credential_json=? AND badge.created_at=? AND badge.expires_at=?
        AND badge.revoked_at IS NULL AND badge.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND EXISTS(SELECT 1 FROM registrations WHERE event_id=badge.event_id AND user_id=badge.user_id)
        AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_state state WHERE state.event_id=badge.event_id
          AND (state.active_run_id IS NOT NULL OR state.capture_closed_at IS NOT NULL))`,
      bindings: [
        eventId,
        row.id,
        row.user_id,
        row.credential_hash,
        row.print_credential_json,
        row.created_at,
        row.expires_at,
      ],
    }),
    prepareAuthorizationGuard(db, badgeCredentialDisplayEvidence(eventId, row.id, metadata.displayName)),
    prepareScopedAuditLog(
      db,
      { type: "event", id: eventId },
      "user",
      actorId,
      "badge_print_prepared",
      "event_badge_credential",
      row.id,
      { operationId: request.operationId },
      nowIso(),
      `badge-print:${eventId}:${row.id}:${actorId}:${request.operationId}`,
    ),
  ]);
  return badgePrintResponseSchema.parse({
    id: row.id,
    svg,
    displayName: metadata.displayName,
    expiresAt: row.expires_at,
  });
}
