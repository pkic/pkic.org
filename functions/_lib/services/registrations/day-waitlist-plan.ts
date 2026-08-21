import { all, first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import type { DayAttendanceSelection } from "../event-days";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { listCapacityEventDays, prepareCapacityGuardStatements } from "./day-waitlist-capacity";
import type {
  DayWaitlistLane,
  DayWaitlistRow,
  EventDayCapacityRow,
  PlannedDayWaitlistEntry,
} from "./day-waitlist-types";

function normalizeSelections(selections?: DayAttendanceSelection[]): DayAttendanceSelection[] {
  if (!selections?.length) return [];
  const byDate = new Map<string, DayAttendanceSelection>();
  for (const selection of selections) byDate.set(selection.dayDate, selection);
  return Array.from(byDate.values());
}

export async function buildRegistrationDayWaitlistSync(
  db: DatabaseLike,
  payload: {
    registrationId: string;
    eventId: string;
    userId: string;
    selections?: DayAttendanceSelection[];
    capacityExemptReason: string | null;
    preserveConfirmedEventDayIds?: string[];
    registrationStatus?: string;
    configuredEventDays?: EventDayCapacityRow[];
  },
): Promise<{ guardStatements: StatementLike[]; statements: StatementLike[]; activeRows: PlannedDayWaitlistEntry[] }> {
  const selections = normalizeSelections(payload.selections);
  const selectedByDate = new Map(selections.map((entry) => [entry.dayDate, entry.attendanceType]));
  const preserved = new Set(payload.preserveConfirmedEventDayIds ?? []);
  const now = nowIso();
  const [eventDays, existingRows, capacityRows, storedRegistration] = await Promise.all([
    payload.configuredEventDays
      ? Promise.resolve(payload.configuredEventDays)
      : listCapacityEventDays(db, payload.eventId),
    all<DayWaitlistRow>(
      db,
      `SELECT id, event_id, event_day_id, registration_id, user_id, priority_lane,
              status, position, offer_expires_at
       FROM event_day_waitlist_entries WHERE registration_id = ?`,
      [payload.registrationId],
    ),
    all<{ event_day_id: string; reserved: number; max_position: number | null }>(
      db,
      `SELECT ed.id AS event_day_id,
              (
                SELECT COUNT(*)
                FROM registration_day_attendance rda
                JOIN registrations r ON r.id = rda.registration_id
                LEFT JOIN event_day_waitlist_entries w
                  ON w.event_day_id = rda.event_day_id
                 AND w.registration_id = rda.registration_id
                 AND w.status IN ('waiting', 'offered')
                WHERE rda.event_day_id = ed.id
                  AND rda.attendance_type = 'in_person'
                  AND r.status IN ('pending_email_confirmation', 'registered')
                  AND r.capacity_exempt_in_person = 0
                  AND w.id IS NULL
                  AND r.id <> ?
              ) + (
                SELECT COUNT(*)
                FROM event_day_waitlist_entries w
                JOIN registrations r ON r.id = w.registration_id
                WHERE w.event_day_id = ed.id
                  AND w.status = 'offered'
                  AND (w.offer_expires_at IS NULL OR w.offer_expires_at > ?)
                  AND r.status IN ('pending_email_confirmation', 'registered')
                  AND r.capacity_exempt_in_person = 0
                  AND r.id <> ?
              ) AS reserved,
              (SELECT MAX(position) FROM event_day_waitlist_entries w WHERE w.event_day_id = ed.id) AS max_position
       FROM event_days ed WHERE ed.event_id = ?`,
      [payload.registrationId, now, payload.registrationId, payload.eventId],
    ),
    payload.registrationStatus
      ? Promise.resolve({ status: payload.registrationStatus })
      : first<{ status: string }>(db, "SELECT status FROM registrations WHERE id = ?", [payload.registrationId]),
  ]);
  if (!eventDays.length) return { guardStatements: [], statements: [], activeRows: [] };

  const existingByDay = new Map(existingRows.map((row) => [row.event_day_id, row]));
  const capacityByDay = new Map(capacityRows.map((row) => [row.event_day_id, row]));
  const guardStatements = prepareCapacityGuardStatements(db, eventDays, selectedByDate, preserved);
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE event_day_waitlist_entries
         SET status = 'expired', updated_at = ?
         WHERE event_id = ? AND status = 'offered'
           AND offer_expires_at IS NOT NULL AND offer_expires_at <= ?`,
      )
      .bind(now, payload.eventId, now),
  ];
  const activeRows: PlannedDayWaitlistEntry[] = [];

  for (const day of eventDays) {
    const selectedType = selectedByDate.get(day.day_date);
    const existing = existingByDay.get(day.id);
    const clearReason = payload.capacityExemptReason
      ? { code: "capacity_exempt", note: payload.capacityExemptReason }
      : selectedType !== "in_person"
        ? { code: "selection_changed", note: null }
        : !day.in_person_capacity || day.in_person_capacity <= 0
          ? { code: "capacity_unlimited", note: null }
          : null;
    if (clearReason) {
      statements.push(
        db
          .prepare(
            `UPDATE event_day_waitlist_entries
             SET status = 'removed', offer_expires_at = NULL, reason_code = ?, reason_note = ?, updated_at = ?
             WHERE event_day_id = ? AND registration_id = ? AND status IN ('waiting', 'offered')`,
          )
          .bind(clearReason.code, clearReason.note, now, day.id, payload.registrationId),
      );
      continue;
    }
    const existingStatus =
      existing?.status === "offered" && existing.offer_expires_at && existing.offer_expires_at <= now
        ? "expired"
        : existing?.status;
    if (existing && (existingStatus === "accepted" || existingStatus === "offered")) {
      activeRows.push({
        dayDate: day.day_date,
        status: existingStatus,
        priorityLane: existing.priority_lane,
        offerExpiresAt: existing.offer_expires_at,
      });
      continue;
    }

    const continuity =
      storedRegistration?.status === "registered" &&
      eventDays.some((other) => other.id !== day.id && selectedByDate.get(other.day_date) === "in_person");
    const priorityLane: DayWaitlistLane = continuity ? "continuity" : "general";
    if (existing && (existingStatus === "waiting" || existingStatus === "expired")) {
      statements.push(
        db
          .prepare(
            `UPDATE event_day_waitlist_entries
             SET status = 'waiting', priority_lane = ?, offer_expires_at = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .bind(priorityLane, now, existing.id),
      );
      activeRows.push({ dayDate: day.day_date, status: "waiting", priorityLane, offerExpiresAt: null });
      continue;
    }

    const capacity = capacityByDay.get(day.id);
    if (Number(capacity?.reserved ?? 0) < day.in_person_capacity!) {
      if (existing?.status === "removed") {
        statements.push(
          db
            .prepare(
              `UPDATE event_day_waitlist_entries
               SET status = 'accepted', offer_expires_at = NULL, updated_at = ? WHERE id = ?`,
            )
            .bind(now, existing.id),
        );
        activeRows.push({ dayDate: day.day_date, status: "accepted", priorityLane, offerExpiresAt: null });
      }
      continue;
    }
    if (preserved.has(day.id)) continue;

    statements.push(
      db
        .prepare(
          `INSERT INTO event_day_waitlist_entries (
             id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position,
             offer_expires_at, reason_code, reason_note, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, NULL, NULL, NULL, ?, ?)
           ON CONFLICT(event_day_id, registration_id)
           DO UPDATE SET user_id = excluded.user_id, priority_lane = excluded.priority_lane,
                         status = 'waiting', offer_expires_at = NULL, position = excluded.position,
                         updated_at = excluded.updated_at`,
        )
        .bind(
          uuid(),
          payload.eventId,
          day.id,
          payload.registrationId,
          payload.userId,
          priorityLane,
          Number(capacity?.max_position ?? 0) + 1,
          now,
          now,
        ),
    );
    activeRows.push({ dayDate: day.day_date, status: "waiting", priorityLane, offerExpiresAt: null });
  }
  return { guardStatements, statements, activeRows };
}

export async function prepareSyncRegistrationDayWaitlistStatements(
  db: DatabaseLike,
  payload: Parameters<typeof buildRegistrationDayWaitlistSync>[1],
): Promise<StatementLike[]> {
  const built = await buildRegistrationDayWaitlistSync(db, payload);
  return [...built.guardStatements, ...built.statements];
}

export async function syncRegistrationDayWaitlist(
  db: DatabaseLike,
  payload: Parameters<typeof buildRegistrationDayWaitlistSync>[1],
): Promise<void> {
  const statements = await prepareSyncRegistrationDayWaitlistStatements(db, payload);
  if (statements.length) await db.batch(statements);
}

export function prepareRemoveAllDayWaitlistStatement(
  db: DatabaseLike,
  payload: { registrationId: string; reasonCode: string; reasonNote?: string },
): StatementLike {
  return db
    .prepare(
      `UPDATE event_day_waitlist_entries
       SET status = 'removed', offer_expires_at = NULL, reason_code = ?, reason_note = ?, updated_at = ?
       WHERE registration_id = ? AND status IN ('waiting', 'offered')`,
    )
    .bind(payload.reasonCode, payload.reasonNote ?? null, nowIso(), payload.registrationId);
}

export async function prepareClaimOfferedDayWaitlistStatements(
  db: DatabaseLike,
  payload: {
    registrationId: string;
    eventId: string;
    selections?: DayAttendanceSelection[];
    configuredEventDays?: EventDayCapacityRow[];
  },
): Promise<StatementLike[]> {
  const selections = normalizeSelections(payload.selections).filter((entry) => entry.attendanceType === "in_person");
  if (!selections.length) return [];
  const days = payload.configuredEventDays ?? (await listCapacityEventDays(db, payload.eventId));
  const dayIdsByDate = new Map(days.map((day) => [day.day_date, day.id]));
  const now = nowIso();
  return selections.flatMap((selection) => {
    const eventDayId = dayIdsByDate.get(selection.dayDate);
    if (!eventDayId) return [];
    return [
      db
        .prepare(
          `UPDATE event_day_waitlist_entries
           SET status = 'accepted', offer_expires_at = NULL, updated_at = ?
           WHERE registration_id = ? AND event_day_id = ? AND status = 'offered'
             AND (offer_expires_at IS NULL OR offer_expires_at > ?)`,
        )
        .bind(now, payload.registrationId, eventDayId, now),
    ];
  });
}
