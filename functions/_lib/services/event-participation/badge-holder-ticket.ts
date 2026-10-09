import { badgeIssueRequestSchema } from "../../../../assets/shared/schemas/route-contracts-event-badges";
import { currentBadgeResponseSchema } from "../../../../assets/shared/schemas/route-contracts-event-current-badge";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { guardDatabaseBatches } from "../../db/guarded-database";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { badgeAttendeeEligibilitySql } from "./badge-attendees";
import { findActiveReprintableBadge, issueBadge } from "./badge-lifecycle";
import { recoverBadgePrintArtifact } from "./badge-print";
import { getBadgePrintingContext } from "./badge-print-branding";
import type { BadgePrintEnvironment } from "./badge-print-protection";

export interface BadgeHolder {
  userId: string;
  sessionId: string;
}
const eligibleRegistrationSql = `SELECT 1 FROM registrations r JOIN users u ON u.id=r.user_id
  WHERE r.event_id=? AND r.user_id=? AND ${badgeAttendeeEligibilitySql("r", "u")}`;

/** Every statement rechecks the live session and the print-population eligibility of the holder's registration. */
function badgeHolderDatabase(db: DatabaseLike, eventId: string, holder: BadgeHolder): DatabaseLike {
  return guardDatabaseBatches(db, async (statements) => {
    try {
      const [, , ...results] = await db.batch([
        prepareAuthorizationGuard(db, {
          sql: "SELECT 1 FROM sessions s WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
          bindings: [holder.sessionId, holder.userId],
        }),
        prepareAuthorizationGuard(db, { sql: eligibleRegistrationSql, bindings: [eventId, holder.userId] }),
        ...statements,
      ]);
      return results;
    } catch (error) {
      if (isAuthorizationGuardFailure(error))
        throw new AppError(409, "BADGE_HOLDER_CHANGED", "Your badge or registration changed. Reload your ticket.");
      throw error;
    }
  });
}

/**
 * The holder's ticket is the organizer's print artifact for the same badge. A confirmed registration without an
 * active badge receives exactly one (concurrent requests converge on it); a revoked newest badge is not replaced
 * here, so an organizer's revocation stands until the registration desk issues a replacement.
 */
export async function prepareBadgeHolderTicket(
  db: DatabaseLike,
  environment: BadgePrintEnvironment & Pick<Env, "ASSETS_BUCKET">,
  eventId: string,
  holder: BadgeHolder,
) {
  if (!(await first(db, eligibleRegistrationSql, [eventId, holder.userId])))
    throw new AppError(409, "BADGE_REGISTRATION_REQUIRED", "A badge is available once your registration is confirmed.");
  const guarded = badgeHolderDatabase(db, eventId, holder);
  let badgeId = (await findActiveReprintableBadge(guarded, eventId, holder.userId))?.id;
  if (!badgeId) {
    const newest = await first<{ revoked_at: string | null }>(
      guarded,
      "SELECT revoked_at FROM event_badge_credentials WHERE event_id=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
      [eventId, holder.userId],
    );
    if (newest?.revoked_at)
      throw new AppError(
        409,
        "BADGE_REVOKED",
        "Your badge was revoked. Ask the registration desk for a replacement badge.",
      );
    const request = badgeIssueRequestSchema.parse({
      operationId: crypto.randomUUID(),
      userId: holder.userId,
      reuseActive: true,
    });
    badgeId = (await issueBadge(guarded, eventId, holder.userId, request, environment)).id;
  }
  const printing = await getBadgePrintingContext(guarded, environment, eventId);
  const { artifact, guards } = await recoverBadgePrintArtifact(
    guarded,
    environment,
    eventId,
    badgeId,
    printing.revision,
  );
  await guarded.batch(guards);
  return currentBadgeResponseSchema.parse({ badge: artifact, printing });
}
