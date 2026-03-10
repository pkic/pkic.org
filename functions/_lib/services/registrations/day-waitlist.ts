import { all, first, run } from "../../db/queries";
import { nowIso, addHours } from "../../utils/time";
import { uuid } from "../../utils/ids";
import type { DatabaseLike } from "../../types";
import type { DayAttendanceSelection } from "../event-days";

export type DayWaitlistLane = "continuity" | "general";

interface EventDayRow {
  id: string;
  day_date: string;
  in_person_capacity: number | null;
}

interface DayWaitlistRow {
  id: string;
  event_id: string;
  event_day_id: string;
  registration_id: string;
  user_id: string;
  priority_lane: DayWaitlistLane;
  status: "waiting" | "offered" | "accepted" | "expired" | "removed";
  position: number;
  offer_expires_at: string | null;
}

function normalizeSelections(selections?: DayAttendanceSelection[]): DayAttendanceSelection[] {
  if (!selections || selections.length === 0) {
    return [];
  }
  const byDate = new Map<string, DayAttendanceSelection>();
  for (const selection of selections) {
    byDate.set(selection.dayDate, selection);
  }
  return Array.from(byDate.values());
}

async function listEventDays(db: DatabaseLike, eventId: string): Promise<EventDayRow[]> {
  return all<EventDayRow>(
    db,
    `SELECT id, day_date, in_person_capacity
     FROM event_days
     WHERE event_id = ?
     ORDER BY sort_order ASC, day_date ASC`,
    [eventId],
  );
}

async function findWaitlistEntry(
  db: DatabaseLike,
  eventDayId: string,
  registrationId: string,
): Promise<DayWaitlistRow | null> {
  return first<DayWaitlistRow>(
    db,
    "SELECT * FROM event_day_waitlist_entries WHERE event_day_id = ? AND registration_id = ?",
    [eventDayId, registrationId],
  );
}

async function nextWaitlistPosition(db: DatabaseLike, eventDayId: string): Promise<number> {
  const row = await first<{ max_position: number | null }>(
    db,
    "SELECT MAX(position) AS max_position FROM event_day_waitlist_entries WHERE event_day_id = ?",
    [eventDayId],
  );
  return Number(row?.max_position ?? 0) + 1;
}

async function countConfirmedInPersonForDay(
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

async function computePriorityLane(
  db: DatabaseLike,
  payload: { registrationId: string; eventId: string; excludeEventDayId: string },
): Promise<DayWaitlistLane> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
     FROM registration_day_attendance rda
     JOIN event_days ed ON ed.id = rda.event_day_id
     JOIN registrations r ON r.id = rda.registration_id
     LEFT JOIN event_day_waitlist_entries w
       ON w.event_day_id = rda.event_day_id
      AND w.registration_id = rda.registration_id
      AND w.status IN ('waiting', 'offered')
     WHERE rda.registration_id = ?
       AND ed.event_id = ?
       AND ed.id <> ?
       AND rda.attendance_type = 'in_person'
       AND r.status = 'registered'
       AND w.id IS NULL`,
    [payload.registrationId, payload.eventId, payload.excludeEventDayId],
  );

  return Number(row?.total ?? 0) > 0 ? "continuity" : "general";
}

async function setWaitlistStatus(
  db: DatabaseLike,
  rowId: string,
  status: DayWaitlistRow["status"],
  reasonCode?: string,
  reasonNote?: string,
): Promise<void> {
  await run(
    db,
    `UPDATE event_day_waitlist_entries
     SET status = ?, offer_expires_at = NULL, reason_code = COALESCE(?, reason_code),
         reason_note = COALESCE(?, reason_note), updated_at = ?
     WHERE id = ?`,
    [status, reasonCode ?? null, reasonNote ?? null, nowIso(), rowId],
  );
}

async function clearWaitingOrOffered(
  db: DatabaseLike,
  payload: { eventDayId: string; registrationId: string; reasonCode: string; reasonNote?: string },
): Promise<void> {
  await run(
    db,
    `UPDATE event_day_waitlist_entries
     SET status = 'removed', offer_expires_at = NULL, reason_code = ?, reason_note = ?, updated_at = ?
     WHERE event_day_id = ? AND registration_id = ? AND status IN ('waiting', 'offered')`,
    [payload.reasonCode, payload.reasonNote ?? null, nowIso(), payload.eventDayId, payload.registrationId],
  );
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
     WHERE event_id = ?
       AND user_id = ?
       AND status = 'active'
       AND role IN ('organizer', 'speaker', 'moderator')
     ORDER BY CASE role WHEN 'organizer' THEN 1 WHEN 'speaker' THEN 2 WHEN 'moderator' THEN 3 ELSE 9 END
     LIMIT 1`,
    [eventId, userId],
  );

  if (!row) {
    return null;
  }

  return `role:${row.role}`;
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

  if (existing?.capacity_exempt_in_person === 1) {
    return existing.capacity_exempt_reason ?? "manual";
  }

  return roleBasedCapacityExemptReason(db, payload.eventId, payload.userId);
}

export async function setRegistrationCapacityExempt(
  db: DatabaseLike,
  payload: { registrationId: string; exempt: boolean; reason: string | null },
): Promise<void> {
  await run(
    db,
    `UPDATE registrations
     SET capacity_exempt_in_person = ?, capacity_exempt_reason = ?, updated_at = ?
     WHERE id = ?`,
    [payload.exempt ? 1 : 0, payload.reason, nowIso(), payload.registrationId],
  );
}

export async function expireDayWaitlistOffers(db: DatabaseLike, eventId: string): Promise<void> {
  await run(
    db,
    `UPDATE event_day_waitlist_entries
     SET status = 'expired', updated_at = ?
     WHERE event_id = ?
       AND status = 'offered'
       AND offer_expires_at IS NOT NULL
       AND offer_expires_at <= ?`,
    [nowIso(), eventId, nowIso()],
  );
}

async function userHasActiveOffer(db: DatabaseLike, eventId: string, userId: string): Promise<boolean> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
     FROM event_day_waitlist_entries
     WHERE event_id = ?
       AND user_id = ?
       AND status = 'offered'
       AND (offer_expires_at IS NULL OR offer_expires_at > ?)`,
    [eventId, userId, nowIso()],
  );
  return Number(row?.total ?? 0) > 0;
}

export async function syncRegistrationDayWaitlist(
  db: DatabaseLike,
  payload: {
    registrationId: string;
    eventId: string;
    userId: string;
    selections?: DayAttendanceSelection[];
    capacityExemptReason: string | null;
  },
): Promise<void> {
  const selections = normalizeSelections(payload.selections);
  const selectionsByDate = new Map(selections.map((entry) => [entry.dayDate, entry.attendanceType]));
  const eventDays = await listEventDays(db, payload.eventId);

  if (eventDays.length === 0) {
    return;
  }

  for (const day of eventDays) {
    const selectedType = selectionsByDate.get(day.day_date);

    if (payload.capacityExemptReason) {
      await clearWaitingOrOffered(db, {
        eventDayId: day.id,
        registrationId: payload.registrationId,
        reasonCode: "capacity_exempt",
        reasonNote: payload.capacityExemptReason,
      });
      continue;
    }

    if (selectedType !== "in_person") {
      await clearWaitingOrOffered(db, {
        eventDayId: day.id,
        registrationId: payload.registrationId,
        reasonCode: "selection_changed",
      });
      continue;
    }

    if (!day.in_person_capacity || day.in_person_capacity <= 0) {
      await clearWaitingOrOffered(db, {
        eventDayId: day.id,
        registrationId: payload.registrationId,
        reasonCode: "capacity_unlimited",
      });
      continue;
    }

    const existing = await findWaitlistEntry(db, day.id, payload.registrationId);
    if (existing?.status === "accepted") {
      continue;
    }

    const confirmed = await countConfirmedInPersonForDay(db, day.id, payload.registrationId);
    if (confirmed < day.in_person_capacity) {
      if (existing && (existing.status === "waiting" || existing.status === "offered" || existing.status === "expired" || existing.status === "removed")) {
        await setWaitlistStatus(db, existing.id, "accepted");
      }
      continue;
    }

    if (existing && (existing.status === "offered" || existing.status === "waiting")) {
      if (existing.status === "waiting") {
        const lane = await computePriorityLane(db, {
          registrationId: payload.registrationId,
          eventId: payload.eventId,
          excludeEventDayId: day.id,
        });

        await run(
          db,
          "UPDATE event_day_waitlist_entries SET priority_lane = ?, updated_at = ? WHERE id = ?",
          [lane, nowIso(), existing.id],
        );
      }
      continue;
    }

    const priorityLane = await computePriorityLane(db, {
      registrationId: payload.registrationId,
      eventId: payload.eventId,
      excludeEventDayId: day.id,
    });
    const position = await nextWaitlistPosition(db, day.id);

    await run(
      db,
      `INSERT INTO event_day_waitlist_entries (
        id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position,
        offer_expires_at, reason_code, reason_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, NULL, NULL, NULL, ?, ?)
      ON CONFLICT(event_day_id, registration_id)
      DO UPDATE SET user_id = excluded.user_id, priority_lane = excluded.priority_lane,
                    status = 'waiting', offer_expires_at = NULL, position = excluded.position,
                    updated_at = excluded.updated_at`,
      [
        uuid(),
        payload.eventId,
        day.id,
        payload.registrationId,
        payload.userId,
        priorityLane,
        position,
        nowIso(),
        nowIso(),
      ],
    );
  }
}

export async function removeAllDayWaitlistForRegistration(
  db: DatabaseLike,
  payload: { registrationId: string; reasonCode: string; reasonNote?: string },
): Promise<void> {
  await run(
    db,
    `UPDATE event_day_waitlist_entries
     SET status = 'removed', offer_expires_at = NULL, reason_code = ?, reason_note = ?, updated_at = ?
     WHERE registration_id = ? AND status IN ('waiting', 'offered')`,
    [payload.reasonCode, payload.reasonNote ?? null, nowIso(), payload.registrationId],
  );
}

export async function claimOfferedDayWaitlist(
  db: DatabaseLike,
  payload: { registrationId: string; eventId: string; selections?: DayAttendanceSelection[] },
): Promise<void> {
  const selections = normalizeSelections(payload.selections).filter((entry) => entry.attendanceType === "in_person");
  if (selections.length === 0) {
    return;
  }

  await expireDayWaitlistOffers(db, payload.eventId);

  for (const selection of selections) {
    const day = await first<{ id: string }>(
      db,
      "SELECT id FROM event_days WHERE event_id = ? AND day_date = ?",
      [payload.eventId, selection.dayDate],
    );
    if (!day) {
      continue;
    }

    await run(
      db,
      `UPDATE event_day_waitlist_entries
       SET status = 'accepted', offer_expires_at = NULL, updated_at = ?
       WHERE registration_id = ? AND event_day_id = ? AND status = 'offered'`,
      [nowIso(), payload.registrationId, day.id],
    );
  }
}

export async function promoteDayWaitlistIfCapacity(
  db: DatabaseLike,
  payload: { eventId: string; eventDayId: string; claimWindowHours: number },
): Promise<DayWaitlistRow | null> {
  await expireDayWaitlistOffers(db, payload.eventId);

  const day = await first<{ in_person_capacity: number | null }>(
    db,
    "SELECT in_person_capacity FROM event_days WHERE id = ? AND event_id = ?",
    [payload.eventDayId, payload.eventId],
  );

  if (!day?.in_person_capacity || day.in_person_capacity <= 0) {
    return null;
  }

  const confirmed = await countConfirmedInPersonForDay(db, payload.eventDayId);
  if (confirmed >= day.in_person_capacity) {
    return null;
  }

  const candidates = await all<DayWaitlistRow>(
    db,
    `SELECT w.*
     FROM event_day_waitlist_entries w
     JOIN registrations r ON r.id = w.registration_id
     WHERE w.event_id = ?
       AND w.event_day_id = ?
       AND w.status = 'waiting'
       AND r.status IN ('pending_email_confirmation', 'registered')
     ORDER BY CASE w.priority_lane WHEN 'continuity' THEN 1 ELSE 2 END ASC,
              w.position ASC`,
    [payload.eventId, payload.eventDayId],
  );

  for (const candidate of candidates) {
    if (await userHasActiveOffer(db, payload.eventId, candidate.user_id)) {
      continue;
    }

    const offerExpiresAt = addHours(nowIso(), payload.claimWindowHours);
    await run(
      db,
      `UPDATE event_day_waitlist_entries
       SET status = 'offered', offer_expires_at = ?, updated_at = ?
       WHERE id = ?`,
      [offerExpiresAt, nowIso(), candidate.id],
    );

    return {
      ...candidate,
      status: "offered",
      offer_expires_at: offerExpiresAt,
    };
  }

  return null;
}

export async function promoteDayWaitlistForEventDays(
  db: DatabaseLike,
  payload: { eventId: string; eventDayIds: string[]; claimWindowHours: number },
): Promise<void> {
  const uniqueDayIds = Array.from(new Set(payload.eventDayIds));
  for (const eventDayId of uniqueDayIds) {
    await promoteDayWaitlistIfCapacity(db, {
      eventId: payload.eventId,
      eventDayId,
      claimWindowHours: payload.claimWindowHours,
    });
  }
}

export async function listInPersonEventDayIdsForRegistration(db: DatabaseLike, registrationId: string): Promise<string[]> {
  const rows = await all<{ event_day_id: string }>(
    db,
    `SELECT event_day_id
     FROM registration_day_attendance
     WHERE registration_id = ?
       AND attendance_type = 'in_person'`,
    [registrationId],
  );
  return rows.map((row) => row.event_day_id);
}

export async function listDayWaitlistForRegistration(
  db: DatabaseLike,
  registrationId: string,
): Promise<Array<{ dayDate: string; status: string; priorityLane: DayWaitlistLane; offerExpiresAt: string | null }>> {
  return all<{ dayDate: string; status: string; priorityLane: DayWaitlistLane; offerExpiresAt: string | null }>(
    db,
    `SELECT ed.day_date AS dayDate,
            w.status AS status,
            w.priority_lane AS priorityLane,
            w.offer_expires_at AS offerExpiresAt
     FROM event_day_waitlist_entries w
     JOIN event_days ed ON ed.id = w.event_day_id
     WHERE w.registration_id = ?
       AND w.status IN ('waiting', 'offered', 'accepted')
     ORDER BY ed.sort_order ASC, ed.day_date ASC`,
    [registrationId],
  );
}
