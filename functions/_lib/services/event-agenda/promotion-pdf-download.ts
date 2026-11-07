import type { z } from "zod";
import type { DatabaseLike, Env } from "../../types";
import type { promotionPdfExportSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import { readOwnPromotionRequest } from "./promotion-request-context";
import { promotionDesignArtwork } from "./promotion-design";
import { AppError } from "../../errors";
import { buildDownloadDisposition } from "../../utils/download-disposition";

/** A stateless export: the caller owns retry, and a shared background lease cannot block delivery. */
export async function downloadOwnPromotionPdf(
  db: DatabaseLike,
  request: Request,
  env: Env,
  slug: string,
  occurrenceId: string | null,
  origin: string,
  input: z.infer<typeof promotionPdfExportSchema>,
  targetUserId?: string,
) {
  const current = await readOwnPromotionRequest(db, request, env, slug, occurrenceId, origin, false, targetUserId);
  if (
    current.kit.stale ||
    current.kit.fingerprint !== input.fingerprint ||
    current.kit.publishedRevision !== input.publishedRevision ||
    current.kit.compositionRevision !== input.compositionRevision
  )
    throw new AppError(
      409,
      "PROMOTION_ARTIFACT_STALE",
      "Your materials changed. Refresh this page before downloading.",
    );
  const branding = await promotionDesignArtwork(env, current.visual);
  // Keep the PDF/font/rasterizer graph off the preview and ordinary kit read paths.
  const { renderPromotionArtifact } = await import("./promotion-artifact");
  const artifact = await renderPromotionArtifact(
    env,
    origin,
    { ...current, ...current.kit, sponsors: branding.sponsors },
    "carousel",
    { thumbnail: false },
  );
  return new Response(artifact.body instanceof Uint8Array ? new Uint8Array(artifact.body) : artifact.body, {
    headers: {
      "content-type": artifact.contentType,
      "cache-control": "private, no-store, max-age=0",
      "content-disposition": buildDownloadDisposition(
        "promotion-carousel",
        artifact.contentType,
        "promotion-materials",
      ),
    },
  });
}
