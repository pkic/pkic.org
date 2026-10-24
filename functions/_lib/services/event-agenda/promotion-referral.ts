import type { DatabaseLike } from "../../types";
import { first } from "../../db/queries";
import { randomBase62 } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
/** Reuse the owner's earliest code; unregistered assigned speakers retain personal attribution too. */
export async function promotionReferral(db: DatabaseLike, eventId: string, userId: string) {
  const read = () =>
    first<{ code: string }>(
      db,
      "SELECT code FROM referral_codes WHERE event_id=? AND ((owner_type='user' AND owner_id=?) OR (owner_type='registration' AND owner_id IN (SELECT id FROM registrations WHERE event_id=? AND user_id=?))) ORDER BY created_at,code LIMIT 1",
      [eventId, userId, eventId, userId],
    );
  let existing = await read();
  if (existing) return existing.code;
  for (let attempt = 0; attempt < 3; attempt++) {
    await db
      .prepare(`INSERT INTO referral_codes(code,event_id,owner_type,owner_id,created_by_user_id,channel_hint,clicks,conversions,created_at)
  SELECT ?,?,CASE WHEN owner.id IS NULL THEN 'user' ELSE 'registration' END,COALESCE(owner.id,?),?, 'promotion',0,0,? FROM (SELECT 1) LEFT JOIN registrations owner ON owner.id=(SELECT id FROM registrations WHERE event_id=? AND user_id=? ORDER BY created_at,id LIMIT 1) WHERE NOT EXISTS(SELECT 1 FROM referral_codes WHERE event_id=? AND ((owner_type='user' AND owner_id=?) OR (owner_type='registration' AND owner_id IN (SELECT id FROM registrations WHERE event_id=? AND user_id=?)))) ON CONFLICT(code) DO NOTHING`)
      .bind(randomBase62(10), eventId, userId, userId, nowIso(), eventId, userId, eventId, userId, eventId, userId)
      .run();
    existing = await read();
    if (existing) return existing.code;
  }
  throw new AppError(409, "PROMOTION_REFERRAL_CHANGED", "Could not prepare your referral link. Try again.");
}
export function preparePromotionReferralMetrics(db: DatabaseLike, eventId: string, userId: string, code: string) {
  return db
    .prepare(
      `SELECT referral.clicks,
 (SELECT COUNT(*) FROM referral_conversions conversion JOIN registrations converted ON converted.id=conversion.conversion_ref WHERE conversion.code=referral.code AND conversion.conversion_type='registration' AND converted.event_id=referral.event_id AND converted.status='registered') AS confirmedRegistrations
 FROM referral_codes referral WHERE referral.code=? AND referral.event_id=? AND
 ((referral.owner_type='user' AND referral.owner_id=?) OR EXISTS(SELECT 1 FROM registrations owner WHERE owner.id=referral.owner_id AND referral.owner_type='registration' AND owner.event_id=referral.event_id AND owner.user_id=?))`,
    )
    .bind(code, eventId, userId, userId);
}
