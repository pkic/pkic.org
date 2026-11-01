import type { z } from "zod";
import type { DatabaseLike, Env } from "../../types";
import { promotionArtifactQuerySchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import { prepareOwnPromotionRequest } from "./promotion-request-context";
import { promotionRenderLocation } from "./promotion-render-request";
import { promotionThumbnailKey } from "./promotion-storage-keys";
import { eventReadIdSql } from "../events/selection";
import { batchFirst } from "../../db/pagination";
import { buildDownloadDisposition } from "../../utils/download-disposition";
import { AppError } from "../../errors";

/** R2 is read speculatively, but no bytes leave before one canonical authorization/source snapshot accepts them. */
export async function downloadOwnPromotionArtifact(
  db: DatabaseLike,
  request: Request,
  env: Env,
  slug: string,
  occurrenceId: string | null,
  origin: string,
  query: z.infer<typeof promotionArtifactQuerySchema>,
) {
  const source = await prepareOwnPromotionRequest(db, request, env, slug, occurrenceId, origin);
  if (!query.fingerprint) throw new AppError(409, "PROMOTION_ARTIFACT_STALE", "Refresh your kit before downloading.");
  const location = await promotionRenderLocation(source.actor.subjectId, occurrenceId, query.fingerprint, query.format),
    event = eventReadIdSql({ slug });
  if (!env.ASSETS_BUCKET) throw new AppError(503, "PROMOTION_STORAGE_UNAVAILABLE", "Promotion storage is unavailable.");
  // A preview is the small gallery thumbnail, never the full file.
  const cached = await env.ASSETS_BUCKET.get(
    query.download === "false" ? promotionThumbnailKey(location.key) : location.key,
  );
  const loaded = await db.batch([
    ...source.statements,
    db
      .prepare(
        `SELECT status FROM event_promotion_renders WHERE id=? AND event_id=${event.sql} AND user_id=? AND occurrence_id IS ? AND fingerprint=?`,
      )
      .bind(location.id, ...event.bindings, source.actor.subjectId, occurrenceId, query.fingerprint),
  ]);
  const current = await source.decode(loaded.slice(0, source.statements.length));
  if (
    current.kit.stale ||
    current.kit.fingerprint !== query.fingerprint ||
    current.kit.publishedRevision !== query.revision
  )
    throw new AppError(409, "PROMOTION_ARTIFACT_STALE", "Your materials changed. Refresh your kit before downloading.");
  const job = batchFirst<{ status: string }>(loaded.at(-1)!);
  if (!cached || job?.status !== "rendered")
    throw new AppError(409, "PROMOTION_RENDER_PENDING", "Your material is being prepared. Refresh the kit shortly.");
  const type = cached.httpMetadata?.contentType ?? (query.format === "carousel" ? "application/pdf" : "image/png");
  return new Response(cached.body, {
    headers: {
      "content-type": type,
      // The URL names one fingerprint, so its bytes never change; a thumbnail may stay in this browser.
      "cache-control":
        query.download === "false" ? "private, max-age=86400, immutable" : "private, no-store, max-age=0",
      "content-disposition": buildDownloadDisposition(`promotion-${query.format}`, type, "promotion-materials"),
    },
  });
}
