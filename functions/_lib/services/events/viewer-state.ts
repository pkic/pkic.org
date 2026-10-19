import { eventViewerStateSchema, type EventViewerState } from "../../../../assets/shared/schemas/event-management";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { all, toBool } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { holdsWorkAddress } from "../../email-domains/contact-kind";
import { NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL } from "../registrations/day-waitlist-policy";
import { parseVerifiedAddresses, verifiedAddressesJsonSql } from "../user-emails";

/**
 * Day waitlist rows are the sole authoritative waitlist state (see
 * `registrationLifecycleStatusSchema` in assets/shared/schemas/registration.ts).
 * A day counts as waitlisted while it is waiting for, or offered, a seat; an
 * accepted offer holds the seat. Both the registration-level `waitlisted`
 * flag and the per-day `days` breakdown key off the same seat policy the
 * capacity queries use, so the attendee is never told they hold a seat the
 * door list does not give them.
 */
const VIEWER_STATE_SELECT = `SELECT r.event_id AS event_id,
    r.status AS status,
    r.attendance_type AS attendance_type,
    EXISTS (
      SELECT 1 FROM event_day_waitlist_entries w
       WHERE w.registration_id = r.id
         AND ${NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL}
    ) AS waitlisted,
    COALESCE((
      SELECT JSON_GROUP_ARRAY(JSON_OBJECT('date', day_date, 'attendanceType', day_attendance_type, 'state', state))
      FROM (
        SELECT ed.day_date AS day_date,
               rda.attendance_type AS day_attendance_type,
               CASE WHEN w.id IS NOT NULL THEN 'waitlisted' ELSE 'registered' END AS state
          FROM registration_day_attendance rda
          JOIN event_days ed ON ed.id = rda.event_day_id
          LEFT JOIN event_day_waitlist_entries w
            ON w.event_day_id = rda.event_day_id
           AND w.registration_id = rda.registration_id
           AND ${NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL}
         WHERE rda.registration_id = r.id
         ORDER BY ed.day_date ASC
      )
    ), '[]') AS days_json,
    ${verifiedAddressesJsonSql("r.user_id")} AS verified_addresses
  FROM registrations r`;

interface EventViewerStateRow {
  event_id: string;
  status: string;
  attendance_type: string;
  waitlisted: number;
  days_json: string;
  verified_addresses: string | null;
}

function mapViewerStateRow(row: EventViewerStateRow): EventViewerState {
  return eventViewerStateSchema.parse({
    registrationStatus: row.status,
    attendanceType: row.attendance_type,
    waitlisted: toBool(row.waitlisted),
    days: JSON.parse(row.days_json) as unknown,
    holdsWorkAddress: holdsWorkAddress(parseVerifiedAddresses(row.verified_addresses)),
  });
}

/**
 * Set-based per-viewer enrichment for a page of events: one query joins the
 * caller's registrations (by resolved user) with the day-waitlist aggregate
 * and the registration's selected days, keyed back onto the event id. A
 * cancelled registration is excluded, so the caller has no standing (`viewer:
 * null`) for that event, matching the union-per-event primary key on
 * `registrations(event_id, user_id)`. Anonymous callers and empty pages
 * short-circuit before any query runs.
 */
export async function fetchViewerEventStates(
  db: DatabaseLike,
  userId: string | null,
  eventIds: readonly string[],
): Promise<Map<string, EventViewerState>> {
  const states = new Map<string, EventViewerState>();
  if (!userId || eventIds.length === 0) return states;
  const eventFilter = buildD1JsonMembershipFilter("r.event_id", eventIds);
  const rows = await all<EventViewerStateRow>(
    db,
    `${VIEWER_STATE_SELECT}
      WHERE r.user_id = ? AND r.status <> 'cancelled' AND ${eventFilter.sql}`,
    [userId, ...eventFilter.bindings],
  );
  for (const row of rows) states.set(row.event_id, mapViewerStateRow(row));
  return states;
}

/** Single-event convenience wrapper over {@link fetchViewerEventStates} for detail routes. */
export async function fetchViewerEventState(
  db: DatabaseLike,
  userId: string | null,
  eventId: string,
): Promise<EventViewerState | null> {
  const states = await fetchViewerEventStates(db, userId, [eventId]);
  return states.get(eventId) ?? null;
}
