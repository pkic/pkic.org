import { prepareUserSessionRequest } from "../../auth/user-session-request";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { hasPermission, guardPermissionDatabase } from "../../auth/permissions";
import { batchFirst } from "../../db/pagination";
import { guardAuthorizedDatabase } from "../../db/authorization-guard";
import { requestDb, type AdminContext } from "../../db/context";
import { prepareEventBySlug, type EventRecord } from "../events";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import type { DatabaseLike, D1StatementResult, Env, StatementLike } from "../../types";
import { AppError } from "../../errors";
import { participantSessionDatabase } from "./self-authorization";
/** Ordinary speakers can manage one assigned session only after an explicit organizer delegation. */
export async function requireSessionParticipantManager(c: AdminContext, slug: string, occurrenceId: string) {
  const db = requestDb(c);
  const read = await prepareSessionParticipantManager(db, c.req.raw, c.env, slug, occurrenceId);
  return read.decode(await db.batch(read.statements));
}

/** Live human session, context-free event grants, and exact speaker delegation share one snapshot. */
async function prepareSessionParticipantManager(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  slug: string,
  occurrenceId: string,
) {
  const auth = await prepareUserSessionRequest(db, request, env);
  const scope = eventReadIdSql({ slug });
  const evidence = {
    sql: `SELECT 1 FROM agenda_session_delegations delegation JOIN event_agenda_occurrence_speakers speaker ON speaker.occurrence_id=delegation.occurrence_id AND speaker.user_id=delegation.user_id JOIN event_agenda_occurrences occurrence ON occurrence.id=delegation.occurrence_id
  WHERE delegation.occurrence_id=? AND delegation.user_id=? AND delegation.revoked_at IS NULL AND occurrence.event_id=${scope.sql}`,
    bindings: [occurrenceId, auth.claims.sub, ...scope.bindings],
  };
  return {
    statements: [...auth.statements, prepareEventBySlug(db, slug), db.prepare(evidence.sql).bind(...evidence.bindings)],
    async decode(loaded: D1StatementResult[]) {
      const session = await auth.decode(loaded.slice(0, auth.statements.length));
      const event = batchFirst<EventRecord>(loaded[auth.statements.length]);
      if (!event) throw new AppError(404, "EVENT_NOT_FOUND", `Event '${slug}' not found`);
      const actor = createUserBackedAuthAdmin({
        id: session.identity.id,
        email: session.identity.email,
        sessionId: session.sessionId,
        // Session management has always used the person's grants without a represented member context.
        grants: auth.grantsForContext(loaded.slice(0, auth.statements.length), null),
      });
      const context = { type: "event", id: event.id };
      const sessionDb = participantSessionDatabase(db, actor.id, session.sessionId);
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
      if (!batchFirst(loaded[auth.statements.length + 1]))
        throw new AppError(
          403,
          "SESSION_MANAGEMENT_REQUIRED",
          "An organizer must delegate management of your assigned session.",
        );
      const guarded = guardAuthorizedDatabase(
        sessionDb,
        evidence,
        () => new AppError(403, "SESSION_DELEGATION_CHANGED", "Your session delegation changed."),
      );
      return { db: guarded, actor, event, canDelegate: false };
    },
  };
}

/** Release management data only after the same live authorization snapshot has decoded. */
export async function readSessionParticipantResource<T>(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  slug: string,
  occurrenceId: string,
  prepare: (event: EventReadSelection) => {
    statements: StatementLike[];
    decode(
      loaded: D1StatementResult[],
      context: Awaited<ReturnType<typeof requireSessionParticipantManager>>,
    ): T | Promise<T>;
  },
) {
  const context = await prepareSessionParticipantManager(db, request, env, slug, occurrenceId);
  const read = prepare({ slug });
  const loaded = await db.batch([...context.statements, ...read.statements]);
  const authorized = await context.decode(loaded.slice(0, context.statements.length));
  return read.decode(loaded.slice(context.statements.length), authorized);
}
