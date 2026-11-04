import { scannerAttendeeBadgeResponseSchema } from "../../../../assets/shared/schemas/event-scanner-lookup";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { findActiveReprintableBadge } from "./badge-lifecycle";
import { recoverBadgeCredential, type BadgePrintEnvironment } from "./badge-print-protection";
import { badgeAttendeeEligibilitySql } from "./badge-attendees";

/** Resolve only an explicit selection. The scan itself still goes through enrollment, capture and receipt checks. */
export async function scannerAttendeeBadge(
  db: DatabaseLike,
  environment: BadgePrintEnvironment,
  eventId: string,
  userId: string,
) {
  const registration = await first<{ id: string }>(
    db,
    `SELECT reg.id FROM registrations reg JOIN users u ON u.id=reg.user_id WHERE reg.event_id=? AND reg.user_id=? AND ${badgeAttendeeEligibilitySql("reg", "u")}`,
    [eventId, userId],
  );
  const row = registration && (await findActiveReprintableBadge(db, eventId, userId));
  if (!row)
    throw new AppError(
      409,
      "SCANNER_BADGE_UNAVAILABLE",
      "No active badge is available. Ask the registration desk for help.",
    );
  const badgeId = await recoverBadgeCredential(
    environment,
    { eventId, id: row.id, userId, credentialHash: row.credential_hash },
    row.print_credential_json,
  );
  try {
    await db.batch([
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM event_badge_credentials badge JOIN registrations reg ON reg.event_id=badge.event_id AND reg.user_id=badge.user_id JOIN users u ON u.id=reg.user_id
      WHERE badge.event_id=? AND badge.id=? AND badge.user_id=? AND badge.credential_hash=? AND badge.print_credential_json=?
      AND badge.revoked_at IS NULL AND badge.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${badgeAttendeeEligibilitySql("reg", "u")}
      AND NOT EXISTS(SELECT 1 FROM event_evidence_retention_state state WHERE state.event_id=badge.event_id AND (state.active_run_id IS NOT NULL OR state.capture_closed_at IS NOT NULL))`,
        bindings: [eventId, row.id, userId, row.credential_hash, row.print_credential_json],
      }),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "SCANNER_BADGE_CHANGED",
        "This badge or registration changed. Search again or ask the registration desk for help.",
      );
    throw error;
  }
  return scannerAttendeeBadgeResponseSchema.parse({ badgeId });
}
