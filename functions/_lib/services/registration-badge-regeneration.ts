import { personalPromotionImagePath } from "../../../assets/shared/personal-promotion-image";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, Env } from "../types";
import { nowIso } from "../utils/time";
import { prepareAuditLog } from "./audit";
import type { EventRecord } from "./events";
import { fetchGravatar } from "./gravatar";
import { prepareBadgeRenderJob } from "./badge-render-job-statements";
import { firstReferralCodeQuerySql } from "./referral-code-projection";
import { processPromotionRenderJob } from "./event-agenda/promotion-render-jobs";

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
    badgeUrl: `${payload.appBaseUrl}${personalPromotionImagePath(referral.code)}`,
  };
}

/** Seeds an optional first headshot before rendering an already-durable initial badge request. */
export async function seedGravatarAndProcessBadgeRenderJob(
  db: DatabaseLike,
  env: Env,
  payload: { userId: string; email: string; jobId: string },
  render?: BadgeRenderer,
): Promise<boolean> {
  await fetchGravatar(payload.userId, payload.email, env);
  return processPromotionRenderJob(db, env, payload.jobId, undefined, render);
}
