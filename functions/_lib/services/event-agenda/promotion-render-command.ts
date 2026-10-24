import { promotionSessionPicksEvidence } from "./promotion-composition";
import type { z } from "zod";
import type { DatabaseLike, Env } from "../../types";
import { promotionRenderRequestSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import { prepareOwnPromotionRequest } from "./promotion-request-context";
import { preparePromotionRenderRequests } from "./promotion-render-request";
import { eventReadIdSql } from "../events/selection";
import { promotionReferralOwnerSql } from "./promotion-referral";
import { AppError } from "../../errors";

/** Enqueue only. Rendering and every retry remain with the scheduler's durable owner. */
export async function queueOwnPromotionRenders(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  slug: string,
  occurrenceId: string | null,
  origin: string,
  input: z.infer<typeof promotionRenderRequestSchema>,
) {
  const source = await prepareOwnPromotionRequest(db, request, env, slug, occurrenceId, origin),
    event = eventReadIdSql({ slug }),
    owner = promotionReferralOwnerSql({ slug }, source.actor.subjectId);
  const picks = promotionSessionPicksEvidence(
    { slug },
    {
      sql: `SELECT json_extract(composition_json,'$.sessionIds') FROM event_promotion_kits WHERE event_id=${event.sql} AND user_id=? AND occurrence_id IS ?`,
      bindings: [...event.bindings, source.actor.subjectId, occurrenceId],
    },
  );
  const allowed = {
    sql: `WITH entitled AS MATERIALIZED(${source.authority.sql}) SELECT 1 FROM entitled WHERE EXISTS(SELECT 1 FROM events event LEFT JOIN event_agenda_state state ON state.event_id=event.id WHERE event.id=${event.sql} AND COALESCE(state.published_revision,1)=?) AND COALESCE((SELECT revision FROM event_promotion_kits WHERE event_id=${event.sql} AND user_id=? AND occurrence_id IS ?),0)=? AND EXISTS(${owner.sql})${occurrenceId ? "" : ` AND EXISTS(${picks.sql})`}`,
    bindings: [
      ...source.authority.bindings,
      ...event.bindings,
      input.publishedRevision,
      ...event.bindings,
      source.actor.subjectId,
      occurrenceId,
      input.compositionRevision,
      ...owner.bindings,
      ...(occurrenceId ? [] : picks.bindings),
    ],
  };
  const queue = await preparePromotionRenderRequests(
    db,
    { slug },
    source.actor.subjectId,
    occurrenceId,
    input.publishedRevision,
    input.fingerprint,
    input.formats,
    origin,
    allowed,
  );
  const loaded = await db.batch([...queue.statements, ...source.statements]);
  const current = await source.decode(loaded.slice(queue.statements.length));
  if (current.kit.stale)
    throw new AppError(
      409,
      "PROMOTION_SESSION_UNAVAILABLE",
      "Review and save your session picks before preparing downloads.",
    );
  if (
    current.kit.fingerprint !== input.fingerprint ||
    current.kit.publishedRevision !== input.publishedRevision ||
    current.kit.compositionRevision !== input.compositionRevision
  )
    throw new AppError(
      409,
      "PROMOTION_SOURCE_CHANGED",
      "Your materials changed. Refresh your kit before preparing downloads.",
    );
  queue.decode(loaded.slice(0, queue.statements.length));
  return current.kit;
}
