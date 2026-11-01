import { BADGE_ATTACHMENT_WAIT_REASONS } from "../email/attachments";
import { personalPromotionImageCacheKey } from "../../../assets/shared/personal-promotion-image";
import type { DatabaseLike, StatementLike } from "../types";
import { promotionThumbnailKey } from "./event-agenda/promotion-storage-keys";
import { nowIso } from "../utils/time";

/**
 * A badge is one row of the promotion render queue, keyed by its referral code.
 * Its revision counts re-render requests, so a request that lands while the badge
 * renders sends it back to the queue. The badge renderer resolves its own origin.
 */
export const BADGE_RENDER_FORMAT = "badge";
const BADGE_RENDER_ID_PREFIX = "badge:";
const BADGE_KEY_PREFIX = personalPromotionImageCacheKey("");

export function badgeRenderId(referralCode: string) {
  return `${BADGE_RENDER_ID_PREFIX}${referralCode}`;
}

export function badgeRenderReferralCode(id: string) {
  return id.slice(BADGE_RENDER_ID_PREFIX.length);
}

/** Every stored file of a badge row: the wide and the square image, each with its thumbnail. */
export function badgeRenderKeys(referralCode: string) {
  return [personalPromotionImageCacheKey(referralCode), personalPromotionImageCacheKey(referralCode, "square")].flatMap(
    (key) => [key, promotionThumbnailKey(key)],
  );
}

const BADGE_RENDER_COLUMNS = `id,event_id,occurrence_id,user_id,revision,fingerprint,format,origin,cache_key,
  status,attempts,next_attempt_at,created_at,updated_at,requested_at`;

/** The owner of a referral code aliased `referral`, with its registration aliased `registration`. */
const BADGE_OWNER_SQL =
  "CASE referral.owner_type WHEN 'registration' THEN registration.user_id ELSE referral.created_by_user_id END";

const BADGE_RENDER_VALUES = `'${BADGE_RENDER_ID_PREFIX}'||referral.code,referral.event_id,NULL,${BADGE_OWNER_SQL},1,NULL,
  '${BADGE_RENDER_FORMAT}','',?||referral.code,'queued',0,?,?,?,?`;

const BADGE_RENDER_REQUEUE_ON_CONFLICT = `ON CONFLICT(id) DO UPDATE SET
  revision = event_promotion_renders.revision + 1,
  status = CASE WHEN event_promotion_renders.status = 'rendering' THEN 'rendering' ELSE 'queued' END,
  attempts = CASE WHEN event_promotion_renders.status = 'rendering' THEN event_promotion_renders.attempts ELSE 0 END,
  next_attempt_at = excluded.next_attempt_at,
  last_error = NULL,
  updated_at = excluded.updated_at,
  requested_at = excluded.requested_at`;

function badgeRenderBindings(at: string) {
  return [BADGE_KEY_PREFIX, at, at, at, at];
}

export function prepareBadgeRenderJob(
  db: DatabaseLike,
  referralCode: string,
  createdAt = nowIso(),
): { id: string; statement: StatementLike } {
  return {
    id: badgeRenderId(referralCode),
    statement: db
      .prepare(
        `INSERT INTO event_promotion_renders (${BADGE_RENDER_COLUMNS})
         SELECT ${BADGE_RENDER_VALUES}
           FROM referral_codes referral
           LEFT JOIN registrations registration
             ON referral.owner_type = 'registration' AND registration.id = referral.owner_id
          WHERE referral.code = ? AND ${BADGE_OWNER_SQL} IS NOT NULL
         ${BADGE_RENDER_REQUEUE_ON_CONFLICT}`,
      )
      .bind(...badgeRenderBindings(createdAt), referralCode),
  };
}

/** Queues every registration badge whose rendered profile depends on this user. */
export function prepareBadgeRenderJobsForUser(
  db: DatabaseLike,
  userId: string,
  createdAt = nowIso(),
  registrationId?: string,
): StatementLike {
  return db
    .prepare(
      `INSERT INTO event_promotion_renders (${BADGE_RENDER_COLUMNS})
       SELECT ${BADGE_RENDER_VALUES}
         FROM referral_codes referral
         JOIN registrations registration
           ON registration.id = referral.owner_id AND referral.owner_type = 'registration'
        WHERE registration.user_id = ? ${registrationId ? "AND registration.id = ?" : ""}
       ${BADGE_RENDER_REQUEUE_ON_CONFLICT}`,
    )
    .bind(...badgeRenderBindings(createdAt), userId, ...(registrationId ? [registrationId] : []));
}

/** Recover a completed image lost or superseded while its required email was waiting. */
export function prepareWaitingEmailBadgeRenders(db: DatabaseLike, limit: number, at = nowIso()): StatementLike {
  return db
    .prepare(
      `INSERT INTO event_promotion_renders (${BADGE_RENDER_COLUMNS})
    SELECT ${BADGE_RENDER_VALUES}
      FROM email_outbox mail JOIN json_each(mail.payload_json,'$.__attachments') attachment
      JOIN referral_codes referral ON referral.code=substr(json_extract(attachment.value,'$.r2Key'),?)
      LEFT JOIN registrations registration
        ON referral.owner_type='registration' AND registration.id=referral.owner_id
      LEFT JOIN event_promotion_renders job ON job.id='${BADGE_RENDER_ID_PREFIX}'||referral.code
     WHERE mail.status IN ('queued','retrying') AND mail.last_error IN (?,?)
       AND json_extract(attachment.value,'$.kind')='r2-badge-image'
       AND json_extract(attachment.value,'$.required')=1
       AND json_extract(attachment.value,'$.r2Key')=?||referral.code
       AND ${BADGE_OWNER_SQL} IS NOT NULL
       AND (job.id IS NULL OR (job.status='rendered' AND job.updated_at<mail.updated_at))
     GROUP BY referral.code LIMIT ?
     ${BADGE_RENDER_REQUEUE_ON_CONFLICT}`,
    )
    .bind(
      ...badgeRenderBindings(at),
      BADGE_KEY_PREFIX.length + 1,
      BADGE_ATTACHMENT_WAIT_REASONS.missing,
      BADGE_ATTACHMENT_WAIT_REASONS.stale,
      BADGE_KEY_PREFIX,
      limit,
    );
}
