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
export function prepareBadgeRenderJobsForUser(db: DatabaseLike, userId: string, createdAt = nowIso()): StatementLike {
  return db
    .prepare(
      `INSERT INTO badge_render_jobs (${BADGE_JOB_COLUMNS})
       SELECT 'badge:' || rc.code, rc.code, 'queued', 1, NULL, 0, ?, NULL, ?, ?, NULL, NULL, NULL
         FROM referral_codes rc
         JOIN registrations r ON r.id = rc.owner_id AND rc.owner_type = 'registration'
        WHERE r.user_id = ?
       ${BADGE_JOB_REQUEUE_ON_CONFLICT}`,
    )
    .bind(createdAt, createdAt, createdAt, userId);
}
