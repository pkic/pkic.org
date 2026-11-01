import { prepareJobWake } from "../scheduled-jobs/dispatcher";
import {
  promotionRenderLocation,
  preparePromotionRenderRequests,
  type PromotionRenderJob as Job,
} from "./promotion-render-request";
import { promotionSponsorArtwork } from "./promotion-design";
import { permissionsAuthorizationEvidence } from "../../auth/permissions";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { assignedPromotionKit } from "./promotion-access";
import { promotionFormatSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import type { z } from "zod";
import type { DatabaseLike, Env } from "../../types";
import { first, all, run } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { createDurableJobLease, durableRenderRetry } from "../../jobs/lease";
import { AppError } from "../../errors";
import { getPromotionKit, getAttendeePromotionKit } from "./promotion-source";
import type { renderPromotionArtifact } from "./promotion-artifact";
import { storePromotionArtifact } from "./promotion-storage";
import { promotionArtifactKeys, promotionThumbnailKey } from "./promotion-storage-keys";
import { PROMOTION_OPEN_SQL } from "./promotion-retention";
import {
  BADGE_RENDER_FORMAT,
  badgeRenderReferralCode,
  prepareWaitingEmailBadgeRenders,
} from "../badge-render-job-statements";
import { resolveAppBaseUrl } from "../../config";
import { logError } from "../../logging";
import { batchRows } from "../../db/pagination";
type Source = Awaited<ReturnType<typeof getPromotionKit>> | Awaited<ReturnType<typeof getAttendeePromotionKit>>;
export async function requestPromotionRender(
  db: DatabaseLike,
  eventId: string,
  source: Source,
  format: z.infer<typeof promotionFormatSchema>,
  origin: string,
) {
  return (await requestPromotionRenders(db, eventId, source, [format], origin))[0]!;
}
/** Enqueue one complete kit atomically; every format shares the same validated source. */
export async function requestPromotionRenders(
  db: DatabaseLike,
  eventId: string,
  source: Source,
  formats: readonly z.infer<typeof promotionFormatSchema>[],
  origin: string,
) {
  const read = await preparePromotionRenderRequests(
    db,
    eventId,
    source.actorId,
    source.kit.occurrenceId,
    source.kit.publishedRevision,
    source.kit.fingerprint!,
    formats,
    origin,
  );
  return read.decode(await db.batch(read.statements));
}

type BadgeRenderer = (code: string, env: Env, origin: string) => Promise<void>;

/**
 * Renders one queued row: a kit format or a badge. Both share the claim, the
 * retry policy, and the rule that a row re-requested while rendering (its
 * revision moved on) goes straight back to the queue.
 */
export async function processPromotionRenderJob(
  db: DatabaseLike,
  env: Env,
  id: string,
  render?: typeof renderPromotionArtifact,
  renderBadge?: BadgeRenderer,
) {
  const job = await first<Job>(
    db,
    "SELECT id,event_id,occurrence_id,user_id,revision,fingerprint,format,origin,cache_key,status,attempts FROM event_promotion_renders WHERE id=?",
    [id],
  );
  if (!job || job.status === "rendered" || job.status === "obsolete") return false;
  const bucket = env.ASSETS_BUCKET;
  if (!bucket)
    throw new AppError(503, "PROMOTION_STORAGE_UNAVAILABLE", "Promotion storage is temporarily unavailable.");
  const lease = createDurableJobLease();
  const claim = await run(
    db,
    "UPDATE event_promotion_renders SET status='rendering',processing_token=?,lease_expires_at=?,updated_at=? WHERE id=? AND ((status IN ('queued','retrying') AND next_attempt_at<=?) OR (status='rendering' AND lease_expires_at<=?))",
    [lease.token, lease.expiresAt, lease.claimedAt, id, lease.claimedAt, lease.claimedAt],
  );
  if (claim.changes !== 1) return false;
  const settle = (status: string, detail: { attempts?: number; nextAttemptAt?: string; error?: string } = {}) =>
    settlePromotionRender(db, job, lease.token, status, detail);
  try {
    if (job.format === BADGE_RENDER_FORMAT) {
      const renderer = renderBadge ?? (await import("../og-badge-prerender")).renderAndCacheBadge;
      await renderer(badgeRenderReferralCode(job.id), env, resolveAppBaseUrl(env));
      await settle("rendered");
    } else if (await renderQueuedKit(db, env, bucket, job, lease.token, render)) {
      await settle("rendered");
      await removeSupersededPromotionFiles(db, bucket, job);
    } else await settle("obsolete");
    return true;
  } catch (error) {
    if (error instanceof AppError && [403, 404, 409].includes(error.status)) {
      await settle("obsolete", { error: error.message });
      return true;
    }
    const attempts = job.attempts + 1;
    const retry = durableRenderRetry(attempts);
    await settle(retry.status, {
      attempts,
      nextAttemptAt: new Date(Date.now() + retry.delaySeconds * 1000).toISOString(),
      error: error instanceof Error ? error.message : "Render failed",
    });
    if (job.format === BADGE_RENDER_FORMAT) logError("badge render failed", { error, jobId: job.id });
    return false;
  }
}

function settlePromotionRender(
  db: DatabaseLike,
  job: Job,
  token: string,
  status: string,
  detail: { attempts?: number; nextAttemptAt?: string; error?: string },
) {
  const at = nowIso();
  return run(
    db,
    `UPDATE event_promotion_renders SET
      status=CASE WHEN revision=?1 THEN ?2 ELSE 'queued' END,
      attempts=CASE WHEN revision=?1 THEN COALESCE(?3,attempts) ELSE 0 END,
      next_attempt_at=CASE WHEN revision=?1 THEN COALESCE(?4,next_attempt_at) ELSE ?6 END,
      last_error=CASE WHEN revision=?1 THEN ?5 ELSE NULL END,
      processing_token=NULL,lease_expires_at=NULL,updated_at=?6
     WHERE id=?7 AND processing_token=?8`,
    [
      job.revision,
      status,
      detail.attempts ?? null,
      detail.nextAttemptAt ?? null,
      detail.error?.slice(0, 1000) ?? null,
      at,
      job.id,
      token,
    ],
  );
}

/** Renders and stores one kit format; false when the kit no longer applies. */
async function renderQueuedKit(
  db: DatabaseLike,
  env: Env,
  bucket: R2Bucket,
  job: Job,
  token: string,
  render?: typeof renderPromotionArtifact,
) {
  const current = await first<{ published_revision: number; active: number; open: number }>(
    db,
    `SELECT state.published_revision,user.active,(SELECT ${PROMOTION_OPEN_SQL} FROM events event WHERE event.id=?) AS open FROM users user LEFT JOIN event_agenda_state state ON state.event_id=? WHERE user.id=?`,
    [job.event_id, job.event_id, job.user_id],
  );
  if (
    !current ||
    !current.active ||
    !current.open ||
    (job.occurrence_id && current.published_revision !== job.revision)
  )
    return false;
  const format = promotionFormatSchema.parse(job.format);
  const management = permissionsAuthorizationEvidence(createUserBackedAuthAdmin({ id: job.user_id, email: "" }), [
    { permission: "agenda:write", context: { type: "event", id: job.event_id } },
  ]);
  const canManage = Boolean(await first(db, management.sql, [...management.bindings]));
  const resolveSource = () =>
    job.occurrence_id
      ? assignedPromotionKit(db, job.event_id, job.occurrence_id, job.user_id, canManage, job.origin)
      : getAttendeePromotionKit(db, job.event_id, job.user_id, job.origin);
  const source = await resolveSource();
  if (job.fingerprint === null && !source.kit.stale && source.kit.fingerprint) {
    const location = await promotionRenderLocation(job.user_id, job.occurrence_id, source.kit.fingerprint, format);
    await run(
      db,
      "UPDATE event_promotion_renders SET fingerprint=?,cache_key=?,updated_at=? WHERE id=? AND processing_token=?",
      [source.kit.fingerprint, location.key, nowIso(), job.id, token],
    );
    job.fingerprint = source.kit.fingerprint;
    job.cache_key = location.key;
  }
  if (source.kit.stale || source.kit.fingerprint !== job.fingerprint)
    throw new AppError(409, "PROMOTION_SOURCE_CHANGED", "Promotion material changed. Prepare a new kit.");
  const branding = await promotionSponsorArtwork(db, env, job.event_id);
  const renderArtifact = render ?? (await import("./promotion-artifact")).renderPromotionArtifact;
  const artifact = await renderArtifact(
    env,
    job.origin,
    { ...source, ...source.kit, sponsors: branding.sponsors },
    format,
  );
  await bucket.put(promotionThumbnailKey(job.cache_key), artifact.thumbnail.bytes, {
    httpMetadata: { contentType: artifact.thumbnail.contentType },
  });
  await storePromotionArtifact(bucket, job.cache_key, artifact.body, {
    httpMetadata: { contentType: artifact.contentType },
    customMetadata: { agendaRevision: String(job.revision), templateVersion: String(source.kit.templateVersion) },
  });
  return (await resolveSource()).kit.fingerprint === job.fingerprint;
}
/** A new version of a format replaces the earlier ones; their files and rows go with it. */
async function removeSupersededPromotionFiles(db: DatabaseLike, bucket: R2Bucket, job: Job) {
  const earlier = await all<{ id: string; cache_key: string }>(
    db,
    "SELECT id,cache_key FROM event_promotion_renders WHERE event_id=? AND user_id=? AND occurrence_id IS ? AND format=? AND id<>? AND status IN('rendered','failed','obsolete') LIMIT 20",
    [job.event_id, job.user_id, job.occurrence_id, job.format, job.id],
  );
  if (!earlier.length) return;
  await bucket.delete(earlier.flatMap((row) => promotionArtifactKeys(row.cache_key)));
  await run(
    db,
    "DELETE FROM event_promotion_renders WHERE id IN(SELECT value FROM json_each(?)) AND status IN('rendered','failed','obsolete')",
    [JSON.stringify(earlier.map((row) => row.id))],
  );
}
/** One bounded pass over due kit formats and badges, after recovering badges that waiting emails need. */
export async function processPendingPromotionRenders(
  db: DatabaseLike,
  env: Env,
  limit: number,
  renderBadge?: BadgeRenderer,
) {
  const count = Math.max(0, Math.floor(limit));
  if (!count) return { processed: 0, failed: 0 };
  const now = nowIso();
  const [, due] = await db.batch([
    prepareWaitingEmailBadgeRenders(db, count, now),
    db
      .prepare(
        "SELECT id FROM event_promotion_renders WHERE (status IN ('queued','retrying') AND next_attempt_at<=?) OR (status='rendering' AND lease_expires_at<=?) ORDER BY next_attempt_at,id LIMIT ?",
      )
      .bind(now, now, count),
  ]);
  let processed = 0;
  let failed = 0;
  for (const row of batchRows<{ id: string }>(due!)) {
    if (await processPromotionRenderJob(db, env, row.id, undefined, renderBadge)) processed++;
    else failed++;
  }
  await prepareJobWake(db, "due_work", {
    sql: "SELECT 1 FROM event_promotion_renders WHERE status IN ('queued','retrying') AND next_attempt_at<=? LIMIT 1",
    bindings: [nowIso()],
  }).run();
  return { processed, failed };
}
