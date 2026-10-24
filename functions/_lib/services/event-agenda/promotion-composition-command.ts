import { promotionSessionPicksEvidence } from "./promotion-composition";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { promotionReferralOwnerSql } from "./promotion-referral";
import type { z } from "zod";
import type { DatabaseLike, Env } from "../../types";
import { promotionCompositionSaveSchema } from "../../../../assets/shared/schemas/event-promotion-design";
import { prepareOwnPromotionRequest, preparePromotionRequestActor } from "./promotion-request-context";
import { prepareAuditLogWhen } from "../audit";
import { eventReadIdSql } from "../events/selection";
import { nowIso } from "../../utils/time";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";

/** Conditional CAS, source validation, audit, referral initialization, and response use one atomic batch. */
export async function saveOwnPromotionComposition(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  slug: string,
  occurrenceId: string | null,
  origin: string,
  input: z.infer<typeof promotionCompositionSaveSchema>,
) {
  const actor = await preparePromotionRequestActor(db, request, env),
    event = eventReadIdSql({ slug }),
    auditId = crypto.randomUUID(),
    at = nowIso();
  const response = await prepareOwnPromotionRequest(db, request, env, slug, occurrenceId, origin, true, actor, {
    sql: "SELECT 1 FROM audit_log WHERE id=?",
    bindings: [auditId],
  });
  const picks = promotionSessionPicksEvidence(
    { slug },
    {
      sql: "SELECT ?",
      bindings: [JSON.stringify(input.composition.sessionIds)],
    },
  );
  const command = db
    .prepare(`WITH allowed AS MATERIALIZED(${response.authority.sql}), valid_picks AS MATERIALIZED(${picks.sql}) INSERT INTO event_promotion_kits(id,event_id,user_id,occurrence_id,revision,composition_json,updated_at)
    SELECT ?,${event.sql},?,?,1,?,? FROM allowed,valid_picks WHERE ?=0 OR EXISTS(SELECT 1 FROM event_promotion_kits WHERE event_id=${event.sql} AND user_id=? AND occurrence_id IS ? AND revision=?)
    ON CONFLICT DO UPDATE SET composition_json=excluded.composition_json,revision=event_promotion_kits.revision+1,updated_at=excluded.updated_at WHERE event_promotion_kits.revision=?`)
    .bind(
      ...response.authority.bindings,
      ...picks.bindings,
      crypto.randomUUID(),
      ...event.bindings,
      actor.subjectId,
      occurrenceId,
      JSON.stringify(input.composition),
      at,
      input.expectedRevision,
      ...event.bindings,
      actor.subjectId,
      occurrenceId,
      input.expectedRevision,
      input.expectedRevision,
    );
  const flags = db
    .prepare(
      `WITH valid_picks AS MATERIALIZED(${picks.sql}) SELECT changes() AS applied,EXISTS(SELECT 1 FROM valid_picks) AS picks_valid`,
    )
    .bind(...picks.bindings);
  const audit = prepareAuditLogWhen(db, {
    id: auditId,
    actorType: "user",
    actorId: actor.subjectId,
    actorIdentityIdSelection: actor.actingIdentitySelection,
    action: "promotion_composition_saved",
    entityType: "event",
    entityId: null,
    entityIdSelection: event,
    scope: { type: "event", id: "" },
    scopeIdSelection: event,
    details: { occurrenceId, revision: input.expectedRevision + 1 },
    createdAt: at,
    conditionSql: "SELECT 1 WHERE changes()=1",
    conditionBindings: [],
  });
  const owner = promotionReferralOwnerSql({ slug }, actor.subjectId);
  let loaded;
  try {
    loaded = await db.batch([
      command,
      flags,
      audit,
      ...response.statements,
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM audit_log WHERE id=?) OR EXISTS(${owner.sql})`,
        bindings: [auditId, ...owner.bindings],
      }),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(409, "PROMOTION_REFERRAL_CHANGED", "Could not prepare your referral link. Try again.");
    throw error;
  }
  const context = await response.decodeContext(loaded.slice(3, 3 + response.statements.length));
  const state = batchFirst<{ applied: number; picks_valid: number }>(loaded[1]);
  if (!state?.picks_valid)
    throw new AppError(422, "PROMOTION_PICK_UNAVAILABLE", "Choose public sessions from this event.");
  if (state.applied !== 1)
    throw new AppError(409, "PROMOTION_COMPOSITION_CHANGED", "Your kit changed. Reload it before saving.");
  return response.assemble(context);
}
