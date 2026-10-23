import { operationalAllocationCompatibleSql } from "./session-allocation";
import { physicalAllocationAvailableSql } from "./session-allocation";
import { first } from "../../db/queries";
import { sessionHoldRequestSchema, sessionHoldListSchema } from "../../../../assets/shared/schemas/event-session-holds";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import { batchRows } from "../../db/pagination";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { readSessionParticipantResource } from "./management-authorization";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { remoteOccupiedSql } from "./capacity-accounting";
import { publishedSessionsSql } from "./published-schedule";
import { prepareParticipationWork } from "./reconciliation";
import { promoteSessionWaitlist } from "./waitlist";
/** A hold is explicit allocation, never event registration or an admission entitlement. */
export async function createSessionHold(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  actorId: string,
  raw: unknown,
) {
  const input = sessionHoldRequestSchema.parse(raw);
  const now = nowIso();
  if (input.expiresAt <= now || new Date(input.expiresAt).getTime() > Date.now() + 7 * 86400000)
    throw new AppError(409, "HOLD_EXPIRY_INVALID", "Choose an expiry within the next seven days.");
  const id = crypto.randomUUID();
  const session = await first<{ id: string }>(
    db,
    `SELECT id FROM (${publishedSessionsSql}) WHERE id=? AND event_id=?`,
    [occurrenceId, eventId],
  );
  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "Session not found.");
  const available =
    input.attendanceMode === "remote"
      ? `(s.remote_capacity IS NULL OR ${remoteOccupiedSql("s.id", "(SELECT user_id FROM target)")}<s.remote_capacity)`
      : `(${physicalAllocationAvailableSql("s", "(SELECT user_id FROM target)")})`;
  const statement = db
    .prepare(
      `WITH target AS(SELECT ? AS user_id) INSERT INTO agenda_session_holds(id,event_id,occurrence_id,user_id,attendance_mode,expires_at,created_by,reason_code,created_at)
  SELECT ?,s.event_id,s.id,(SELECT user_id FROM target),?,?,?,?,? FROM (${publishedSessionsSql}) s
  WHERE s.id=? AND s.event_id=? AND ${available} AND ${operationalAllocationCompatibleSql("s.id", "(SELECT user_id FROM target)", `'${input.attendanceMode}'`)} AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .bind(
      input.userId,
      id,
      input.attendanceMode,
      input.expiresAt,
      actorId,
      input.reasonCode,
      now,
      occurrenceId,
      eventId,
      input.expiresAt,
    );
  const [result] = await db.batch([
    statement,
    db
      .prepare(
        "INSERT INTO agenda_session_invitation_audit(id,event_id,occurrence_id,user_id,actor_id,action,reason_code,created_at) SELECT ?,event_id,occurrence_id,user_id,?,'create_hold',reason_code,? FROM agenda_session_holds WHERE id=? AND changes()=1",
      )
      .bind(crypto.randomUUID(), actorId, now, id),
    prepareParticipationWork(db, eventId),
  ]);
  if (!result.meta?.changes)
    throw new AppError(409, "HOLD_CAPACITY_CONFLICT", "No capacity is available for this hold.");
  return { id, expiresAt: input.expiresAt };
}
export async function listSessionHolds(db: DatabaseLike, eventId: string, occurrenceId: string) {
  const read = prepareSessionHolds(db, eventId, occurrenceId);
  return read.decode(await db.batch(read.statements));
}
export async function readSessionHoldsRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  slug: string,
  occurrenceId: string,
) {
  return readSessionParticipantResource(db, request, env, slug, occurrenceId, (event) => {
    const read = prepareSessionHolds(db, event, occurrenceId);
    return {
      statements: read.statements,
      decode(loaded, context) {
        if (!context.canDelegate)
          throw new AppError(403, "HOLD_ORGANIZER_REQUIRED", "Only organizers can manage counted holds.");
        return read.decode(loaded);
      },
    };
  });
}
function prepareSessionHolds(db: DatabaseLike, eventId: EventReadSelection, occurrenceId: string) {
  const scope = eventReadIdSql(eventId);
  return {
    statements: [
      db
        .prepare(
          `SELECT id,user_id AS userId,attendance_mode AS attendanceMode,expires_at AS expiresAt,reason_code AS reasonCode,created_at AS createdAt FROM agenda_session_holds WHERE event_id=${scope.sql} AND occurrence_id=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY expires_at,id LIMIT 500`,
        )
        .bind(...scope.bindings, occurrenceId),
    ],
    decode: (loaded: D1StatementResult[]) => sessionHoldListSchema.parse({ items: batchRows(loaded[0]) }),
  };
}
export async function revokeSessionHold(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  holdId: string,
  actorId: string,
) {
  const now = nowIso();
  const [result] = await db.batch([
    db
      .prepare(
        "UPDATE agenda_session_holds SET revoked_at=? WHERE id=? AND event_id=? AND occurrence_id=? AND revoked_at IS NULL",
      )
      .bind(now, holdId, eventId, occurrenceId),
    db
      .prepare(
        "INSERT INTO agenda_session_invitation_audit(id,event_id,occurrence_id,user_id,actor_id,action,reason_code,created_at) SELECT ?,event_id,occurrence_id,user_id,?,'revoke_hold',reason_code,? FROM agenda_session_holds WHERE id=? AND event_id=? AND occurrence_id=? AND changes()=1",
      )
      .bind(crypto.randomUUID(), actorId, now, holdId, eventId, occurrenceId),
    prepareParticipationWork(db, eventId),
  ]);
  const promoted = await promoteSessionWaitlist(db, eventId);
  return { revoked: Boolean(result.meta?.changes), promoted: promoted.promoted };
}
