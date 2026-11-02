import type { BadgeLabelRequest } from "../../../../assets/shared/schemas/route-contracts-event-badges";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
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
  const badge =
    request.source === "badge"
      ? { id: request.badgeId }
      : await first<{ id: string }>(
          db,
          "SELECT id FROM event_badge_credentials WHERE event_id=? AND credential_hash=?",
          [eventId, await hashBadgeCredential(request.credential)],
        );
  if (!badge) throw new AppError(404, "BADGE_NOT_FOUND", "No badge matches this code for this event.");
  return prepareBadgePrint(db, environment, eventId, badge.id, actorId, {
    operationId: request.operationId,
    printingRevision: null,
  });
}
