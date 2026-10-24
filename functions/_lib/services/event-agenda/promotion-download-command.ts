import type { z } from "zod";
import type { DatabaseLike, Env } from "../../types";
import { promotionDownloadRecordSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import { prepareOwnPromotionRequest } from "./promotion-request-context";
import { promotionRenderLocation } from "./promotion-render-request";
import { preparePromotionDownloadRecording } from "./promotion-access";
import { AppError } from "../../errors";
/** File delivery stays a read; its completed client action records metrics in a separate atomic command. */
export async function recordOwnPromotionDownload(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  slug: string,
  occurrenceId: string | null,
  origin: string,
  input: z.infer<typeof promotionDownloadRecordSchema>,
) {
  const source = await prepareOwnPromotionRequest(db, request, env, slug, occurrenceId, origin),
    location = await promotionRenderLocation(source.actor.subjectId, occurrenceId, input.fingerprint, input.format);
  const command = preparePromotionDownloadRecording(
    db,
    { slug },
    occurrenceId,
    source.actor.subjectId,
    input.format,
    location.id,
    source.authority,
  );
  const loaded = await db.batch([...command.statements, ...source.statements]);
  const current = await source.decodeContext(loaded.slice(command.statements.length));
  if (!command.decode(loaded.slice(0, command.statements.length)))
    throw new AppError(404, "PROMOTION_ARTIFACT_NOT_FOUND", "Prepared material not found.");
  return current.basis.metrics;
}
