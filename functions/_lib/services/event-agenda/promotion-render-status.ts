import { promotionKitSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { promotionReferralOwnerSql } from "./promotion-referral";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { batchFirst, batchRows } from "../../db/pagination";

export function preparePromotionRenderStatus(
  db: DatabaseLike,
  event: EventReadSelection,
  userId: string,
  occurrenceId: string | null,
  fingerprint?: string,
) {
  const scope = eventReadIdSql(event);
  return db
    .prepare(
      fingerprint
        ? `SELECT format,status,attempts,fingerprint FROM event_promotion_renders WHERE event_id=${scope.sql} AND user_id=? AND occurrence_id IS ? AND fingerprint=? ORDER BY format LIMIT 5`
        : `SELECT format,status,attempts,fingerprint FROM (SELECT format,status,attempts,fingerprint,row_number() OVER(PARTITION BY format ORDER BY COALESCE(requested_at,created_at) DESC,id DESC) AS ordinal FROM event_promotion_renders WHERE event_id=${scope.sql} AND user_id=? AND occurrence_id IS ?) WHERE ordinal=1 ORDER BY format LIMIT 5`,
    )
    .bind(...scope.bindings, userId, occurrenceId, ...(fingerprint ? [fingerprint] : []));
}
/** Independent metrics and the stable owner code join the same source snapshot, before its artwork hash exists. */
export function preparePromotionMetrics(
  db: DatabaseLike,
  event: EventReadSelection,
  userId: string,
  occurrenceId: string | null,
) {
  const scope = eventReadIdSql(event),
    owner = promotionReferralOwnerSql(event, userId);
  return {
    statements: [
      db
        .prepare(`WITH target AS(SELECT ${scope.sql} AS event_id,? AS user_id,? AS occurrence_id),owner AS(${owner.sql})
    SELECT referral.code,COALESCE(referral.clicks,0) AS clicks,
      (SELECT COUNT(*) FROM referral_conversions conversion JOIN registrations converted ON converted.id=conversion.conversion_ref WHERE conversion.code=referral.code AND conversion.conversion_type='registration' AND converted.event_id=target.event_id AND converted.status='registered') AS confirmedRegistrations,
      (SELECT COUNT(*) FROM agenda_session_participations WHERE occurrence_id=target.occurrence_id AND event_id=target.event_id AND status='reserved') AS sessionRsvps
    FROM target LEFT JOIN owner ON 1 LEFT JOIN referral_codes referral ON referral.code=owner.code`)
        .bind(...scope.bindings, userId, occurrenceId, ...owner.bindings),
    ],
    decode(loaded: D1StatementResult[]) {
      const row = batchFirst<{
        code: string | null;
        clicks: number;
        confirmedRegistrations: number;
        sessionRsvps: number;
      }>(loaded[0]);
      return {
        code: row?.code ?? null,
        metrics: promotionKitSchema.shape.metrics.parse(
          row ?? { clicks: 0, confirmedRegistrations: 0, sessionRsvps: 0 },
        ),
      };
    },
  };
}
export function decodePromotionProgress(loaded: D1StatementResult[], fingerprint: string) {
  const rows = batchRows<{ format: string; status: string; attempts: number; fingerprint: string }>(loaded[0]).filter(
    (row) => row.fingerprint === fingerprint,
  );
  return promotionKitSchema.shape.artifacts.parse(rows);
}
