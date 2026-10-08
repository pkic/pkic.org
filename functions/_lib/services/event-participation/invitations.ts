import { prepareScopedAuditLogAfterOneChange, isAuditChangeGuardFailure } from "../audit";
import { sessionInvitationCalendarContextSchema } from "../../../../assets/shared/schemas/event-session-rsvp";
import { prepareSessionInvitationCalendar, sessionInvitationContextSql } from "./session-invitation-calendar";
import { resolvePhysicalSessionRoom } from "./session-room";
import { first } from "../../db/queries";
import {
  sessionInvitationRequestSchema,
  sessionDelegationRequestSchema,
} from "../../../../assets/shared/schemas/event-session-management";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { preparePersonalCalendarEntries } from "./calendar-entries";
import { prepareParticipationWork } from "./reconciliation";
import { publishedSessionsSql } from "./published-schedule";
export async function setSessionInvitation(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  actorId: string,
  raw: unknown,
  delivery?: { secret: string; baseEmail?: string },
) {
  const input = sessionInvitationRequestSchema.parse(raw);
  if (input.action === "add")
    throw new AppError(
      400,
      "SESSION_ADD_REQUIRES_ALLOCATION",
      "Use the authorized registration allocation command to add an attendee.",
    );
  const session = await first<{
    room_id: string | null;
    additional_room_ids_json: string;
    context: string;
    room_name: string | null;
    email: string | null;
    sequence: number;
  }>(
    db,
    `SELECT s.room_id,s.additional_room_ids_json,${sessionInvitationContextSql} AS context,(SELECT json_extract(room.value,'$.name') FROM event_agenda_publications publication JOIN event_agenda_state state ON state.event_id=publication.event_id AND state.published_revision=publication.revision JOIN json_each(publication.snapshot_json,'$.rooms') room WHERE publication.event_id=s.event_id AND json_extract(room.value,'$.id')=COALESCE(?,s.room_id)) AS room_name,(SELECT email FROM users WHERE id=? AND active=1) AS email,MAX(COALESCE((SELECT current.reply_sequence+1 FROM agenda_session_invitations current WHERE current.occurrence_id=s.id AND current.user_id=?),0),COALESCE((SELECT entry.sequence+1 FROM agenda_calendar_entries entry WHERE entry.event_id=s.event_id AND entry.occurrence_id=s.id AND entry.user_id=?),0)) AS sequence FROM (${publishedSessionsSql}) s WHERE s.id=? AND s.event_id=?`,
    [input.roomId ?? null, input.userId, input.userId, input.userId, occurrenceId, eventId],
  );
  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "Session not found.");
  const roomId =
    input.attendanceMode === "physical" && input.action === "invite"
      ? resolvePhysicalSessionRoom(session, input.roomId)
      : null;
  if (input.action === "invite" && session.email) {
    const current = await first<{ id: string; reply_sequence: number }>(
      db,
      `SELECT id,reply_sequence FROM agenda_session_invitations WHERE event_id=? AND occurrence_id=? AND user_id=?
       AND revoked_at IS NULL AND reply_context_json=? AND reply_mode=? AND room_id IS ? AND reason_code=?
       AND EXISTS(SELECT 1 FROM email_outbox delivery WHERE delivery.idempotency_key='agenda-invitation:'||agenda_session_invitations.id AND delivery.recipient_email=?)`,
      [
        eventId,
        occurrenceId,
        input.userId,
        session.context,
        input.attendanceMode,
        roomId,
        input.reasonCode,
        session.email,
      ],
    );
    if (current) {
      // Retry the same semantic invitation without rotating its reply token or
      // scheduling another delivery. Verify the observed identity and source
      // inside the database command, so a concurrent revoke/reissue cannot be
      // acknowledged using an earlier read.
      const [retry] = await db.batch([
        db
          .prepare(
            `UPDATE agenda_session_invitations SET id=id WHERE id=? AND event_id=? AND occurrence_id=? AND user_id=?
         AND revoked_at IS NULL AND reply_context_json=? AND reply_mode=? AND room_id IS ? AND reason_code=? AND reply_sequence=?
         AND EXISTS(SELECT 1 FROM users person WHERE person.id=? AND person.active=1 AND person.email=?)
         AND EXISTS(SELECT 1 FROM (${publishedSessionsSql}) s WHERE s.event_id=? AND s.id=? AND ${sessionInvitationContextSql}=?)`,
          )
          .bind(
            current.id,
            eventId,
            occurrenceId,
            input.userId,
            session.context,
            input.attendanceMode,
            roomId,
            input.reasonCode,
            current.reply_sequence,
            input.userId,
            session.email,
            eventId,
            occurrenceId,
            session.context,
          ),
      ]);
      if (!retry.meta?.changes)
        throw new AppError(
          409,
          "SESSION_INVITATION_CONFLICT",
          "The invitation changed. Reload before sending it again.",
        );
      return { invited: true };
    }
  }
  const now = nowIso();
  const invitationId = crypto.randomUUID();
  const calendar =
    input.action === "invite" && delivery && session.email
      ? await prepareSessionInvitationCalendar({
          invitationId,
          occurrenceId,
          recipientEmail: session.email,
          sequence: session.sequence,
          context: sessionInvitationCalendarContextSchema.parse(JSON.parse(session.context)),
          mode: input.attendanceMode,
          roomName: session.room_name,
          issuedAt: now,
          ...delivery,
        })
      : {};
  const invitation =
    input.action === "invite"
      ? db
          .prepare(
            `INSERT INTO agenda_session_invitations(id,event_id,occurrence_id,user_id,invited_by,reason_code,created_at,room_id,reply_context_json,reply_mode,reply_revision,reply_sequence)
  SELECT ?,s.event_id,s.id,?,?,?,?,?, ?,?,0,? FROM (${publishedSessionsSql}) s JOIN users person ON person.id=? AND person.active=1 WHERE s.id=? AND s.event_id=? AND ${sessionInvitationContextSql}=? AND MAX(COALESCE((SELECT current.reply_sequence+1 FROM agenda_session_invitations current WHERE current.occurrence_id=s.id AND current.user_id=?),0),COALESCE((SELECT entry.sequence+1 FROM agenda_calendar_entries entry WHERE entry.event_id=s.event_id AND entry.occurrence_id=s.id AND entry.user_id=?),0))=?
  ON CONFLICT(occurrence_id,user_id) DO UPDATE SET id=excluded.id,invited_by=excluded.invited_by,reason_code=excluded.reason_code,created_at=excluded.created_at,revoked_at=NULL,room_id=excluded.room_id,reply_context_json=excluded.reply_context_json,reply_mode=excluded.reply_mode,reply_revision=0,reply_sequence=excluded.reply_sequence`,
          )
          .bind(
            invitationId,
            input.userId,
            actorId,
            input.reasonCode,
            now,
            roomId,
            session.context,
            input.attendanceMode,
            session.sequence,
            input.userId,
            occurrenceId,
            eventId,
            session.context,
            input.userId,
            input.userId,
            session.sequence,
          )
      : db
          .prepare(
            "UPDATE agenda_session_invitations SET revoked_at=? WHERE occurrence_id=? AND event_id=? AND user_id=? AND revoked_at IS NULL",
          )
          .bind(now, occurrenceId, eventId, input.userId);
  const statements = [
    invitation,
    ...(input.action === "invite"
      ? [
          prepareScopedAuditLogAfterOneChange(
            db,
            { type: "event", id: eventId },
            "user",
            actorId,
            "session_invitation_issued",
            "agenda_session_invitation",
            invitationId,
            {
              occurrenceId,
              userId: input.userId,
              attendanceMode: input.attendanceMode,
              roomId,
              sequence: session.sequence,
              reasonCode: input.reasonCode,
            },
            now,
          ),
        ]
      : []),
    db
      .prepare(
        "INSERT INTO agenda_session_invitation_audit(id,event_id,occurrence_id,user_id,actor_id,action,reason_code,created_at) SELECT ?,?,?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(crypto.randomUUID(), eventId, occurrenceId, input.userId, actorId, input.action, input.reasonCode, now),
  ];
  if (input.action === "invite")
    statements.push(
      db
        .prepare(
          `INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at,approval_state,room_id)
   SELECT ?,event_id,occurrence_id,user_id,?,'saved',?,?,'invited',room_id FROM agenda_session_invitations WHERE event_id=? AND occurrence_id=? AND user_id=? AND revoked_at IS NULL
   ON CONFLICT(occurrence_id,user_id) DO UPDATE SET approval_state=CASE WHEN agenda_session_participations.approval_state IN ('none','declined') THEN 'invited' ELSE agenda_session_participations.approval_state END`,
        )
        .bind(crypto.randomUUID(), input.attendanceMode, now, now, eventId, occurrenceId, input.userId),
      db
        .prepare(
          `INSERT INTO email_outbox(id,event_id,template_key,recipient_user_id,recipient_email,subject,payload_json,message_type,provider,status,attempts,send_after,created_at,updated_at,idempotency_key)
   SELECT ?,s.event_id,'agenda_session_invitation',person.id,person.email,'Session invitation',json_patch(json_object('eventName',event.name,'sessionTitle',s.title,'__deliveryGuard',json_object('id',invite.id,'version',0)),json(?)),'transactional','sendgrid','queued',0,?,?,?,'agenda-invitation:'||invite.id
   FROM agenda_session_invitations invite JOIN users person ON person.id=invite.user_id AND person.active=1 JOIN (${publishedSessionsSql}) s ON s.id=invite.occurrence_id JOIN events event ON event.id=s.event_id
   WHERE invite.event_id=? AND invite.occurrence_id=? AND invite.user_id=? AND invite.revoked_at IS NULL
   ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
        )
        .bind(crypto.randomUUID(), JSON.stringify(calendar), now, now, now, eventId, occurrenceId, input.userId),
    );
  else
    statements.push(
      db
        .prepare(
          `UPDATE agenda_session_participations AS p SET status='canceled',allocation_revision=allocation_revision+1,approval_state='none',updated_at=? WHERE event_id=? AND occurrence_id=? AND user_id=?
   AND EXISTS(SELECT 1 FROM (${publishedSessionsSql}) s WHERE s.id=p.occurrence_id AND (s.access_policy='invitation' OR s.visibility='private'))`,
        )
        .bind(now, eventId, occurrenceId, input.userId),
    );
  statements.push(...preparePersonalCalendarEntries(db, eventId, input.userId), prepareParticipationWork(db, eventId));
  let result;
  try {
    [result] = await db.batch(statements);
  } catch (error) {
    if (isAuditChangeGuardFailure(error))
      throw new AppError(409, "SESSION_INVITATION_CONFLICT", "The invitation changed. Reload before sending it again.");
    throw error;
  }
  if (!result.meta?.changes && input.action === "invite")
    throw new AppError(409, "SESSION_INVITATION_CONFLICT", "Choose an active attendee and an approved session.");
  return { invited: input.action === "invite" };
}
export async function setSessionDelegation(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  actorId: string,
  raw: unknown,
) {
  const input = sessionDelegationRequestSchema.parse(raw),
    now = nowIso();
  const statement = db
    .prepare(
      `INSERT INTO agenda_session_delegations(occurrence_id,user_id,created_by,created_at,revoked_at)
  SELECT speaker.occurrence_id,speaker.user_id,?,?,? FROM event_agenda_occurrence_speakers speaker JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id WHERE speaker.occurrence_id=? AND speaker.user_id=? AND occurrence.event_id=?
  ON CONFLICT(occurrence_id,user_id) DO UPDATE SET created_by=excluded.created_by,created_at=excluded.created_at,revoked_at=excluded.revoked_at`,
    )
    .bind(actorId, now, input.enabled ? null : now, occurrenceId, input.userId, eventId);
  const [result] = await db.batch([
    statement,
    db
      .prepare(
        "INSERT INTO agenda_session_invitation_audit(id,event_id,occurrence_id,user_id,actor_id,action,reason_code,created_at) SELECT ?,?,?,?,?,?,'organizer_delegation',? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        eventId,
        occurrenceId,
        input.userId,
        actorId,
        input.enabled ? "delegate" : "revoke_delegation",
        now,
      ),
  ]);
  if (!result.meta?.changes)
    throw new AppError(
      409,
      "SESSION_SPEAKER_REQUIRED",
      "Only a speaker assigned to this session can receive this delegation.",
    );
  return { enabled: input.enabled };
}
