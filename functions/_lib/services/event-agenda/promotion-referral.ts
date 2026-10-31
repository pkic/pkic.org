import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import type { DatabaseLike } from "../../types";
import { first } from "../../db/queries";
import { randomBase62 } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
/** Reuse the owner's earliest code; unregistered assigned speakers retain personal attribution too. */
export async function promotionReferral(db: DatabaseLike, eventId: string, userId: string) {
  const owner = promotionReferralOwnerSql(eventId, userId);
  const read = () => first<{ code: string }>(db, owner.sql, owner.bindings);
  let existing = await read();
  if (existing) return existing.code;
  for (let attempt = 0; attempt < 3; attempt++) {
    await preparePromotionReferralCreation(db, eventId, userId).run();
    existing = await read();
    if (existing) return existing.code;
  }
  throw new AppError(409, "PROMOTION_REFERRAL_CHANGED", "Could not prepare your referral link. Try again.");
}
/** Reference-only owner selection reused by composed kit reads and atomic referral creation. */
export function promotionReferralOwnerSql(event: EventReadSelection, userId: string) {
  const scope = eventReadIdSql(event);
  return {
    sql: `SELECT code FROM referral_codes WHERE event_id=${scope.sql} AND ((owner_type='user' AND owner_id=?) OR (owner_type='registration' AND owner_id IN(SELECT id FROM registrations WHERE event_id=${scope.sql} AND user_id=?))) ORDER BY created_at,code LIMIT 1`,
    bindings: [...scope.bindings, userId, ...scope.bindings, userId],
  };
}
export function preparePromotionReferralCreation(
  db: DatabaseLike,
  event: EventReadSelection,
  userId: string,
  eligible?: { sql: string; bindings: readonly unknown[] },
) {
  const scope = eventReadIdSql(event),
    owner = promotionReferralOwnerSql(event, userId);
  return db
    .prepare(`${eligible ? `WITH promotion_eligible AS MATERIALIZED(${eligible.sql}) ` : ""}INSERT INTO referral_codes(code,event_id,owner_type,owner_id,created_by_user_id,channel_hint,clicks,conversions,created_at)
  SELECT ?,${scope.sql},CASE WHEN registration.id IS NULL THEN 'user' ELSE 'registration' END,COALESCE(registration.id,?),?,'promotion',0,0,? FROM (SELECT 1) LEFT JOIN registrations registration ON registration.id=(SELECT id FROM registrations WHERE event_id=${scope.sql} AND user_id=? ORDER BY created_at,id LIMIT 1) WHERE NOT EXISTS(${owner.sql}) ${eligible ? `AND EXISTS(SELECT 1 FROM promotion_eligible)` : ""} ON CONFLICT(code) DO NOTHING`)
    .bind(
      ...(eligible?.bindings ?? []),
      randomBase62(10),
      ...scope.bindings,
      userId,
      userId,
      nowIso(),
      ...scope.bindings,
      userId,
      ...owner.bindings,
    );
}
