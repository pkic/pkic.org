import { createRegistration } from "../../functions/_lib/services/registrations";

/** Test fixture for registration scenarios that do not otherwise care about the event schedule. */
export async function createScheduledRegistration(
  db: Parameters<typeof createRegistration>[0],
  payload: Parameters<typeof createRegistration>[1],
) {
  if (payload.dayAttendance) return createRegistration(db, payload);
  const day = await db
    .prepare("SELECT day_date FROM event_days WHERE event_id=? ORDER BY day_date LIMIT 1")
    .bind(payload.event.id)
    .first<{ day_date: string }>();
  const dayDate = day?.day_date ?? "2026-12-01";
  if (!day) {
    const now = new Date().toISOString();
    await db
      .prepare("INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(), payload.event.id, dayDate, now, now)
      .run();
  }
  return createRegistration(db, { ...payload, dayAttendance: [{ dayDate, attendanceType: "in_person" }] });
}
