import { first, all } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import type { EventDayCapacityRow } from "./day-waitlist-types";

export async function listCapacityEventDays(db: DatabaseLike, eventId: string): Promise<EventDayCapacityRow[]> {
  return all<EventDayCapacityRow>(
    db,
    `SELECT id, day_date, in_person_capacity, capacity_revision
     FROM event_days
     WHERE event_id = ?
     ORDER BY sort_order ASC, day_date ASC`,
    [eventId],
  );
}

export async function countConfirmedInPersonForDay(
  db: DatabaseLike,
  eventDayId: string,
  excludeRegistrationId?: string,
): Promise<number> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
     FROM registration_day_attendance rda
     JOIN registrations r ON r.id = rda.registration_id
     LEFT JOIN event_day_waitlist_entries w
       ON w.event_day_id = rda.event_day_id
      AND w.registration_id = rda.registration_id
      AND w.status IN ('waiting', 'offered')
     WHERE rda.event_day_id = ?
       AND rda.attendance_type = 'in_person'
       AND r.status IN ('pending_email_confirmation', 'registered')
       AND r.capacity_exempt_in_person = 0
       AND w.id IS NULL
       AND (? IS NULL OR r.id <> ?)`,
    [eventDayId, excludeRegistrationId ?? null, excludeRegistrationId ?? null],
  );
  return Number(row?.total ?? 0);
}

export async function countActiveOffersForDay(
  db: DatabaseLike,
  eventDayId: string,
  excludeRegistrationId?: string,
): Promise<number> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
     FROM event_day_waitlist_entries w
     JOIN registrations r ON r.id = w.registration_id
     WHERE w.event_day_id = ?
       AND w.status = 'offered'
       AND (w.offer_expires_at IS NULL OR w.offer_expires_at > ?)
       AND r.status IN ('pending_email_confirmation', 'registered')
       AND r.capacity_exempt_in_person = 0
       AND (? IS NULL OR r.id <> ?)`,
    [eventDayId, nowIso(), excludeRegistrationId ?? null, excludeRegistrationId ?? null],
  );
  return Number(row?.total ?? 0);
}

export async function roleBasedCapacityExemptReason(
  db: DatabaseLike,
  eventId: string,
  userId: string,
): Promise<string | null> {
  const row = await first<{ role: string }>(
    db,
    `SELECT role
     FROM event_participants
     WHERE event_id = ? AND user_id = ? AND status = 'active'
       AND role IN ('organizer', 'speaker', 'moderator')
     ORDER BY CASE role WHEN 'organizer' THEN 1 WHEN 'speaker' THEN 2 WHEN 'moderator' THEN 3 ELSE 9 END
     LIMIT 1`,
    [eventId, userId],
  );
  return row ? `role:${row.role}` : null;
}

export async function resolveCapacityExemptReason(
  db: DatabaseLike,
  payload: { registrationId: string; eventId: string; userId: string },
): Promise<string | null> {
  const existing = await first<{ capacity_exempt_in_person: number; capacity_exempt_reason: string | null }>(
    db,
    "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?",
    [payload.registrationId],
  );
  if (existing?.capacity_exempt_in_person === 1) return existing.capacity_exempt_reason ?? "manual";
  return roleBasedCapacityExemptReason(db, payload.eventId, payload.userId);
}

export function isEventDayCapacityConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("EVENT_DAY_CAPACITY_CHANGED");
}

export function prepareCapacityGuardStatements(
  db: DatabaseLike,
  eventDays: EventDayCapacityRow[],
  selectedByDate: Map<string, string>,
  preservedEventDayIds: Set<string>,
): StatementLike[] {
  return eventDays.flatMap((day) => {
    const affectsCapacity = selectedByDate.get(day.day_date) === "in_person" || preservedEventDayIds.has(day.id);
    if (!affectsCapacity || !day.in_person_capacity || day.in_person_capacity <= 0) return [];
    return [
      db
        .prepare(
          `INSERT INTO event_day_capacity_guards (id, event_day_id, expected_revision)
           VALUES (?, ?, ?)`,
        )
        .bind(uuid(), day.id, day.capacity_revision),
    ];
  });
}
