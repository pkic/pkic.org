import { permissionAuthorizationEvidenceForResource } from "../../auth/permissions";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { D1StatementResult, DatabaseLike } from "../../types";
import type { PromotionRequestActor } from "./promotion-request-context";

/** Selects the material owner without changing the authenticated actor. */
export function preparePromotionParticipant(
  db: DatabaseLike,
  actor: PromotionRequestActor,
  eventSlug: string,
  targetUserId?: string,
  occurrenceId?: string | null,
) {
  const userId = targetUserId ?? actor.subjectId;
  if (userId === actor.subjectId) return { userId, statements: [], decode: (_rows: D1StatementResult[]) => {} };
  const permission = permissionAuthorizationEvidenceForResource(
    actor.permissionActor,
    "events:manage",
    { type: "event", idSql: "(SELECT id FROM promotion_event)" },
    actor.memberSelection,
  );
  const eligibility =
    occurrenceId === undefined
      ? "1=1"
      : occurrenceId === null
        ? "EXISTS(SELECT 1 FROM registrations WHERE event_id=event.id AND user_id=? AND status='registered')"
        : "EXISTS(SELECT 1 FROM event_agenda_occurrence_speakers speaker JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id WHERE occurrence.event_id=event.id AND occurrence.id=? AND speaker.user_id=?)";
  const authority = {
    sql: `WITH promotion_event AS MATERIALIZED(SELECT id FROM events WHERE slug=?), promotion_permission AS MATERIALIZED(${permission.sql}), promotion_staff AS MATERIALIZED(${actor.managementAuthorizationEvidence.sql}) SELECT 1 FROM promotion_event event,promotion_permission,promotion_staff WHERE ${eligibility}`,
    bindings: [
      eventSlug,
      ...permission.bindings,
      ...actor.managementAuthorizationEvidence.bindings,
      ...(occurrenceId === undefined ? [] : occurrenceId === null ? [userId] : [occurrenceId, userId]),
    ],
  };
  return {
    userId,
    authority,
    statements: [db.prepare(authority.sql).bind(...authority.bindings)],
    decode(rows: D1StatementResult[]) {
      if (!batchFirst(rows[0]))
        throw new AppError(
          403,
          "PROMOTION_PARTICIPANT_FORBIDDEN",
          "You cannot open this participant's promotion materials.",
        );
    },
  };
}
