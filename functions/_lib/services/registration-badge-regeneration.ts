import { all, first, run } from "../db/queries";
import { AppError } from "../errors";
import { logError } from "../logging";
import type { AuthAdmin, DatabaseLike, Env } from "../types";
import { nowIso } from "../utils/time";
import { prepareAuditLog } from "./audit";
import { resolveAppBaseUrl } from "../config";
import { createDurableJobLease } from "../jobs/lease";
import type { EventRecord } from "./events";
import { fetchGravatar } from "./gravatar";
import { renderAndCacheBadge } from "./og-badge-prerender";
import { prepareBadgeRenderJob } from "./badge-render-job-statements";
import { firstReferralCodeQuerySql } from "./referral-code-projection";
export { prepareBadgeRenderJobsForUser } from "./badge-render-job-statements";

const MAX_ATTEMPTS = 10;

interface BadgeRenderJobRow {
  id: string;
  referral_code: string;
  requested_generation: number;
  attempts: number;
}

export interface BadgeRenderResult {
  processed: number;
  failed: number;
}

export const BADGE_RENDER_DUE_QUERY = `
  SELECT id, referral_code, requested_generation, attempts, next_attempt_at AS due_at, created_at
    FROM badge_render_jobs
   WHERE status IN ('queued', 'retrying') AND next_attempt_at <= ?
  UNION ALL
  SELECT id, referral_code, requested_generation, attempts, lease_expires_at AS due_at, created_at
    FROM badge_render_jobs
   WHERE status = 'rendering' AND lease_expires_at <= ?
  ORDER BY due_at, created_at, id
  LIMIT ?`;

type BadgeRenderer = (code: string, env: Env, origin: string) => Promise<void>;

export async function requestRegistrationBadgeRegeneration(
  db: DatabaseLike,
  payload: { actor: AuthAdmin; event: EventRecord; registrationId: string; appBaseUrl: string },
): Promise<{ jobId: string; referralCode: string; badgeUrl: string }> {
  const referral = await first<{ code: string }>(db, firstReferralCodeQuerySql("registration", "?", "?"), [
    payload.registrationId,
    payload.event.id,
  ]);
  if (!referral) throw new AppError(404, "NO_REFERRAL_CODE", "No referral code found for this registration");

  const createdAt = nowIso();
  const job = prepareBadgeRenderJob(db, referral.code, createdAt);
  await db.batch([
    job.statement,
    prepareAuditLog(
      db,
      "admin",
      payload.actor.id,
      "og_badge_regeneration_requested",
      "registration",
      payload.registrationId,
      { referralCode: referral.code, jobId: job.id },
      createdAt,
    ),
  ]);

  return {
    jobId: job.id,
    referralCode: referral.code,
    badgeUrl: `${payload.appBaseUrl}/api/v1/og/${referral.code}`,
  };
}

async function markBadgeRenderFailed(
  db: DatabaseLike,
  job: BadgeRenderJobRow,
  processingToken: string,
  error: unknown,
): Promise<void> {
  const attempts = job.attempts + 1;
  const retryDelaySeconds = Math.min(3600, 2 ** Math.min(attempts, 10) * 15);
  const status = attempts >= MAX_ATTEMPTS ? "failed" : "retrying";
  const message = error instanceof Error ? error.message : "Unknown badge render error";
  const currentGenerationQueued = await run(
    db,
    `UPDATE badge_render_jobs
        SET status = 'queued', attempts = 0, next_attempt_at = ?, last_error = NULL,
            claimed_generation = NULL, processing_token = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'rendering' AND processing_token = ?
        AND requested_generation != claimed_generation`,
    [nowIso(), nowIso(), job.id, processingToken],
  );
  if (currentGenerationQueued.changes === 1) return;

  await run(
    db,
    `UPDATE badge_render_jobs
        SET status = ?, attempts = ?, next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?),
            last_error = ?, claimed_generation = NULL, processing_token = NULL,
            lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'rendering' AND processing_token = ?
        AND requested_generation = claimed_generation`,
    [status, attempts, `+${retryDelaySeconds} seconds`, message.slice(0, 1000), nowIso(), job.id, processingToken],
  );
}

async function processBadgeRenderJob(
  db: DatabaseLike,
  env: Env,
  job: BadgeRenderJobRow,
  render: BadgeRenderer,
): Promise<boolean> {
  const lease = createDurableJobLease();
  const claimed = await run(
    db,
    `UPDATE badge_render_jobs
        SET status = 'rendering', claimed_generation = requested_generation,
            processing_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND next_attempt_at <= ?
        AND (status IN ('queued', 'retrying') OR (status = 'rendering' AND lease_expires_at <= ?))`,
    [lease.token, lease.expiresAt, lease.claimedAt, job.id, lease.claimedAt, lease.claimedAt],
  );
  if (claimed.changes !== 1) return false;

  try {
    await render(job.referral_code, env, resolveAppBaseUrl(env));
    const finalized = await run(
      db,
      `UPDATE badge_render_jobs
          SET status = 'rendered', rendered_at = ?, last_error = NULL,
              claimed_generation = NULL, processing_token = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'rendering' AND processing_token = ?
          AND requested_generation = claimed_generation`,
      [nowIso(), nowIso(), job.id, lease.token],
    );
    if (finalized.changes === 0) {
      await run(
        db,
        `UPDATE badge_render_jobs
            SET status = 'queued', attempts = 0, next_attempt_at = ?, last_error = NULL,
                claimed_generation = NULL, processing_token = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE id = ? AND status = 'rendering' AND processing_token = ?
            AND requested_generation != claimed_generation`,
        [nowIso(), nowIso(), job.id, lease.token],
      );
    }
    return true;
  } catch (error) {
    await markBadgeRenderFailed(db, job, lease.token, error);
    logError("badge render failed", { error, jobId: job.id, referralCode: job.referral_code });
    return false;
  }
}

export async function processBadgeRenderJobById(
  db: DatabaseLike,
  env: Env,
  jobId: string,
  render: BadgeRenderer = renderAndCacheBadge,
): Promise<boolean> {
  const job = await first<BadgeRenderJobRow>(
    db,
    `SELECT id, referral_code, requested_generation, attempts
       FROM badge_render_jobs
      WHERE id = ? AND next_attempt_at <= ?
        AND (status IN ('queued', 'retrying') OR (status = 'rendering' AND lease_expires_at <= ?))`,
    [jobId, nowIso(), nowIso()],
  );
  return job ? processBadgeRenderJob(db, env, job, render) : true;
}

/** Seeds an optional first headshot before processing an already-durable initial render intent. */
export async function seedGravatarAndProcessBadgeRenderJob(
  db: DatabaseLike,
  env: Env,
  payload: { userId: string; email: string; jobId: string },
  render: BadgeRenderer = renderAndCacheBadge,
): Promise<boolean> {
  await fetchGravatar(payload.userId, payload.email, env);
  return processBadgeRenderJobById(db, env, payload.jobId, render);
}

export async function processPendingBadgeRenders(
  db: DatabaseLike,
  env: Env,
  limit: number,
  render: BadgeRenderer = renderAndCacheBadge,
): Promise<BadgeRenderResult> {
  if (limit <= 0) return { processed: 0, failed: 0 };
  const jobs = await all<BadgeRenderJobRow>(db, BADGE_RENDER_DUE_QUERY, [nowIso(), nowIso(), limit]);

  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    if (await processBadgeRenderJob(db, env, job, render)) processed += 1;
    else failed += 1;
  }
  return { processed, failed };
}
