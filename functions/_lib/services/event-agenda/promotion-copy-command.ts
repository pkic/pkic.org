import type { DatabaseLike, Env } from "../../types";
import type { PromotionCopy } from "../../../../assets/shared/schemas/event-promotion-kit";
import { preparePromotionRequestActor } from "./promotion-request-context";
import { permissionAuthorizationEvidenceForResource } from "../../auth/permissions";
import {
  prepareAuthorizationGuard,
  prepareStateGuard,
  isAuthorizationGuardFailure,
  isStateGuardFailure,
} from "../../db/authorization-guard";
import { prepareAgendaRead } from "./read";
import { prepareAuditLogWhen } from "../audit";
import { eventReadIdSql } from "../events/selection";
import { AppError } from "../../errors";

/**
 * Promotion kits read shared copy live, so saving it leaves the agenda revision and publication alone.
 * The copy's own approval time is the concurrency token: agenda edits cannot refuse a save, a stale editor can.
 */
export async function savePromotionCopyRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  slug: string,
  occurrenceId: string,
  expectedApprovedAt: string | null,
  copy: PromotionCopy,
) {
  const actor = await preparePromotionRequestActor(db, request, env),
    event = eventReadIdSql({ slug });
  const permission = permissionAuthorizationEvidenceForResource(
    actor.permissionActor,
    "agenda:write",
    { type: "event", idSql: "(SELECT id FROM promotion_event)" },
    actor.memberSelection,
  );
  const authority = {
    sql: `WITH promotion_event AS MATERIALIZED(SELECT id FROM events WHERE slug=?), permitted AS MATERIALIZED(${permission.sql}), authenticated AS MATERIALIZED(${actor.managementAuthorizationEvidence.sql}) SELECT 1 FROM permitted,authenticated WHERE EXISTS(SELECT 1 FROM event_agenda_occurrences WHERE id=? AND event_id=(SELECT id FROM promotion_event))`,
    bindings: [slug, ...permission.bindings, ...actor.managementAuthorizationEvidence.bindings, occurrenceId],
  };
  const read = prepareAgendaRead(db, { slug }, slug);
  const audit = prepareAuditLogWhen(db, {
    actorType: "user",
    actorId: actor.subjectId,
    actorIdentityIdSelection: actor.actingIdentitySelection,
    action: "agenda.promotion_copy.saved",
    entityType: "event_agenda_occurrence",
    entityId: occurrenceId,
    scope: { type: "event", id: "" },
    scopeIdSelection: event,
    details: { approvedAt: copy.approvedAt },
    conditionSql: "SELECT 1",
    conditionBindings: [],
  });
  try {
    const loaded = await db.batch([
      ...actor.statements,
      prepareAuthorizationGuard(db, authority),
      prepareStateGuard(db, {
        sql: "SELECT 1 FROM event_agenda_occurrences WHERE id=? AND json_extract(promotion_copy_json,'$.approvedAt') IS ?",
        bindings: [occurrenceId, expectedApprovedAt],
      }),
      db
        .prepare("UPDATE event_agenda_occurrences SET promotion_copy_json=? WHERE id=?")
        .bind(JSON.stringify(copy), occurrenceId),
      audit,
      ...read.statements,
    ]);
    await actor.decode(loaded.slice(0, actor.statements.length));
    return read.decode(loaded.slice(-read.statements.length));
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(403, "AGENDA_AUTHORIZATION_CHANGED", "Agenda permission or session access changed.");
    if (isStateGuardFailure(error))
      throw new AppError(
        409,
        "PROMOTION_COPY_CHANGED",
        "Someone else changed this promotion copy. Reload the page to review the latest version.",
      );
    throw error;
  }
}
