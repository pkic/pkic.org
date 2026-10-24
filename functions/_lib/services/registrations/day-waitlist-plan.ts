import { nowIso } from "../../utils/time";
import type { DatabaseLike, StatementLike } from "../../types";
import type { DayAttendanceSelection } from "../event-days";
import { uuid } from "../../utils/ids";
import { prepareAuditLog } from "../audit";
import {
  dayWaitlistOfferUnavailableError,
  prepareCapacityEventDays,
  prepareCapacityGuardStatements,
  type EventDayCapacityGuardPlan,
} from "./day-waitlist-capacity";
import type { DayWaitlistLane, EventDayCapacityRow, PlannedDayWaitlistEntry } from "./day-waitlist-types";
import { prepareRegistrationDayWaitlistRead, type RegistrationDayWaitlistSnapshot } from "./day-waitlist-read";
import { batchRows } from "../../db/pagination";

function normalizeSelections(selections?: DayAttendanceSelection[]): DayAttendanceSelection[] {
  if (!selections?.length) return [];
  const byDate = new Map<string, DayAttendanceSelection>();
  for (const selection of selections) byDate.set(selection.dayDate, selection);
  return Array.from(byDate.values());
}

export interface DayCapacityDecision {
  dayDate: string;
  attendanceType: string;
  outcome: "admitted" | "waitlisted" | "offered";
  reason: string;
  seatsReservedBeforeDecision: number;
  attendeesWaitingBeforeDecision: number;
  limit: number | null;
  roleReason: string | null;
}

export interface RegistrationDayWaitlistSyncInput {
  registrationId: string;
  eventId: string;
  userId: string;
  selections?: DayAttendanceSelection[];
  capacityExemptReason: string | null;
  preserveConfirmedEventDayIds?: string[];
  registrationStatus?: string;
  configuredEventDays?: EventDayCapacityRow[];
  sharedCapacityGuards?: EventDayCapacityGuardPlan;
  reArbitrateExistingCapacityRows?: boolean;
  forceWaitlistDayDates?: string[];
  claimOfferedDayDates?: string[];
  auditActor?: { type: "user" | "admin" | "system"; id: string | null };
}
export interface RegistrationDayWaitlistPlan {
  guardStatements: StatementLike[];
  statements: StatementLike[];
  activeRows: PlannedDayWaitlistEntry[];
  changed: boolean;
  decisions: DayCapacityDecision[];
}

export async function buildRegistrationDayWaitlistSync(
  db: DatabaseLike,
  payload: RegistrationDayWaitlistSyncInput,
): Promise<RegistrationDayWaitlistPlan> {
  const read = prepareRegistrationDayWaitlistRead(db, {
    ...payload,
    registration: { registrationId: payload.registrationId },
  });
  const results = await db.batch([
    ...read.statements,
    ...(payload.configuredEventDays ? [] : [prepareCapacityEventDays(db, payload.eventId)]),
  ]);
  return planRegistrationDayWaitlistSync(db, payload, {
    ...read.decode(results.slice(0, read.statements.length)),
    eventDays: payload.configuredEventDays ?? batchRows<EventDayCapacityRow>(results[read.statements.length]),
  });
}

/** One planner for standalone changes and create/restore's combined preflight. */
export function planRegistrationDayWaitlistSync(
  db: DatabaseLike,
  payload: RegistrationDayWaitlistSyncInput,
  snapshot: RegistrationDayWaitlistSnapshot & { eventDays: EventDayCapacityRow[] },
): RegistrationDayWaitlistPlan {
  const selections = normalizeSelections(payload.selections);
  const selectedByDate = new Map(selections.map((entry) => [entry.dayDate, entry.attendanceType]));
  const preserved = new Set(payload.preserveConfirmedEventDayIds ?? []);
  const forcedWaitlistDates = new Set(payload.forceWaitlistDayDates ?? []);
  const claimOfferedDayDates = new Set(payload.claimOfferedDayDates ?? []);
  const { at: now, eventDays, existingRows, capacityRows, storedRegistration } = snapshot;
  if (!eventDays.length) {
    if (claimOfferedDayDates.size > 0) throw dayWaitlistOfferUnavailableError();
    return { guardStatements: [], statements: [], activeRows: [], changed: false, decisions: [] };
  }

  const dayByDate = new Map(eventDays.map((day) => [day.day_date, day]));
  for (const dayDate of claimOfferedDayDates) {
    const day = dayByDate.get(dayDate);
    if (selectedByDate.get(dayDate) !== "in_person" || !day?.in_person_capacity || day.in_person_capacity <= 0) {
      throw dayWaitlistOfferUnavailableError();
    }
  }

  const existingByDay = new Map(existingRows.map((row) => [row.event_day_id, row]));
  const capacityByDay = new Map(capacityRows.map((row) => [row.event_day_id, row]));
  const guardStatements = prepareCapacityGuardStatements(
    db,
    eventDays,
    selectedByDate,
    preserved,
    claimOfferedDayDates.size > 0
      ? { registrationId: payload.registrationId, dayDates: claimOfferedDayDates }
      : undefined,
    payload.sharedCapacityGuards,
  );
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
  const decisions: DayCapacityDecision[] = [];
  let changed = false;

  for (const day of eventDays) {
    const selectedType = selectedByDate.get(day.day_date);
    const existing = existingByDay.get(day.id);
    const capacity = capacityByDay.get(day.id);
    const recordDecision = (outcome: DayCapacityDecision["outcome"], reason: string): void => {
      if (selectedType !== "in_person") return;
      decisions.push({
        dayDate: day.day_date,
        attendanceType: selectedType,
        outcome,
        reason,
        seatsReservedBeforeDecision: Number(capacity?.reserved ?? 0),
        attendeesWaitingBeforeDecision: Number(capacity?.waiting ?? 0),
        limit: day.in_person_capacity,
        roleReason: payload.capacityExemptReason,
      });
    };
    const clearReason =
      payload.capacityExemptReason &&
      existing?.reason_code !== "admin_returned_to_waitlist" &&
      !forcedWaitlistDates.has(day.day_date)
        ? { code: "capacity_exempt", note: payload.capacityExemptReason }
        : selectedType !== "in_person"
          ? { code: "selection_changed", note: null }
          : !day.in_person_capacity || day.in_person_capacity <= 0
            ? { code: "capacity_unlimited", note: null }
            : null;
    if (clearReason) {
      recordDecision("admitted", clearReason.code);
      if (existing && ["waiting", "offered", "accepted"].includes(existing.status)) changed = true;
      statements.push(
        db
          .prepare(
            `UPDATE event_day_waitlist_entries
             SET status = 'removed', offer_expires_at = NULL, reason_code = ?, reason_note = ?, updated_at = ?
             WHERE event_day_id = ? AND registration_id = ? AND status IN ('waiting', 'offered', 'accepted')`,
          )
          .bind(clearReason.code, clearReason.note, now, day.id, payload.registrationId),
      );
      continue;
    }
    if (forcedWaitlistDates.has(day.day_date)) {
      recordDecision("waitlisted", "admin_returned_to_waitlist");
      const priorityLane: DayWaitlistLane = "general";
      changed = true;
      statements.push(
        db
          .prepare(
            `INSERT INTO event_day_waitlist_entries (
               id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position,
               offer_expires_at, reason_code, reason_note, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, NULL, 'admin_returned_to_waitlist', NULL, ?, ?)
             ON CONFLICT(event_day_id, registration_id)
             DO UPDATE SET user_id = excluded.user_id, priority_lane = excluded.priority_lane,
                           status = 'waiting', offer_expires_at = NULL, position = excluded.position,
                           reason_code = excluded.reason_code, reason_note = NULL, updated_at = excluded.updated_at`,
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
      continue;
    }
    const existingStatus =
      existing?.status === "offered" && existing.offer_expires_at && existing.offer_expires_at <= now
        ? "expired"
        : existing?.status;
    if (
      existing &&
      (existingStatus === "accepted" || existingStatus === "offered") &&
      (!payload.reArbitrateExistingCapacityRows ||
        (existingStatus === "accepted" && existing.reason_code === "admin_returned_to_waitlist"))
    ) {
      const claimingOffer = existingStatus === "offered" && claimOfferedDayDates.has(day.day_date);
      recordDecision(
        existingStatus === "offered" && !claimingOffer ? "offered" : "admitted",
        claimingOffer ? "offer_claimed" : existingStatus === "offered" ? "existing_offer" : "existing_admission",
      );
      if (claimingOffer) changed = true;
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
      recordDecision("waitlisted", "existing_queue_position");
      if (
        existingStatus !== "waiting" ||
        existing.priority_lane !== priorityLane ||
        existing.offer_expires_at !== null
      ) {
        changed = true;
      }
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

    // Hold one seat for each earlier waiting attendee. Any capacity beyond
    // confirmed seats, active offers, and those holds can be admitted now.
    const waiting = Number(capacity?.waiting ?? 0);
    if (Number(capacity?.reserved ?? 0) + waiting < day.in_person_capacity!) {
      recordDecision("admitted", waiting > 0 ? "capacity_available_after_queue" : "capacity_available");
      if (existing?.status === "removed") {
        changed = true;
        statements.push(
          db
            .prepare(
              `UPDATE event_day_waitlist_entries
               SET status = 'accepted', offer_expires_at = NULL,
                   reason_code = NULL, reason_note = NULL, updated_at = ? WHERE id = ?`,
            )
            .bind(now, existing.id),
        );
        activeRows.push({ dayDate: day.day_date, status: "accepted", priorityLane, offerExpiresAt: null });
      }
      continue;
    }
    if (preserved.has(day.id)) {
      recordDecision("admitted", "existing_admission_preserved");
      continue;
    }

    recordDecision("waitlisted", waiting > 0 ? "queue_ahead" : "capacity_full");
    changed = true;
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
                         reason_code = NULL, reason_note = NULL, updated_at = excluded.updated_at`,
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
  if (decisions.length && payload.auditActor) {
    statements.push(
      prepareAuditLog(
        db,
        payload.auditActor.type,
        payload.auditActor.id,
        "registration_capacity_decision",
        "registration",
        payload.registrationId,
        { eventId: payload.eventId, decisions },
        now,
      ),
    );
  }
  return { guardStatements, statements, activeRows, changed, decisions };
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
       WHERE registration_id = ? AND status IN ('waiting', 'offered', 'accepted')`,
    )
    .bind(payload.reasonCode, payload.reasonNote ?? null, nowIso(), payload.registrationId);
}
