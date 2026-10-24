import { promotionKitSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import type { DatabaseLike } from "../../types";
import { preparePromotionReferralMetrics } from "./promotion-referral";
import { batchFirst, batchRows } from "../../db/pagination";
export async function promotionRenderStatus(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  occurrenceId: string | null,
  fingerprint: string,
) {
  const rows = await preparePromotionRenderStatus(db, eventId, userId, occurrenceId, fingerprint).all();
  return promotionKitSchema.shape.artifacts.parse(rows.results);
}

function preparePromotionRenderStatus(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  occurrenceId: string | null,
  fingerprint: string,
) {
  return db
    .prepare(
      "SELECT format,status,attempts FROM event_promotion_renders WHERE event_id=? AND user_id=? AND occurrence_id IS ? AND fingerprint=? ORDER BY format LIMIT 5",
    )
    .bind(eventId, userId, occurrenceId, fingerprint);
}
/** Current personal progress is projected together; metrics never participate in artwork fingerprints. */
export async function promotionKitProgress(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  occurrenceId: string | null,
  fingerprint: string,
  code: string,
) {
  const results = await db.batch([
    preparePromotionRenderStatus(db, eventId, userId, occurrenceId, fingerprint),
    preparePromotionReferralMetrics(db, eventId, userId, code),
    occurrenceId
      ? db
          .prepare(
            "SELECT COALESCE(SUM(download_count),0) AS count FROM event_agenda_promotion_downloads WHERE occurrence_id=? AND user_id=?",
          )
          .bind(occurrenceId, userId)
      : db
          .prepare(
            "SELECT COALESCE(SUM(download_count),0) AS count FROM event_promotion_renders WHERE event_id=? AND user_id=? AND occurrence_id IS NULL",
          )
          .bind(eventId, userId),
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM agenda_session_participations WHERE occurrence_id=? AND event_id=? AND status='reserved'",
      )
      .bind(occurrenceId, eventId),
  ]);
  const referral = batchFirst<{ clicks: number; confirmedRegistrations: number }>(results[1]);
  return {
    artifacts: promotionKitSchema.shape.artifacts.parse(batchRows(results[0])),
    metrics: {
      downloads: batchFirst<{ count: number }>(results[2])?.count ?? 0,
      clicks: referral?.clicks ?? 0,
      confirmedRegistrations: referral?.confirmedRegistrations ?? 0,
      sessionRsvps: batchFirst<{ count: number }>(results[3])?.count ?? 0,
    },
  };
}
