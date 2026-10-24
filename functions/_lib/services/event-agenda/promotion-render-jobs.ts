import { promotionSponsorArtwork } from "./promotion-design";
import { permissionsAuthorizationEvidence } from "../../auth/permissions";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { getAttendeePromotionKit } from "./promotion-attendee";
import { assignedPromotionKit } from "./promotion-access";
import { promotionFormatSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import type { z } from "zod";
import type { DatabaseLike, Env } from "../../types";
import { first, all, run } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { sha256Hex } from "../../utils/crypto";
import { createDurableJobLease, durableRenderRetry } from "../../jobs/lease";
import { AppError } from "../../errors";
import { getPromotionKit } from "./promotion-kit";
import { renderPromotionArtifact } from "./promotion-artifact";
import { storePromotionArtifact } from "./promotion-storage";
type Source = Awaited<ReturnType<typeof getPromotionKit>> | Awaited<ReturnType<typeof getAttendeePromotionKit>>;
interface Job {
  id: string;
  event_id: string;
  occurrence_id: string | null;
  fingerprint: string;
  user_id: string;
  revision: number;
  format: z.infer<typeof promotionFormatSchema>;
  origin: string;
  cache_key: string;
  status: string;
  attempts: number;
}
export async function requestPromotionRender(
  db: DatabaseLike,
  eventId: string,
  source: Source,
  format: z.infer<typeof promotionFormatSchema>,
  origin: string,
) {
  const id = await sha256Hex(
    JSON.stringify({
      occurrence: source.kit.occurrenceId,
      fingerprint: source.kit.fingerprint,
      user: source.actorId,
      revision: source.kit.publishedRevision,
      format,
      template: source.kit.templateVersion,
      campaign: source.kit.copy.campaign,
      registration: source.kit.registrationUrl,
    }),
  );
  const key = `promotion/v${source.kit.templateVersion}/${id}.${format === "carousel" ? "pdf" : "png"}`;
  const now = nowIso();
  await run(
    db,
    `INSERT INTO event_promotion_renders(id,event_id,occurrence_id,user_id,revision,fingerprint,format,origin,cache_key,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?,?) ON CONFLICT(id) DO UPDATE SET status='queued',attempts=0,next_attempt_at=excluded.next_attempt_at,processing_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=excluded.updated_at WHERE event_promotion_renders.status IN ('failed','obsolete')`,
    [
      id,
      eventId,
      source.kit.occurrenceId,
      source.actorId,
      source.kit.publishedRevision,
      source.kit.fingerprint,
      format,
      origin,
      key,
      now,
      now,
      now,
    ],
  );
  const job = await first<Job>(
    db,
    "SELECT id,event_id,occurrence_id,user_id,revision,fingerprint,format,origin,cache_key,status,attempts FROM event_promotion_renders WHERE id=?",
    [id],
  );
  if (!job) throw new AppError(409, "PROMOTION_JOB_CHANGED", "Refresh your promotion kit and try again.");
  return job;
}
export async function processPromotionRenderJob(
  db: DatabaseLike,
  env: Env,
  id: string,
  render: typeof renderPromotionArtifact = renderPromotionArtifact,
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
  try {
    const current = await first<{ published_revision: number; active: number }>(
      db,
      "SELECT state.published_revision,user.active FROM users user LEFT JOIN event_agenda_state state ON state.event_id=? WHERE user.id=?",
      [job.event_id, job.user_id],
    );
    if (!current || !current.active || (job.occurrence_id && current.published_revision !== job.revision)) {
      await run(
        db,
        "UPDATE event_promotion_renders SET status='obsolete',processing_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND processing_token=?",
        [nowIso(), id, lease.token],
      );
      return true;
    }
    const management = permissionsAuthorizationEvidence(createUserBackedAuthAdmin({ id: job.user_id, email: "" }), [
      { permission: "agenda:write", context: { type: "event", id: job.event_id } },
    ]);
    const canManage = Boolean(await first(db, management.sql, [...management.bindings]));
    const resolveSource = () =>
      job.occurrence_id
        ? assignedPromotionKit(db, job.event_id, job.occurrence_id, job.user_id, canManage, job.origin)
        : getAttendeePromotionKit(db, job.event_id, job.user_id, job.origin);
    const source = await resolveSource();
    if (source.kit.fingerprint !== job.fingerprint)
      throw new AppError(409, "PROMOTION_SOURCE_CHANGED", "Promotion material changed. Prepare a new kit.");
    const branding = await promotionSponsorArtwork(db, env, job.event_id);
    const artifact = await render(
      env,
      job.origin,
      { ...source, ...source.kit, sponsors: branding.sponsors },
      promotionFormatSchema.parse(job.format),
    );
    if (artifact.preview)
      await bucket.put(`${job.cache_key}.preview.png`, artifact.preview, {
        httpMetadata: { contentType: "image/png" },
      });
    await storePromotionArtifact(bucket, job.cache_key, artifact.body, {
      httpMetadata: { contentType: artifact.contentType },
      customMetadata: { agendaRevision: String(job.revision), templateVersion: String(source.kit.templateVersion) },
    });
    await run(
      db,
      "UPDATE event_promotion_renders SET status=?,processing_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND processing_token=?",
      [
        (await resolveSource()).kit.fingerprint === job.fingerprint ? "rendered" : "obsolete",
        nowIso(),
        id,
        lease.token,
      ],
    );
    return true;
  } catch (error) {
    if (error instanceof AppError && [403, 404, 409].includes(error.status)) {
      await run(
        db,
        "UPDATE event_promotion_renders SET status='obsolete',processing_token=NULL,lease_expires_at=NULL,last_error=?,updated_at=? WHERE id=? AND processing_token=?",
        [error.message.slice(0, 1000), nowIso(), id, lease.token],
      );
      return true;
    }
    const attempts = job.attempts + 1;
    const retry = durableRenderRetry(attempts);
    await run(
      db,
      "UPDATE event_promotion_renders SET status=?,attempts=?,next_attempt_at=?,processing_token=NULL,lease_expires_at=NULL,last_error=?,updated_at=? WHERE id=? AND processing_token=?",
      [
        retry.status,
        attempts,
        new Date(Date.now() + retry.delaySeconds * 1000).toISOString(),
        (error instanceof Error ? error.message : "Render failed").slice(0, 1000),
        nowIso(),
        id,
        lease.token,
      ],
    );
    return false;
  }
}
export async function processPendingPromotionRenders(db: DatabaseLike, env: Env, limit = 2) {
  const count = Math.max(0, Math.min(5, Math.floor(limit)));
  if (!count) return { processed: 0, failed: 0 };
  const now = nowIso();
  const rows = await all<{ id: string }>(
    db,
    "SELECT id FROM event_promotion_renders WHERE (status IN ('queued','retrying') AND next_attempt_at<=?) OR (status='rendering' AND lease_expires_at<=?) ORDER BY next_attempt_at,id LIMIT ?",
    [now, now, count],
  );
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    if (await processPromotionRenderJob(db, env, row.id)) processed++;
    else failed++;
  }
  return { processed, failed };
}
