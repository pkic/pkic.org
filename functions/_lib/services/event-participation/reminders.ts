import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { all } from "../../db/queries";
import { prepareQueueEmailStatementWhen } from "../../email/outbox-queue";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { publishedSessionsSql } from "./published-schedule";
/** Opt-in email uses the durable outbox, never a browser timer or service-worker timer. */
export async function runAgendaSessionReminders(db: DatabaseLike, limit = 100) {
  const bounded = Math.min(Math.max(limit, 1), 500);
  const now = nowIso();
  const candidates = await all<{
    event_id: string;
    occurrence_id: string;
    user_id: string;
    sequence: number;
    reminder_minutes: number;
    start_at: string;
    timezone: string;
    email: string;
  }>(
    db,
    `SELECT entry.event_id,entry.occurrence_id,entry.user_id,entry.sequence,preference.reminder_minutes,entry.start_at,s.timezone,person.email
   FROM agenda_calendar_entries entry JOIN agenda_calendar_preferences preference ON preference.event_id=entry.event_id AND preference.user_id=entry.user_id
   JOIN users person ON person.id=entry.user_id JOIN (${publishedSessionsSql}) s ON s.id=entry.occurrence_id AND s.event_id=entry.event_id
   WHERE entry.status='confirmed' AND preference.reminder_enabled=1 AND person.active=1 AND entry.start_at>? AND entry.start_at<=?
   AND NOT EXISTS(SELECT 1 FROM agenda_session_reminders existing WHERE existing.occurrence_id=entry.occurrence_id AND existing.user_id=entry.user_id AND existing.sequence=entry.sequence AND existing.reminder_minutes=preference.reminder_minutes)
   ORDER BY entry.start_at,entry.occurrence_id,entry.user_id LIMIT ?`,
    [now, new Date(Date.now() + 86400000).toISOString(), bounded],
  );
  for (const candidate of candidates) {
    const due = new Date(new Date(candidate.start_at).getTime() - candidate.reminder_minutes * 60000).toISOString();
    await db
      .prepare(
        `INSERT INTO agenda_session_reminders(id,event_id,occurrence_id,user_id,sequence,reminder_minutes,day_date,start_at,due_at,recipient_email,status,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?) ON CONFLICT(occurrence_id,user_id,sequence,reminder_minutes) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        candidate.event_id,
        candidate.occurrence_id,
        candidate.user_id,
        candidate.sequence,
        candidate.reminder_minutes,
        instantToDateTimeLocal(candidate.start_at, candidate.timezone).slice(0, 10),
        candidate.start_at,
        due,
        candidate.email,
        now,
      )
      .run();
  }
  const due = await all<{
    id: string;
    event_id: string;
    user_id: string;
    sequence: number;
    recipient_email: string;
    title: string;
    start_at: string;
    location: string | null;
    event_name: string;
  }>(
    db,
    `SELECT reminder.id,reminder.event_id,reminder.user_id,reminder.sequence,reminder.recipient_email,entry.title,entry.start_at,entry.location,event.name AS event_name
   FROM agenda_session_reminders reminder JOIN agenda_calendar_entries entry ON entry.occurrence_id=reminder.occurrence_id AND entry.user_id=reminder.user_id AND entry.event_id=reminder.event_id
   JOIN events event ON event.id=reminder.event_id WHERE reminder.status='pending' AND reminder.due_at<=? ORDER BY reminder.due_at,reminder.id LIMIT ?`,
    [now, bounded],
  );
  let queued = 0;
  for (const reminder of due) {
    const email = prepareQueueEmailStatementWhen(
      db,
      {
        outboxId: crypto.randomUUID(),
        idempotencyKey: `agenda-reminder:${reminder.id}`,
        eventId: reminder.event_id,
        recipientUserId: reminder.user_id,
        recipientEmail: reminder.recipient_email,
        templateKey: "agenda_session_reminder",
        messageType: "transactional",
        data: {
          eventName: reminder.event_name,
          sessionTitle: reminder.title,
          sessionStart: reminder.start_at,
          sessionLocation: reminder.location ?? "Remote",
          __deliveryGuard: { id: reminder.id, version: reminder.sequence },
        },
      },
      {
        sql: "SELECT 1 FROM email_delivery_guard_states WHERE id=? AND version=? AND deliverable=1",
        bindings: [reminder.id, reminder.sequence],
      },
      now,
    );
    const results = await db.batch([
      db
        .prepare("UPDATE agenda_session_reminders SET status='queued' WHERE id=? AND status='pending'")
        .bind(reminder.id),
      email.statement,
      db
        .prepare(
          "UPDATE agenda_session_reminders SET status='canceled' WHERE id=? AND NOT EXISTS(SELECT 1 FROM email_delivery_guard_states WHERE id=? AND version=? AND deliverable=1)",
        )
        .bind(reminder.id, reminder.id, reminder.sequence),
    ]);
    queued += results[1]?.meta?.changes ?? 0;
  }
  return { scheduled: candidates.length, inspected: due.length, queued };
}
