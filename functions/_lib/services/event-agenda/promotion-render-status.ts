import { promotionKitSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import type { DatabaseLike } from "../../types";
import { all } from "../../db/queries";
export async function promotionRenderStatus(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  occurrenceId: string | null,
  fingerprint: string,
) {
  const rows = await all<{ format: string; status: string; attempts: number }>(
    db,
    "SELECT format,status,attempts FROM event_promotion_renders WHERE event_id=? AND user_id=? AND occurrence_id IS ? AND fingerprint=? ORDER BY format LIMIT 5",
    [eventId, userId, occurrenceId, fingerprint],
  );
  return promotionKitSchema.shape.artifacts.parse(rows);
}
