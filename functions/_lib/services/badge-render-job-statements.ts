import { BADGE_ATTACHMENT_WAIT_REASONS } from "../email/attachments";
import { personalPromotionImageCacheKey } from "../../../assets/shared/personal-promotion-image";
import type { DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";

const BADGE_JOB_COLUMNS = `id, referral_code, status, requested_generation, claimed_generation,
  attempts, next_attempt_at, last_error, created_at, updated_at, rendered_at,
  processing_token, lease_expires_at`;

const BADGE_JOB_REQUEUE_ON_CONFLICT = `ON CONFLICT(referral_code) DO UPDATE SET
  requested_generation = badge_render_jobs.requested_generation + 1,
  status = CASE WHEN badge_render_jobs.status = 'rendering' THEN 'rendering' ELSE 'queued' END,
  attempts = CASE WHEN badge_render_jobs.status = 'rendering' THEN badge_render_jobs.attempts ELSE 0 END,
  next_attempt_at = excluded.next_attempt_at,
  last_error = NULL,
  updated_at = excluded.updated_at,
  rendered_at = NULL`;

export function prepareBadgeRenderJob(
  db: DatabaseLike,
  referralCode: string,
  createdAt = nowIso(),
): { id: string; statement: StatementLike } {
  const id = `badge:${referralCode}`;
  return {
    id,
    statement: db
      .prepare(
        `INSERT INTO badge_render_jobs (${BADGE_JOB_COLUMNS})
         VALUES (?, ?, 'queued', 1, NULL, 0, ?, NULL, ?, ?, NULL, NULL, NULL)
         ${BADGE_JOB_REQUEUE_ON_CONFLICT}`,
      )
      .bind(id, referralCode, createdAt, createdAt, createdAt),
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
      `INSERT INTO badge_render_jobs (${BADGE_JOB_COLUMNS})
       SELECT 'badge:' || rc.code, rc.code, 'queued', 1, NULL, 0, ?, NULL, ?, ?, NULL, NULL, NULL
         FROM referral_codes rc
         JOIN registrations r ON r.id = rc.owner_id AND rc.owner_type = 'registration'
        WHERE r.user_id = ? ${registrationId ? "AND r.id = ?" : ""}
       ${BADGE_JOB_REQUEUE_ON_CONFLICT}`,
    )
    .bind(createdAt, createdAt, createdAt, userId, ...(registrationId ? [registrationId] : []));
}

/** Recover a completed image lost or superseded while its required email was waiting. */
export function prepareWaitingEmailBadgeRenders(db: DatabaseLike, limit: number, at = nowIso()): StatementLike {
  const prefix = personalPromotionImageCacheKey("");
  return db
    .prepare(`INSERT INTO badge_render_jobs (${BADGE_JOB_COLUMNS})
    SELECT 'badge:'||referral.code,referral.code,'queued',1,NULL,0,?,NULL,?,?,NULL,NULL,NULL
      FROM email_outbox mail JOIN json_each(mail.payload_json,'$.__attachments') attachment
      JOIN referral_codes referral ON referral.code=substr(json_extract(attachment.value,'$.r2Key'),?)
      LEFT JOIN badge_render_jobs job ON job.referral_code=referral.code
     WHERE mail.status IN ('queued','retrying') AND mail.last_error IN (?,?)
       AND json_extract(attachment.value,'$.kind')='r2-badge-image'
       AND json_extract(attachment.value,'$.required')=1
       AND json_extract(attachment.value,'$.r2Key')=?||referral.code
       AND (job.id IS NULL OR (job.status='rendered' AND COALESCE(job.rendered_at,job.updated_at)<mail.updated_at))
     GROUP BY referral.code LIMIT ?
     ${BADGE_JOB_REQUEUE_ON_CONFLICT}`)
    .bind(
      at,
      at,
      at,
      prefix.length + 1,
      BADGE_ATTACHMENT_WAIT_REASONS.missing,
      BADGE_ATTACHMENT_WAIT_REASONS.stale,
      prefix,
      limit,
    );
}
