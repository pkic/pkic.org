import { isEventDayCapacityConflict, eventDayCapacityChangedError } from "../../db/event-day-capacity-guard";
export { isEventDayCapacityConflict, eventDayCapacityChangedError } from "../../db/event-day-capacity-guard";
import { configuredAttendanceOptions } from "../event-days";
import { eventDayOptionAccessSql, registrationDayHoldsOptionSql } from "../event-attendance-option-sql";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import type { EventDayCapacityRow } from "./day-waitlist-types";
import type { EventParticipantRole } from "../../../../assets/shared/schemas/participant-roles";

const ROLE_BASED_CAPACITY_EXEMPT_ROLES = [
  "organizer",
  "speaker",
  "moderator",
  "panelist",
  "staff",
] as const satisfies readonly EventParticipantRole[];
const ROLE_BASED_CAPACITY_EXEMPT_ROLE_SQL = ROLE_BASED_CAPACITY_EXEMPT_ROLES.map((role) => `'${role}'`).join(", ");

/** SQL expressions accept only internal aliases and trusted value expressions. */
export function eventAttendanceOptionCapacitySql(day: string, attendanceType: string): string {
  const fallback = `CASE WHEN ${attendanceType} = 'in_person' THEN ${day}.in_person_capacity ELSE NULL END`;
  return `(CASE WHEN json_valid(${day}.attendance_options_json) THEN
    CASE WHEN json_type(${day}.attendance_options_json) = 'array' AND json_array_length(${day}.attendance_options_json) > 0
      THEN (SELECT CAST(CASE WHEN json_valid(option.value) THEN json_extract(option.value, '$.capacity') END AS INTEGER)
            FROM json_each(${day}.attendance_options_json) option
            WHERE CASE WHEN json_valid(option.value) THEN json_extract(option.value, '$.value') END = ${attendanceType} LIMIT 1)
      ELSE ${fallback} END
    ELSE ${fallback} END)`;
}

export function eventAttendanceOptionOccupiedSql(day: string, attendanceType: string, now: string): string {
  return `(SELECT COUNT(*) FROM registration_day_attendance capacity_attendance
    JOIN registrations registration ON registration.id = capacity_attendance.registration_id
    WHERE capacity_attendance.event_day_id = ${day}.id AND capacity_attendance.attendance_type = ${attendanceType}
      AND registration.status IN ('pending_email_confirmation', 'registered')
      AND ${registrationDayHoldsOptionSql("capacity_attendance", now)})`;
}

function eventAttendanceOptionConfiguredSql(day: string, attendanceType: string): string {
  return `(CASE WHEN json_valid(${day}.attendance_options_json) THEN
    CASE WHEN json_type(${day}.attendance_options_json) = 'array' AND json_array_length(${day}.attendance_options_json) > 0
      THEN EXISTS (SELECT 1 FROM json_each(${day}.attendance_options_json) option
        WHERE CASE WHEN json_valid(option.value) THEN json_extract(option.value, '$.value') END = ${attendanceType})
      ELSE ${attendanceType} IN ('in_person', 'virtual', 'on_demand') END
    ELSE ${attendanceType} IN ('in_person', 'virtual', 'on_demand') END)`;
}

export function eventAttendanceOptionHasAvailableCapacitySql(day: string, attendanceType: string, now: string): string {
  const capacity = eventAttendanceOptionCapacitySql(day, attendanceType);
  const configured = eventAttendanceOptionConfiguredSql(day, attendanceType);
  return `(${configured} AND (${capacity} IS NULL OR ${capacity} <= 0 OR (${eventAttendanceOptionOccupiedSql(day, attendanceType, now)}) < ${capacity}))`;
}

/**
 * CTEs providing `open_waitlist_option`, one row per day and attendance option
 * with someone waiting and a free seat, and `capacity_exempt_user`. Seats are
 * counted once per option, before any per-person check, so a full option costs
 * one count however long its queue is. Exempt users are read once, and only
 * when a seat is open. `dayScope` filters `scoped_day`; it and `now` are trusted SQL.
 */
export function openWaitlistOptionCte(dayScope: string, now: string): string {
  const option = "waiting_option.attendance_type";
  return `waiting_option AS MATERIALIZED (
      SELECT DISTINCT scoped_day.id AS event_day_id, held.attendance_type
      FROM event_days scoped_day
      JOIN event_day_waitlist_entries waiting
        ON waiting.event_day_id = scoped_day.id AND waiting.status = 'waiting'
      JOIN registration_day_attendance held
        ON held.registration_id = waiting.registration_id AND held.event_day_id = waiting.event_day_id
      WHERE ${dayScope}
    ), option_seats AS MATERIALIZED (
      SELECT ed.id AS event_day_id, ed.event_id, ${option} AS attendance_type,
             ${eventAttendanceOptionCapacitySql("ed", option)} AS capacity_limit,
             ${eventAttendanceOptionOccupiedSql("ed", option, now)} AS occupied
      FROM waiting_option
      JOIN event_days ed ON ed.id = waiting_option.event_day_id
      WHERE ${eventAttendanceOptionConfiguredSql("ed", option)}
    ), open_waitlist_option AS (
      SELECT event_day_id, event_id, attendance_type, capacity_limit, occupied
      FROM option_seats
      WHERE capacity_limit IS NULL OR capacity_limit <= 0 OR occupied < capacity_limit
    ), capacity_exempt_user AS MATERIALIZED (
      SELECT DISTINCT role.event_id, role.user_id
      FROM effective_event_participant_roles role
      WHERE role.status = 'active' AND role.role IN (${ROLE_BASED_CAPACITY_EXEMPT_ROLE_SQL})
        AND role.event_id IN (SELECT event_id FROM open_waitlist_option)
    )`;
}

/**
 * Whether a waiting entry can be offered a seat, in a statement that includes
 * `openWaitlistOptionCte`. Arguments are trusted SQL aliases and expressions.
 */
export function waitlistEntryCanBeOfferedSql(
  entry: string,
  registration: string,
  day: string,
  attendanceType: string,
): string {
  return `${registration}.status IN ('pending_email_confirmation', 'registered')
    AND (${entry}.reason_code = 'admin_returned_to_waitlist'
      OR ${eventDayOptionAccessSql(day, attendanceType)} <> 'physical'
      OR NOT EXISTS (
        SELECT 1 FROM capacity_exempt_user exempt
        WHERE exempt.event_id = ${entry}.event_id AND exempt.user_id = ${entry}.user_id
      ))`;
}

function rolePriority(role: string): number {
  const index = ROLE_BASED_CAPACITY_EXEMPT_ROLES.indexOf(role as (typeof ROLE_BASED_CAPACITY_EXEMPT_ROLES)[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function roleBasedCapacityExemptReasonForRole(role: string | undefined): string | null {
  return role && ROLE_BASED_CAPACITY_EXEMPT_ROLES.includes(role as (typeof ROLE_BASED_CAPACITY_EXEMPT_ROLES)[number])
    ? `role:${role}`
    : null;
}

export async function listCapacityEventDays(db: DatabaseLike, eventId: string): Promise<EventDayCapacityRow[]> {
  return (await prepareCapacityEventDays(db, eventId).all<EventDayCapacityRow>()).results;
}

export function prepareCapacityEventDays(db: DatabaseLike, eventId: string) {
  return db
    .prepare(`SELECT id, day_date, in_person_capacity, attendance_options_json, capacity_revision
     FROM event_days WHERE event_id = ? ORDER BY sort_order ASC, day_date ASC`)
    .bind(eventId);
}

/** The same canonical role policy serves ordinary admission and an overlaid proposal acceptance. */
export function prepareRoleBasedCapacityExemption(
  db: DatabaseLike,
  input: { eventId: string; userId: string; activeProposalRoles?: readonly EventParticipantRole[] },
) {
  const priority = ROLE_BASED_CAPACITY_EXEMPT_ROLES.map((role, index) => `WHEN '${role}' THEN ${index}`).join(" ");
  const source = input.activeProposalRoles
    ? `SELECT role FROM event_participant_role_sources
       WHERE event_id=? AND user_id=? AND status='active'
         AND role IN (${ROLE_BASED_CAPACITY_EXEMPT_ROLE_SQL}) AND source_kind='event_participant'`
    : `SELECT role FROM effective_event_participant_roles
       WHERE event_id=? AND user_id=? AND status='active'
         AND role IN (${ROLE_BASED_CAPACITY_EXEMPT_ROLE_SQL})`;
  const statement = db
    .prepare(`${source} ORDER BY CASE role ${priority} ELSE 9 END LIMIT 1`)
    .bind(input.eventId, input.userId);
  return {
    statement,
    decode(rows: { role: string }[]) {
      const roles = rows.map((row) => row.role);
      roles.push(...(input.activeProposalRoles ?? []).filter((role) => roleBasedCapacityExemptReasonForRole(role)));
      roles.sort((left, right) => rolePriority(left) - rolePriority(right));
      return roleBasedCapacityExemptReasonForRole(roles[0]);
    },
  };
}

export async function roleBasedCapacityExemptReason(
  db: DatabaseLike,
  eventId: string,
  userId: string,
): Promise<string | null> {
  const read = prepareRoleBasedCapacityExemption(db, { eventId, userId });
  return read.decode((await read.statement.all<{ role: string }>()).results);
}

/** Direct roles plus the intended next proposal roles, before their shared atomic commit. */
export async function roleBasedCapacityExemptReasonAfterParticipantChange(
  db: DatabaseLike,
  input: { eventId: string; userId: string; activeProposalRoles: readonly EventParticipantRole[] },
): Promise<string | null> {
  const read = prepareRoleBasedCapacityExemption(db, input);
  return read.decode((await read.statement.all<{ role: string }>()).results);
}

export async function resolveCapacityExemptReason(
  db: DatabaseLike,
  payload: { eventId: string; userId: string },
): Promise<string | null> {
  return roleBasedCapacityExemptReason(db, payload.eventId, payload.userId);
}

/** Capacity belongs to the selected configured option, not its identifier or access mode. */
export function attendanceOptionCapacity(day: EventDayCapacityRow, value: string | undefined): number | null {
  if (!value) return null;
  const options = configuredAttendanceOptions({
    attendance_options_json: day.attendance_options_json ?? null,
    in_person_capacity: day.in_person_capacity,
  });
  return options.find((option) => option.value === value)?.capacity ?? null;
}

/** One guard per day, executed before every participant's reconciliation in the same atomic command. */
export type EventDayCapacityGuardPlan = Map<string, { expectedRevision: number; statement: StatementLike }>;

export const DAY_WAITLIST_OFFER_UNAVAILABLE_CODE = "DAY_WAITLIST_OFFER_UNAVAILABLE";

export function dayWaitlistOfferUnavailableError(): AppError {
  return new AppError(
    409,
    DAY_WAITLIST_OFFER_UNAVAILABLE_CODE,
    "One or more waitlist offers is no longer available. Refresh the registration before trying again.",
  );
}

export function isDayWaitlistOfferUnavailable(error: unknown): boolean {
  return (
    (error instanceof AppError && error.code === DAY_WAITLIST_OFFER_UNAVAILABLE_CODE) ||
    (error instanceof Error && error.message.includes(DAY_WAITLIST_OFFER_UNAVAILABLE_CODE))
  );
}

export async function withDayCapacityRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isEventDayCapacityConflict(error)) throw error;
      if (attempt === 2) break;
    }
  }
  throw eventDayCapacityChangedError();
}

export function prepareCapacityGuardStatements(
  db: DatabaseLike,
  eventDays: EventDayCapacityRow[],
  selectedByDate: Map<string, string>,
  preservedEventDayIds: Set<string>,
  claim?: { registrationId: string; dayDates: ReadonlySet<string> },
  sharedGuards?: EventDayCapacityGuardPlan,
): StatementLike[] {
  if (claim && sharedGuards) throw new Error("Waitlist offer claims require their own capacity guards");
  return eventDays.flatMap((day) => {
    const claimsOffer = claim?.dayDates.has(day.day_date) ?? false;
    const affectsCapacity =
      attendanceOptionCapacity(day, selectedByDate.get(day.day_date)) !== null ||
      preservedEventDayIds.has(day.id) ||
      claimsOffer;
    if (!affectsCapacity) return [];
    const previousGuard = sharedGuards?.get(day.id);
    if (previousGuard) {
      if (previousGuard.expectedRevision !== day.capacity_revision) throw eventDayCapacityChangedError();
      return [];
    }
    const statement = db
      .prepare(
        `INSERT INTO event_day_capacity_guards (
             id, event_day_id, expected_revision, claim_registration_id
           ) VALUES (?, ?, ?, ?)`,
      )
      .bind(uuid(), day.id, day.capacity_revision, claimsOffer ? claim!.registrationId : null);
    if (sharedGuards) {
      sharedGuards.set(day.id, { expectedRevision: day.capacity_revision, statement });
      return [];
    }
    return [statement];
  });
}
