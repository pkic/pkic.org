import type { DatabaseLike, Env } from "../../types";
import type { PromotionCopy } from "../../../../assets/shared/schemas/event-promotion-kit";
import { preparePromotionRequestActor } from "./promotion-request-context";
import { permissionAuthorizationEvidenceForResource } from "../../auth/permissions";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { prepareAgendaRevisionCommit, throwAgendaRevisionError } from "./revision";
import { prepareAgendaRead } from "./read";
import { prepareAuditLogWhen } from "../audit";
import { eventReadIdSql } from "../events/selection";
import { AppError } from "../../errors";

/** Shared editorial copy is an authorized agenda revision, including its canonical transition guards. */
export async function savePromotionCopyRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  slug: string,
  occurrenceId: string,
  revision: number,
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
    action: "agenda.revision.updated",
    entityType: "event_agenda",
    entityId: null,
    entityIdSelection: event,
    scope: { type: "event", id: "" },
    scopeIdSelection: event,
    details: { fromRevision: revision, toRevision: revision + 1 },
    conditionSql: "SELECT 1",
    conditionBindings: [],
  });
  try {
    const loaded = await db.batch([
      ...actor.statements,
      prepareAuthorizationGuard(db, authority),
      ...prepareAgendaRevisionCommit(
        db,
        { slug },
        revision,
        [
          db
            .prepare("UPDATE event_agenda_occurrences SET promotion_copy_json=? WHERE id=?")
            .bind(JSON.stringify(copy), occurrenceId),
        ],
        audit,
        read.statements,
      ),
    ]);
    await actor.decode(loaded.slice(0, actor.statements.length));
    return read.decode(loaded.slice(-read.statements.length));
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(403, "AGENDA_AUTHORIZATION_CHANGED", "Agenda permission or session access changed.");
    throwAgendaRevisionError(error);
  }
}
