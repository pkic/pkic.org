import type { DatabaseLike } from "../../functions/_lib/types";

/** Synthetic session fixtures need explicit day selections for registration access. */
export async function seedSessionAttendanceDays(
  db: DatabaseLike,
  eventId: string,
  dates: readonly string[],
  attendanceType = "in_person",
) {
  for (const date of new Set(dates)) {
    const dayId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          "INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(event_id,day_date) DO NOTHING",
        )
        .bind(dayId, eventId, date, now, now),
      db
        .prepare(`INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at)
        SELECT lower(hex(randomblob(16))),r.id,d.id,?,?,? FROM registrations r JOIN event_days d ON d.event_id=r.event_id
        WHERE r.event_id=? AND d.day_date=? ON CONFLICT(registration_id,event_day_id) DO NOTHING`)
        .bind(attendanceType, now, now, eventId, date),
    ]);
  }
}

/** Clear the default fixture when a scenario supplies its own day options. */
export async function clearSessionAttendanceDays(db: DatabaseLike, eventId: string) {
  await db.batch([
    db
      .prepare(
        "DELETE FROM registration_day_attendance WHERE event_day_id IN (SELECT id FROM event_days WHERE event_id=?)",
      )
      .bind(eventId),
    db.prepare("DELETE FROM event_days WHERE event_id=?").bind(eventId),
  ]);
}
