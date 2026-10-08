import { operationalAllocationCompatibleSql } from "./session-allocation";
import { resolvePhysicalSessionRoom } from "./session-room";
import { physicalAllocationAvailableSql } from "./session-allocation";
import { first } from "../../db/queries";
import { sessionHoldRequestSchema } from "../../../../assets/shared/schemas/event-session-holds";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { remoteOccupiedSql } from "./capacity-accounting";
import { publishedRoomsSql, publishedSessionsSql } from "./published-schedule";
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
  const session = await first<{ room_id: string | null; additional_room_ids_json: string }>(
    db,
    `SELECT room_id,additional_room_ids_json FROM (${publishedSessionsSql}) WHERE id=? AND event_id=?`,
    [occurrenceId, eventId],
  );
  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "Session not found.");
  const roomId = input.attendanceMode === "physical" ? resolvePhysicalSessionRoom(session, input.roomId) : null;
  const available =
    input.attendanceMode === "remote"
      ? `(s.remote_capacity IS NULL OR ${remoteOccupiedSql("s.id", "(SELECT user_id FROM target)")}<s.remote_capacity)`
      : `(${physicalAllocationAvailableSql("s", "(SELECT room_id FROM target)", "(SELECT user_id FROM target)")})`;
  const statement = db
    .prepare(
      `WITH target AS(SELECT ? AS user_id,? AS room_id) INSERT INTO agenda_session_holds(id,event_id,occurrence_id,user_id,attendance_mode,expires_at,created_by,reason_code,created_at,room_id)
  SELECT ?,s.event_id,s.id,(SELECT user_id FROM target),?,?,?,?,?,(SELECT room_id FROM target) FROM (${publishedSessionsSql}) s LEFT JOIN (${publishedRoomsSql}) room ON room.id=s.room_id AND room.event_id=s.event_id
  WHERE s.id=? AND s.event_id=? AND ${available} AND ${operationalAllocationCompatibleSql("s.id", "(SELECT user_id FROM target)", `'${input.attendanceMode}'`, "(SELECT room_id FROM target)")} AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .bind(
      input.userId,
      roomId,
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
  const result = await db
    .prepare(
      "SELECT id,user_id AS userId,attendance_mode AS attendanceMode,expires_at AS expiresAt,reason_code AS reasonCode,created_at AS createdAt FROM agenda_session_holds WHERE event_id=? AND occurrence_id=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY expires_at,id LIMIT 500",
    )
    .bind(eventId, occurrenceId)
    .all();
  return { items: result.results ?? [] };
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
