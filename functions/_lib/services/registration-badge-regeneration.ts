import { all, first, run } from "../db/queries";
import { AppError } from "../errors";
import { logError } from "../logging";
import type { AuthAdmin, DatabaseLike, Env, StatementLike } from "../types";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { prepareAuditLog } from "./audit";
import type { EventRecord } from "./events";
import { renderAndCacheBadge } from "./og-badge-prerender";

const MAX_ATTEMPTS = 10;

interface BadgeRenderJobRow {
  id: string;
  referral_code: string;
  origin: string;
  attempts: number;
}

export interface BadgeRenderResult {
  processed: number;
  failed: number;
}

type BadgeRenderer = (code: string, env: Env, origin: string) => Promise<void>;

function prepareBadgeRenderJob(
  db: DatabaseLike,
  referralCode: string,
  origin: string,
  createdAt: string,
): { id: string; statement: StatementLike } {
  const id = uuid();
  return {
    id,
    statement: db
      .prepare(
        `INSERT INTO badge_render_jobs (
           id, referral_code, origin, status, attempts, next_attempt_at,
           last_error, created_at, updated_at, rendered_at
         ) VALUES (?, ?, ?, 'queued', 0, ?, NULL, ?, ?, NULL)
         ON CONFLICT(referral_code) DO UPDATE SET
           id = excluded.id,
           origin = excluded.origin,
           status = 'queued',
           attempts = 0,
           next_attempt_at = excluded.next_attempt_at,
           last_error = NULL,
           updated_at = excluded.updated_at,
           rendered_at = NULL`,
      )
      .bind(id, referralCode, origin, createdAt, createdAt, createdAt),
  };
}

export async function requestRegistrationBadgeRegeneration(
  db: DatabaseLike,
  payload: { actor: AuthAdmin; event: EventRecord; registrationId: string; appBaseUrl: string },
): Promise<{ jobId: string; referralCode: string; badgeUrl: string }> {
  const referral = await first<{ code: string }>(
    db,
    `SELECT rc.code
       FROM registrations r
       JOIN referral_codes rc
         ON rc.owner_type = 'registration' AND rc.owner_id = r.id AND rc.event_id = r.event_id
      WHERE r.id = ? AND r.event_id = ?
      LIMIT 1`,
    [payload.registrationId, payload.event.id],
  );
  if (!referral) throw new AppError(404, "NO_REFERRAL_CODE", "No referral code found for this registration");

  const createdAt = nowIso();
  const job = prepareBadgeRenderJob(db, referral.code, payload.appBaseUrl, createdAt);
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

async function markBadgeRenderFailed(db: DatabaseLike, job: BadgeRenderJobRow, error: unknown): Promise<void> {
  const attempts = job.attempts + 1;
  const retryDelaySeconds = Math.min(3600, 2 ** Math.min(attempts, 10) * 15);
  const status = attempts >= MAX_ATTEMPTS ? "failed" : "retrying";
  const message = error instanceof Error ? error.message : "Unknown badge render error";
  await run(
    db,
    `UPDATE badge_render_jobs
        SET status = ?, attempts = ?, next_attempt_at = datetime('now', ?),
            last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'rendering'`,
    [status, attempts, `+${retryDelaySeconds} seconds`, message.slice(0, 1000), nowIso(), job.id],
  );
}

async function processBadgeRenderJob(
  db: DatabaseLike,
  env: Env,
  job: BadgeRenderJobRow,
  render: BadgeRenderer,
): Promise<boolean> {
  const claimed = await run(
    db,
    `UPDATE badge_render_jobs
        SET status = 'rendering', updated_at = ?
      WHERE id = ? AND status IN ('queued', 'retrying') AND next_attempt_at <= ?`,
    [nowIso(), job.id, nowIso()],
  );
  if (claimed.changes !== 1) return false;

  try {
    await render(job.referral_code, env, job.origin);
    await run(
      db,
      `UPDATE badge_render_jobs
          SET status = 'rendered', rendered_at = ?, last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'rendering'`,
      [nowIso(), nowIso(), job.id],
    );
    return true;
  } catch (error) {
    await markBadgeRenderFailed(db, job, error);
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
    `SELECT id, referral_code, origin, attempts
       FROM badge_render_jobs
      WHERE id = ? AND status IN ('queued', 'retrying') AND next_attempt_at <= ?`,
    [jobId, nowIso()],
  );
  return job ? processBadgeRenderJob(db, env, job, render) : true;
}

export async function processPendingBadgeRenders(
  db: DatabaseLike,
  env: Env,
  limit: number,
  render: BadgeRenderer = renderAndCacheBadge,
): Promise<BadgeRenderResult> {
  if (limit <= 0) return { processed: 0, failed: 0 };
  const jobs = await all<BadgeRenderJobRow>(
    db,
    `SELECT id, referral_code, origin, attempts
       FROM badge_render_jobs
      WHERE status IN ('queued', 'retrying') AND next_attempt_at <= ?
      ORDER BY next_attempt_at, created_at
      LIMIT ?`,
    [nowIso(), limit],
  );

  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    if (await processBadgeRenderJob(db, env, job, render)) processed += 1;
    else failed += 1;
  }
  return { processed, failed };
}
