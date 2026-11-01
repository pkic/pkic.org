import { PROMOTION_RETENTION_DAYS } from "../../../../assets/shared/promotion-retention";
import type { DatabaseLike, Env } from "../../types";
import { all, run } from "../../db/queries";
import { BADGE_RENDER_FORMAT, badgeRenderKeys, badgeRenderReferralCode } from "../badge-render-job-statements";
import { promotionArtifactKeys } from "./promotion-storage";

/** SQL twin of `promotionIsOpen` for a row aliased `event`. */
export const PROMOTION_OPEN_SQL =
  "(event.starts_at IS NULL OR unixepoch()<unixepoch(COALESCE(event.ends_at,event.starts_at)))";
/** SQL twin of `!promotionIsRetained` for a row aliased `event`. */
const PROMOTION_EXPIRED_SQL = `(COALESCE(event.ends_at,event.starts_at) IS NOT NULL AND unixepoch(COALESCE(event.ends_at,event.starts_at))+${PROMOTION_RETENTION_DAYS * 86_400}<=unixepoch())`;

/**
 * One bounded pass over every event whose retention ended: removes the stored
 * promotion files and badges, then the rows that point at them, so the next
 * pass moves on. Rows still rendering are left for a later pass.
 */
export async function purgeExpiredPromotionFiles(db: DatabaseLike, env: Pick<Env, "ASSETS_BUCKET">, limit = 100) {
  const bucket = env.ASSETS_BUCKET;
  if (!bucket) return { renders: 0 };
  const rows = await all<{ id: string; format: string; cache_key: string }>(
    db,
    `SELECT render.id,render.format,render.cache_key FROM event_promotion_renders render JOIN events event ON event.id=render.event_id WHERE ${PROMOTION_EXPIRED_SQL} AND render.status<>'rendering' LIMIT ?`,
    [limit],
  );
  if (!rows.length) return { renders: 0 };
  await bucket.delete(
    rows.flatMap((row) =>
      row.format === BADGE_RENDER_FORMAT
        ? badgeRenderKeys(badgeRenderReferralCode(row.id))
        : promotionArtifactKeys(row.cache_key),
    ),
  );
  await run(
    db,
    "DELETE FROM event_promotion_renders WHERE id IN(SELECT value FROM json_each(?)) AND status<>'rendering'",
    [JSON.stringify(rows.map((row) => row.id))],
  );
  return { renders: rows.length };
}
