import { first, all } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import type { EventDayCapacityRow } from "./day-waitlist-types";
import { NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL } from "./day-waitlist-policy";
import type { EventParticipantRole } from "../../../../assets/shared/schemas/participant-roles";

const ROLE_BASED_CAPACITY_EXEMPT_ROLES = [
  "organizer",
  "speaker",
  "moderator",
] as const satisfies readonly EventParticipantRole[];
const ROLE_BASED_CAPACITY_EXEMPT_ROLE_SQL = ROLE_BASED_CAPACITY_EXEMPT_ROLES.map((role) => `'${role}'`).join(", ");

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
      AND ${NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL}
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
       AND role IN (${ROLE_BASED_CAPACITY_EXEMPT_ROLE_SQL})
     ORDER BY CASE role WHEN 'organizer' THEN 1 WHEN 'speaker' THEN 2 WHEN 'moderator' THEN 3 ELSE 9 END
     LIMIT 1`,
    [eventId, userId],
  );
  return roleBasedCapacityExemptReasonForRole(row?.role);
}

/**
 * Resolves the role exemption after one proposal participant source changes.
 * The participant statement is still part of the caller's atomic batch, so
 * this excludes the old source row and overlays the intended next role here.
 */
export async function roleBasedCapacityExemptReasonAfterParticipantChange(
  db: DatabaseLike,
  input: {
    eventId: string;
    userId: string;
    activeProposalRoles: readonly EventParticipantRole[];
  },
): Promise<string | null> {
  const rows = await all<{ role: string }>(
    db,
    `SELECT role
     FROM event_participants
     WHERE event_id = ? AND user_id = ? AND status = 'active'
       AND role IN (${ROLE_BASED_CAPACITY_EXEMPT_ROLE_SQL})
       AND COALESCE(source_type, '') <> 'proposal'`,
    [input.eventId, input.userId],
  );
  const roles = rows.map((row) => row.role);
  roles.push(...input.activeProposalRoles.filter((role) => roleBasedCapacityExemptReasonForRole(role)));
  roles.sort((left, right) => rolePriority(left) - rolePriority(right));
  return roleBasedCapacityExemptReasonForRole(roles[0]);
}

export async function resolveCapacityExemptReason(
  db: DatabaseLike,
  payload: { eventId: string; userId: string },
): Promise<string | null> {
  return roleBasedCapacityExemptReason(db, payload.eventId, payload.userId);
}

export function isEventDayCapacityConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("EVENT_DAY_CAPACITY_CHANGED");
}

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
  throw new AppError(409, "DAY_CAPACITY_CHANGED", "Day capacity changed; please retry");
}

export function prepareCapacityGuardStatements(
  db: DatabaseLike,
  eventDays: EventDayCapacityRow[],
  selectedByDate: Map<string, string>,
  preservedEventDayIds: Set<string>,
  claim?: { registrationId: string; dayDates: ReadonlySet<string> },
): StatementLike[] {
  return eventDays.flatMap((day) => {
    const claimsOffer = claim?.dayDates.has(day.day_date) ?? false;
    const affectsCapacity =
      selectedByDate.get(day.day_date) === "in_person" || preservedEventDayIds.has(day.id) || claimsOffer;
    if (!affectsCapacity || !day.in_person_capacity || day.in_person_capacity <= 0) return [];
    return [
      db
        .prepare(
          `INSERT INTO event_day_capacity_guards (
             id, event_day_id, expected_revision, claim_registration_id
           ) VALUES (?, ?, ?, ?)`,
        )
        .bind(uuid(), day.id, day.capacity_revision, claimsOffer ? claim!.registrationId : null),
    ];
  });
}
