import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { agendaOccurrenceRoomIds } from "../../../../assets/shared/event-agenda-rooms";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAgendaPushChangeNotifications } from "../event-participation/web-push-intents";

/** Set-based durable enqueue: recipient counts do not add queries to approval. */
export async function prepareAgendaChangeNotifications(
  db: DatabaseLike,
  eventId: string,
  nextRevision: number,
  snapshot: AgendaSnapshot,
) {
  const prior = await first<{ snapshot_json: string }>(
    db,
    "SELECT publication.snapshot_json FROM event_agenda_publications publication JOIN event_agenda_state state ON state.event_id=publication.event_id AND state.published_revision=publication.revision WHERE publication.event_id=?",
    [eventId],
  );
  if (!prior) return [];
  const previous = JSON.parse(prior.snapshot_json) as AgendaSnapshot;
  const changed = previous.occurrences
    .filter((item) => {
      const next = snapshot.occurrences.find((candidate) => candidate.id === item.id);
      if (!next) return true;
      const previousRooms = agendaOccurrenceRoomIds(item);
      const nextRooms = agendaOccurrenceRoomIds(next);
      return (
        next.title !== item.title ||
        next.startAt !== item.startAt ||
        next.endAt !== item.endAt ||
        next.roomId !== item.roomId ||
        previousRooms.length !== nextRooms.length ||
        previousRooms.some((roomId) => !nextRooms.includes(roomId))
      );
    })
    .map((item) => item.id);
  if (!changed.length) return [];
  const now = nowIso();
  return [
    ...prepareAgendaPushChangeNotifications(db, eventId, nextRevision, changed),
    db
      .prepare(
        `INSERT INTO email_outbox(id,event_id,template_key,recipient_user_id,recipient_email,subject,payload_json,message_type,provider,status,attempts,send_after,created_at,updated_at,idempotency_key)
 SELECT lower(hex(randomblob(16))),?,'agenda_changed',user.id,user.email,'Your event schedule has changed',json_object('eventName',event.name,'agendaRevision',?), 'transactional','sendgrid','queued',0,?,?,?,'agenda-change:' || ? || ':' || ? || ':' || user.id
 FROM users user JOIN events event ON event.id=? WHERE user.active=1 AND EXISTS(SELECT 1 FROM agenda_session_participations participation JOIN json_each(?) changed ON changed.value=participation.occurrence_id WHERE participation.event_id=event.id AND participation.user_id=user.id AND participation.status IN('reserved','saved','approval_pending'))
 ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      )
      .bind(eventId, nextRevision, now, now, now, eventId, nextRevision, eventId, JSON.stringify(changed)),
  ];
}
