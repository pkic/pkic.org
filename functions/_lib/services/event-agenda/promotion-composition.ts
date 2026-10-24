import { prepareAuditLogAfterOneChange, isAuditChangeGuardFailure } from "../audit";
import { permissionsAuthorizationEvidence } from "../../auth/permissions";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import {
  promotionCompositionSchema,
  defaultPromotionComposition,
} from "../../../../assets/shared/schemas/event-promotion-design";
import type { z } from "zod";
import { promotionCompositionSaveSchema } from "../../../../assets/shared/schemas/event-promotion-design";
import type { DatabaseLike } from "../../types";
import { first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { sha256Hex } from "../../utils/crypto";
import { AppError } from "../../errors";
export async function promotionKitId(eventId: string, userId: string, occurrenceId: string | null) {
  return sha256Hex(JSON.stringify([eventId, userId, occurrenceId]));
}
export async function readPromotionComposition(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  occurrenceId: string | null,
) {
  const id = await promotionKitId(eventId, userId, occurrenceId);
  const row = await first<{ revision: number; composition_json: string }>(
    db,
    "SELECT revision,composition_json FROM event_promotion_kits WHERE id=?",
    [id],
  );
  return {
    id,
    revision: row?.revision ?? 0,
    composition: row
      ? promotionCompositionSchema.parse(JSON.parse(row.composition_json))
      : defaultPromotionComposition(occurrenceId === null),
  };
}
/** Authorization and official source resolution happen before this owner's atomic compare-and-set. */
export async function savePromotionComposition(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  occurrenceId: string | null,
  input: z.infer<typeof promotionCompositionSaveSchema>,
  availableSessionIds: readonly string[] = [],
) {
  if (input.composition.sessionIds.some((id) => !availableSessionIds.includes(id)))
    throw new AppError(422, "PROMOTION_PICK_UNAVAILABLE", "Choose public sessions from this event.");
  const id = await promotionKitId(eventId, userId, occurrenceId),
    at = nowIso();
  const statement = db
    .prepare(`INSERT INTO event_promotion_kits(id,event_id,user_id,occurrence_id,revision,composition_json,updated_at)
 SELECT ?,?,?,?,1,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM event_promotion_kits WHERE id=? AND revision=?)
 ON CONFLICT(id) DO UPDATE SET composition_json=excluded.composition_json,revision=event_promotion_kits.revision+1,updated_at=excluded.updated_at
 WHERE event_promotion_kits.revision=?`)
    .bind(
      id,
      eventId,
      userId,
      occurrenceId,
      JSON.stringify(input.composition),
      at,
      input.expectedRevision,
      id,
      input.expectedRevision,
      input.expectedRevision,
    );
  const management = permissionsAuthorizationEvidence(createUserBackedAuthAdmin({ id: userId, email: "" }), [
    { permission: "agenda:write", context: { type: "event", id: eventId } },
  ]);
  const entitlement = occurrenceId
    ? {
        sql: `SELECT 1 WHERE EXISTS(SELECT 1 FROM event_agenda_occurrence_speakers speaker JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id WHERE occurrence.event_id=? AND occurrence.id=? AND speaker.user_id=?) OR EXISTS(${management.sql})`,
        bindings: [eventId, occurrenceId, userId, ...management.bindings],
      }
    : {
        sql: "SELECT 1 FROM registrations WHERE event_id=? AND user_id=? AND status='registered'",
        bindings: [eventId, userId],
      };
  try {
    await db.batch([
      prepareAuthorizationGuard(db, entitlement),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
        bindings: [userId],
      }),
      statement,
      prepareAuditLogAfterOneChange(
        db,
        "user",
        userId,
        "promotion_composition_saved",
        "event",
        eventId,
        { kitId: id, revision: input.expectedRevision + 1 },
        at,
        { type: "event", id: eventId },
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(403, "PROMOTION_ACCESS_CHANGED", "Your access to these promotion materials changed.");
    if (isAuditChangeGuardFailure(error))
      throw new AppError(409, "PROMOTION_COMPOSITION_CHANGED", "Your kit changed. Reload it before saving.");
    throw error;
  }
  return readPromotionComposition(db, eventId, userId, occurrenceId);
}
