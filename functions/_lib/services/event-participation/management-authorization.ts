import { requireIdentityFromRequest } from "../../auth/user-session";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { computeGrantsForUser, hasPermission, guardPermissionDatabase } from "../../auth/permissions";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { guardDatabaseBatches } from "../../db/guarded-database";
import { requestDb, type AdminContext } from "../../db/context";
import { getEventBySlug } from "../events";
import { AppError } from "../../errors";
import { participantSessionDatabase } from "./self-authorization";
/** Ordinary speakers can manage one assigned session only after an explicit organizer delegation. */
export async function requireSessionParticipantManager(c: AdminContext, slug: string, occurrenceId: string) {
  const db = requestDb(c),
    identity = await requireIdentityFromRequest(db, c.req.raw, c.env),
    event = await getEventBySlug(db, slug);
  const actor = createUserBackedAuthAdmin({
    id: identity.userId,
    email: identity.email,
    sessionId: identity.sessionId,
    grants: await computeGrantsForUser(db, identity.userId),
  });
  const context = { type: "event", id: event.id };
  const sessionDb = participantSessionDatabase(db, identity.userId, identity.sessionId);
  const canDelegate =
    hasPermission(actor, "agenda:participants_manage", context) || hasPermission(actor, "agenda:write", context);
  if (canDelegate) {
    const permission = hasPermission(actor, "agenda:participants_manage", context)
      ? "agenda:participants_manage"
      : "agenda:write";
    return {
      db: guardPermissionDatabase(
        sessionDb,
        actor,
        [{ permission, context }],
        () => new AppError(403, "PARTICIPANT_MANAGEMENT_CHANGED", "Your session management permission changed."),
      ),
      actor,
      event,
      canDelegate,
    };
  }
  const evidence = {
    sql: `SELECT 1 FROM agenda_session_delegations delegation JOIN event_agenda_occurrence_speakers speaker ON speaker.occurrence_id=delegation.occurrence_id AND speaker.user_id=delegation.user_id JOIN event_agenda_occurrences occurrence ON occurrence.id=delegation.occurrence_id
  WHERE delegation.occurrence_id=? AND delegation.user_id=? AND delegation.revoked_at IS NULL AND occurrence.event_id=?`,
    bindings: [occurrenceId, actor.id, event.id],
  };
  if (!(await first(db, evidence.sql, evidence.bindings)))
    throw new AppError(
      403,
      "SESSION_MANAGEMENT_REQUIRED",
      "An organizer must delegate management of your assigned session.",
    );
  const guarded = guardDatabaseBatches(sessionDb, async (statements) => {
    try {
      const [, ...results] = await sessionDb.batch([prepareAuthorizationGuard(db, evidence), ...statements]);
      return results;
    } catch (error) {
      if (isAuthorizationGuardFailure(error))
        throw new AppError(403, "SESSION_DELEGATION_CHANGED", "Your session delegation changed.");
      throw error;
    }
  });
  return { db: guarded, actor, event, canDelegate: false };
}
