import { all, first } from "../../db/queries";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { webPushDeliverableSql } from "./web-push-delivery-policy";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
/** Atomic approval statements: caller batches with publication itself. No network effects. */
export function prepareAgendaPushChangeNotifications(
  db: DatabaseLike,
  eventId: string,
  nextRevision: number,
  changedIds: readonly string[],
) {
  if (!changedIds.length) return [];
  const now = nowIso(),
    expires = new Date(Date.now() + 86400000).toISOString();
  return [
    db
      .prepare(
        `INSERT INTO agenda_push_outbox(id,event_id,device_id,user_id,kind,source_version,idempotency_key,destination,due_at,expires_at,next_attempt_at,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),event.id,device.id,device.user_id,'agenda_changed',?,'agenda-change:'||event.id||':'||CAST(? AS INTEGER)||':'||device.id,
   '/portal/#/events/'||event.slug||'/agenda?mine=1',?,?,?,?,?
 FROM agenda_push_event_preferences preference JOIN agenda_push_devices device ON device.id=preference.device_id
 JOIN users user ON user.id=device.user_id JOIN events event ON event.id=preference.event_id
 WHERE preference.event_id=? AND preference.enabled=1 AND device.revoked_at IS NULL AND user.active=1 AND (device.expires_at IS NULL OR device.expires_at>?)
 AND EXISTS(SELECT 1 FROM agenda_session_participations participation JOIN json_each(?) changed ON changed.value=participation.occurrence_id
   WHERE participation.event_id=event.id AND participation.user_id=device.user_id AND participation.status IN('reserved','saved','approval_pending'))
 ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .bind(nextRevision, nextRevision, now, expires, now, now, now, eventId, now, JSON.stringify(changedIds)),
  ];
}
/** Bounded upcoming reminders, independent of the opted-in email channel. */
export async function queueAgendaPushReminders(db: DatabaseLike, limit = 100) {
  const now = nowIso(),
    bounded = Math.min(Math.max(Math.floor(limit), 1), 100);
  const candidates = await all<{
    event_id: string;
    occurrence_id: string;
    user_id: string;
    device_id: string;
    sequence: number;
    reminder_minutes: number;
    start_at: string;
    timezone: string;
    slug: string;
  }>(
    db,
    `SELECT entry.event_id,entry.occurrence_id,entry.user_id,device.id AS device_id,entry.sequence,preference.reminder_minutes,entry.start_at,event.timezone,event.slug
 FROM agenda_calendar_entries entry JOIN agenda_push_event_preferences preference ON preference.event_id=entry.event_id
 JOIN agenda_push_devices device ON device.id=preference.device_id AND device.user_id=entry.user_id
 JOIN users user ON user.id=entry.user_id JOIN events event ON event.id=entry.event_id
 WHERE entry.status='confirmed' AND user.active=1 AND preference.enabled=1 AND device.revoked_at IS NULL AND (device.expires_at IS NULL OR device.expires_at>?)
   AND entry.start_at>? AND julianday(entry.start_at)-preference.reminder_minutes/1440.0<=julianday(?)
   AND NOT EXISTS(SELECT 1 FROM agenda_push_outbox prior WHERE prior.idempotency_key='agenda-reminder:'||entry.occurrence_id||':'||entry.sequence||':'||preference.reminder_minutes||':'||device.id)
 ORDER BY entry.start_at,entry.occurrence_id,device.id LIMIT ?`,
    [now, now, now, bounded],
  );
  const statements = candidates.map((row) => {
    const value = {
      id: crypto.randomUUID(),
      eventId: row.event_id,
      occurrenceId: row.occurrence_id,
      userId: row.user_id,
      deviceId: row.device_id,
      sequence: row.sequence,
      minutes: row.reminder_minutes,
      day: instantToDateTimeLocal(row.start_at, row.timezone).slice(0, 10),
      start: row.start_at,
    };
    return db
      .prepare(
        `INSERT INTO agenda_push_outbox(id,event_id,device_id,user_id,kind,occurrence_id,day_date,reminder_minutes,source_version,idempotency_key,destination,due_at,expires_at,next_attempt_at,created_at,updated_at,status)
    SELECT candidate.id,candidate.event_id,candidate.device_id,candidate.user_id,candidate.kind,candidate.occurrence_id,candidate.day_date,candidate.reminder_minutes,candidate.source_version,
      'agenda-reminder:'||candidate.occurrence_id||':'||candidate.source_version||':'||candidate.reminder_minutes||':'||candidate.device_id,?, ?,candidate.expires_at,?,?,?,CASE WHEN ${webPushDeliverableSql("candidate")} THEN 'queued' ELSE 'waiting' END
    FROM (SELECT ? AS id,? AS event_id,? AS device_id,? AS user_id,'session_reminder' AS kind,? AS occurrence_id,? AS day_date,CAST(? AS INTEGER) AS reminder_minutes,CAST(? AS INTEGER) AS source_version,? AS expires_at) candidate
    WHERE 1 ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .bind(
        `/portal/#/events/${row.slug}/agenda?mine=1`,
        now,
        now,
        now,
        now,
        now,
        now,
        value.id,
        value.eventId,
        value.deviceId,
        value.userId,
        value.occurrenceId,
        value.day,
        value.minutes,
        value.sequence,
        value.start,
      );
  });
  if (statements.length) await db.batch(statements);
  const queued = candidates.length
    ? await first<{ total: number }>(
        db,
        "SELECT COUNT(*) AS total FROM agenda_push_outbox WHERE idempotency_key IN(SELECT value FROM json_each(?)) AND status='queued'",
        [
          JSON.stringify(
            candidates.map(
              (row) => `agenda-reminder:${row.occurrence_id}:${row.sequence}:${row.reminder_minutes}:${row.device_id}`,
            ),
          ),
        ],
      )
    : null;
  return { queued: queued?.total ?? 0 };
}
