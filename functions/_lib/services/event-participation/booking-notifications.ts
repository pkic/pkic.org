import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { publishedSessionsSql } from "./published-schedule";
/** Essential state-change notices are durable and deduplicated by allocation revision, not preference edits. */
export function prepareBookingNotification(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  userId: string,
  onlyReserved = false,
) {
  const now = nowIso();
  return db
    .prepare(
      `INSERT INTO email_outbox(id,event_id,template_key,recipient_user_id,recipient_email,subject,payload_json,message_type,provider,status,attempts,send_after,created_at,updated_at,idempotency_key)
  SELECT ?,p.event_id,'agenda_session_booking',person.id,person.email,'Session registration updated',json_object('eventName',event.name,'sessionTitle',s.title,'participationStatus',REPLACE(p.status,'_',' '),'attendanceMode',CASE p.attendance_mode WHEN 'physical' THEN 'in person' ELSE 'remote' END),'transactional','sendgrid','queued',0,?,?,?,'agenda-booking:'||p.id||':'||p.allocation_revision
  FROM agenda_session_participations p JOIN users person ON person.id=p.user_id AND person.active=1 JOIN events event ON event.id=p.event_id JOIN (${publishedSessionsSql}) s ON s.id=p.occurrence_id AND s.event_id=p.event_id
  WHERE p.event_id=? AND p.occurrence_id=? AND p.user_id=? AND p.status<>'saved' AND (?=0 OR p.status='reserved')
  ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    )
    .bind(crypto.randomUUID(), now, now, now, eventId, occurrenceId, userId, onlyReserved ? 1 : 0);
}
export function prepareEventBookingNotifications(db: DatabaseLike, eventId: string, userId?: string) {
  const now = nowIso();
  return db
    .prepare(
      `INSERT INTO email_outbox(id,event_id,template_key,recipient_user_id,recipient_email,subject,payload_json,message_type,provider,status,attempts,send_after,created_at,updated_at,idempotency_key)
  SELECT lower(hex(randomblob(16))),p.event_id,'agenda_session_booking',person.id,person.email,'Session registration updated',json_object('eventName',event.name,'sessionTitle',CASE WHEN p.status='canceled' THEN COALESCE(entry.title,'Session') ELSE COALESCE(s.title,entry.title,'Session') END,'participationStatus',REPLACE(p.status,'_',' '),'attendanceMode',CASE p.attendance_mode WHEN 'physical' THEN 'in person' ELSE 'remote' END),'transactional','sendgrid','queued',0,?,?,?,'agenda-booking:'||p.id||':'||p.allocation_revision
  FROM agenda_session_participations p JOIN users person ON person.id=p.user_id AND person.active=1 JOIN events event ON event.id=p.event_id LEFT JOIN (${publishedSessionsSql}) s ON s.id=p.occurrence_id AND s.event_id=p.event_id
  LEFT JOIN agenda_calendar_entries entry ON entry.occurrence_id=p.occurrence_id AND entry.event_id=p.event_id AND entry.user_id=p.user_id
  WHERE p.event_id=? ${userId ? "AND p.user_id=?" : ""} AND p.status<>'saved' AND (p.allocation_revision>0 OR p.status IN ('reserved','approval_pending','waitlisted'))
  ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    )
    .bind(now, now, now, eventId, ...(userId ? [userId] : []));
}
