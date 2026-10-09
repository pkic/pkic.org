import { composeBadgePrintSvg } from "../../../../assets/shared/badge-print-svg";
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
import { prepareBadgePrintMetadata } from "./badge-print-metadata";
import { prepareBadgePrintingBasis } from "./badge-print-branding";

interface PrintRow {
  id: string;
  user_id: string;
  credential_hash: string;
  print_credential_json: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}
/** The QR payload is the bare credential the scanner hashes; printing and the holder's ticket share it. */
export async function badgeCredentialSvg(credential: string): Promise<string> {
  return composeBadgePrintSvg(
    await QRCode.toString(credential, { type: "svg", errorCorrectionLevel: "M", margin: 4 }),
    credential,
  );
}

/** Recover one active badge's print artifact with the guards that must still hold when it is released. */
export async function recoverBadgePrintArtifact(
  db: DatabaseLike,
  environment: BadgePrintEnvironment,
  eventId: string,
  badgeId: string,
  printingRevision: string,
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
      "This badge has no recoverable print file. Use a saved original file or explicitly replace it.",
    );
  const printing = await prepareBadgePrintingBasis(db, eventId);
  if (printing.revision !== printingRevision)
    throw new AppError(
      409,
      "BADGE_PRINTING_CHANGED",
      "The event badge template or sponsor branding changed. Reload the print document.",
    );
  const labels = await prepareBadgePrintMetadata(db, eventId, badgeId);
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
  const svg = await badgeCredentialSvg(credential);
  const metadata = await getBadgeCredential(db, eventId, badgeId);
  // No artifact leaves the service unless its exact captured row is still active and the event is open for evidence.
  const guards = [
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
    ...labels.guards,
    ...printing.guards,
  ];
  const artifact = badgePrintResponseSchema.parse({
    id: row.id,
    svg,
    displayName: metadata.displayName,
    firstName: labels.firstName,
    lastName: labels.lastName,
    organization: labels.organization,
    jobTitle: labels.jobTitle,
    badgeRole: labels.badgeRole,
    printingRevision: printing.revision,
    expiresAt: row.expires_at,
  });
  return { artifact, guards };
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
  const { artifact, guards } = await recoverBadgePrintArtifact(
    db,
    environment,
    eventId,
    badgeId,
    request.printingRevision,
  );
  await db.batch([
    ...guards,
    prepareScopedAuditLog(
      db,
      { type: "event", id: eventId },
      "user",
      actorId,
      "badge_print_prepared",
      "event_badge_credential",
      artifact.id,
      { operationId: request.operationId },
      nowIso(),
      `badge-print:${eventId}:${artifact.id}:${actorId}:${request.operationId}`,
    ),
  ]);
  return artifact;
}
