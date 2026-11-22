import type { BadgeLabelRequest } from "../../../../assets/shared/schemas/route-contracts-event-badges";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { badgeAttendeeEligibilitySql } from "./badge-attendees";
import { hashBadgeCredential } from "./badge-hash";
import { prepareBadgePrint } from "./badge-print";
import type { BadgePrintEnvironment } from "./badge-print-protection";

/** Scans resolve within this event only. The canonical print use case guards authorization, state and profile. */
export async function prepareBadgeLabel(
  db: DatabaseLike,
  environment: BadgePrintEnvironment,
  eventId: string,
  actorId: string,
  request: BadgeLabelRequest,
) {
  const badgeId = await resolveLabelBadge(db, eventId, request);
  return prepareBadgePrint(db, environment, eventId, badgeId, actorId, {
    operationId: request.operationId,
    printingRevision: null,
  });
}

/** The print desk labels only a registered attendee's badge, as it issues only to one. */
export async function prepareDeskBadgeLabel(
  db: DatabaseLike,
  environment: BadgePrintEnvironment,
  eventId: string,
  actorId: string,
  request: BadgeLabelRequest,
) {
  const badgeId = await resolveLabelBadge(db, eventId, request);
  const eligibility = {
    sql: `SELECT 1 FROM event_badge_credentials badge JOIN registrations r ON r.event_id=badge.event_id AND r.user_id=badge.user_id
      JOIN users u ON u.id=r.user_id WHERE badge.event_id=? AND badge.id=? AND ${badgeAttendeeEligibilitySql("r", "u")}`,
    bindings: [eventId, badgeId],
  };
  const registered = await first(db, eligibility.sql, eligibility.bindings);
  if (!registered)
    throw new AppError(409, "BADGE_REGISTRATION_REQUIRED", "Only a registered attendee's badge prints at the desk.");
  return prepareBadgePrint(
    db,
    environment,
    eventId,
    badgeId,
    actorId,
    { operationId: request.operationId, printingRevision: null },
    eligibility,
  );
}

async function resolveLabelBadge(db: DatabaseLike, eventId: string, request: BadgeLabelRequest): Promise<string> {
  if (request.source === "badge") return request.badgeId;
  const badge = await first<{ id: string }>(
    db,
    "SELECT id FROM event_badge_credentials WHERE event_id=? AND credential_hash=?",
    [eventId, await hashBadgeCredential(request.credential)],
  );
  if (!badge) throw new AppError(404, "BADGE_NOT_FOUND", "No badge matches this code for this event.");
  return badge.id;
}
