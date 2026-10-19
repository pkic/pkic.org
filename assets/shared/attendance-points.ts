/**
 * Attendee self check-in: what a check-in code points at and what scanning it does.
 *
 * A check-in point is derived, never hand-managed: each event day has a venue
 * check-in and a venue check-out point, each agenda room has one room point,
 * and each published session has its own point for on-screen use. The code
 * names the point only (kind, event and target identifiers); it never carries
 * anything about a person.
 *
 * A room point covers a whole day: it resolves on the event clock to the
 * session running in that room, else to the next one starting soon that day.
 *
 * Every scan by a signed-in person is recorded, whether or not they are
 * registered, hold an in-person place or booked the session: their standing is
 * kept with the record and shown to them, never used to turn them away. A
 * registrant attending online that day is recorded as attending online, so a
 * code seen on a livestream never adds to in-person attendance.
 *
 * Every code is fixed for its point until the organizers reissue the event's
 * codes. Each session has its own code, so a code shown on a studio output
 * changes when the session changes, and a session code stops working once its
 * session ends.
 *
 * The decision is pure policy so the backend use case and its tests read the
 * same rules. Checking in or out never changes a registration, an attendance
 * mode, a waiting list or a place offer; it only records attendance.
 */
import { z } from "zod";
import { instantToCalendarDate } from "./timezone";

export const ATTENDANCE_POINT_KINDS = ["venue_check_in", "venue_check_out", "room", "session"] as const;
export const attendancePointKindSchema = z.enum(ATTENDANCE_POINT_KINDS);
export type AttendancePointKind = z.infer<typeof attendancePointKindSchema>;

/** Who recorded a check-in or check-out: the attendee scanning a code, or staff scanning a badge. */
export const attendanceCaptureMethodSchema = z.enum(["staff", "self"]);
export type AttendanceCaptureMethod = z.infer<typeof attendanceCaptureMethodSchema>;

/**
 * Guards on what one person can write, so the attendance log stays readable
 * without ever stopping ordinary comings and goings. Scanning the same code
 * again within a few seconds is the same scan: nothing new is recorded and the
 * earlier result is returned. Past a generous daily number of check-ins and
 * check-outs, which only a runaway loop or a script reaches, further scans
 * that day are refused.
 */
export const SELF_CHECK_IN_REPEAT_SECONDS = 10;
export const SELF_CHECK_IN_DAILY_LIMIT = 100;

/** Whether a person has recorded as many check-ins and check-outs today as a day allows. */
export function selfCheckInDailyLimitReached(writesToday: number): boolean {
  return writesToday >= SELF_CHECK_IN_DAILY_LIMIT;
}

/** A room code admits people this long before its next session starts. */
export const ROOM_SESSION_LEAD_MINUTES = 30;
const LEAD_MS = ROOM_SESSION_LEAD_MINUTES * 60_000;

const dayDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const identifier = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

/**
 * Which point to show. The studio's Graphics panel and the organizer page name
 * a point with this selection; the server turns it into a signed code.
 */
export const attendancePointSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("venue_check_in"), dayDate }).strict(),
  z.object({ kind: z.literal("venue_check_out"), dayDate }).strict(),
  z.object({ kind: z.literal("room"), roomId: identifier }).strict(),
  z.object({ kind: z.literal("session"), occurrenceId: identifier }).strict(),
]);
export type AttendancePointSelection = z.infer<typeof attendancePointSelectionSchema>;

const KIND_CODES: Record<AttendancePointKind, string> = {
  venue_check_in: "vi",
  venue_check_out: "vo",
  room: "r",
  session: "s",
};
const KINDS_BY_CODE = Object.fromEntries(Object.entries(KIND_CODES).map(([kind, code]) => [code, kind])) as Record<
  string,
  AttendancePointKind
>;

function selectionTarget(selection: AttendancePointSelection): string {
  switch (selection.kind) {
    case "venue_check_in":
    case "venue_check_out":
      return selection.dayDate;
    case "room":
      return selection.roomId;
    case "session":
      return selection.occurrenceId;
  }
}

/** The signed resource of a point: `<kind code>:<event id>:<day, room or session id>`. */
export function encodeAttendancePointResource(eventId: string, selection: AttendancePointSelection): string {
  return `${KIND_CODES[selection.kind]}:${identifier.parse(eventId)}:${selectionTarget(attendancePointSelectionSchema.parse(selection))}`;
}

export function decodeAttendancePointResource(
  resource: string,
): { eventId: string; selection: AttendancePointSelection } | null {
  const parts = resource.split(":");
  if (parts.length !== 3) return null;
  const [code, eventId, target] = parts as [string, string, string];
  const kind = KINDS_BY_CODE[code];
  if (!kind || !identifier.safeParse(eventId).success) return null;
  const candidate =
    kind === "venue_check_in" || kind === "venue_check_out"
      ? { kind, dayDate: target }
      : kind === "room"
        ? { kind, roomId: target }
        : { kind, occurrenceId: target };
  const selection = attendancePointSelectionSchema.safeParse(candidate);
  return selection.success ? { eventId, selection: selection.data } : null;
}

export interface ScheduledSession {
  id: string;
  startAt: string;
  endAt: string;
  roomIds: readonly string[];
}

export type RoomSessionResolution<T extends ScheduledSession> =
  | { state: "running"; session: T }
  | { state: "starting_soon"; session: T }
  | { state: "none" };

/**
 * The session a room code means at `now`: the one running in the room (the
 * latest to start when sessions overlap), else the next to start within the
 * lead time on the same event-clock day, else none.
 */
export function resolveRoomSession<T extends ScheduledSession>(
  sessions: readonly T[],
  roomId: string,
  now: string,
  timeZone: string,
): RoomSessionResolution<T> {
  const at = Date.parse(now);
  const today = instantToCalendarDate(now, timeZone);
  const inRoom = sessions.filter((session) => session.roomIds.includes(roomId));
  const running = inRoom
    .filter((session) => Date.parse(session.startAt) <= at && at < Date.parse(session.endAt))
    .sort((left, right) => Date.parse(right.startAt) - Date.parse(left.startAt) || left.id.localeCompare(right.id));
  if (running[0]) return { state: "running", session: running[0] };
  const next = inRoom
    .filter((session) => {
      const start = Date.parse(session.startAt);
      return start > at && start - at <= LEAD_MS && instantToCalendarDate(session.startAt, timeZone) === today;
    })
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt) || left.id.localeCompare(right.id));
  return next[0] ? { state: "starting_soon", session: next[0] } : { state: "none" };
}

/** A session takes check-ins from the lead time before it starts until it ends. */
export function sessionCheckInWindow(
  session: Pick<ScheduledSession, "startAt" | "endAt">,
  now: string,
): "open" | "not_open" | "ended" {
  const at = Date.parse(now);
  if (at >= Date.parse(session.endAt)) return "ended";
  return Date.parse(session.startAt) - at <= LEAD_MS ? "open" : "not_open";
}

export const ATTENDANCE_POINT_REFUSALS = [
  "invalid_code",
  "not_event_day",
  "wrong_day",
  "not_checked_in",
  "no_session",
  "session_not_open",
  "session_ended",
  "closed",
  "daily_limit",
] as const;
export const attendancePointRefusalSchema = z.enum(ATTENDANCE_POINT_REFUSALS);
export type AttendancePointRefusal = z.infer<typeof attendancePointRefusalSchema>;

export const attendancePointStatusSchema = z.enum([
  "ready",
  "checked_in",
  "checked_out",
  "already_checked_in",
  "already_checked_out",
  "refused",
]);
export type AttendancePointStatus = z.infer<typeof attendancePointStatusSchema>;

/** A person's venue state on one day: never scanned, inside, or left after the last check-in. */
export type VenuePresence = "none" | "checked_in" | "checked_out";

export interface AttendanceStandingForDay {
  /** A confirmed registration (email confirmed, not cancelled). */
  registered: boolean;
  /** The registered attendance on that day; `none` when the day is not part of the registration. */
  dayAttendance: "in_person" | "virtual" | "on_demand" | "none";
  /** Waiting for, or offered, an in-person place on that day. */
  waitlisted: boolean;
}

/**
 * Where a person stands when they scan, recorded with the check-in and shown
 * to them: a confirmed in-person place, attending online that day, not
 * registered for the day, or registered without an in-person place yet.
 */
export const ATTENDEE_STANDINGS = ["in_person", "remote", "not_registered", "no_in_person_place"] as const;
export const attendeeStandingSchema = z.enum(ATTENDEE_STANDINGS);
export type AttendeeStanding = z.infer<typeof attendeeStandingSchema>;

export function attendeeStanding(standing: AttendanceStandingForDay | null): AttendeeStanding {
  if (!standing?.registered || standing.dayAttendance === "none") return "not_registered";
  if (standing.dayAttendance !== "in_person") return "remote";
  return standing.waitlisted ? "no_in_person_place" : "in_person";
}

/**
 * The attendance mode a check-in is recorded with. Only a registrant attending
 * online that day is remote; anyone else who scans is taken to be in the room.
 */
export function attendanceModeForStanding(standing: AttendeeStanding): "physical" | "virtual" {
  return standing === "remote" ? "virtual" : "physical";
}

export type AttendancePointDecisionInput =
  | {
      kind: "venue_check_in" | "venue_check_out";
      pointDay: string;
      today: string;
      eventDay: boolean;
      /** Presence in the attendance mode the scan is recorded in. */
      presence: VenuePresence;
    }
  | {
      kind: "session";
      sessionDay: string;
      today: string;
      window: "open" | "not_open" | "ended";
      checkedIntoSession: boolean;
    };

export type AttendancePointDecision =
  | { status: "ready" | "already_checked_in" | "already_checked_out"; reason: null }
  | { status: "refused"; reason: AttendancePointRefusal };

const refused = (reason: AttendancePointRefusal): AttendancePointDecision => ({ status: "refused", reason });

/**
 * What scanning a point does for this person now. Room points are resolved to
 * a session first. Only time and place refuse a scan: registration, an
 * in-person place and a session booking never do.
 */
export function attendancePointDecision(input: AttendancePointDecisionInput): AttendancePointDecision {
  if (input.kind === "session") {
    if (input.sessionDay !== input.today || input.window === "not_open") return refused("session_not_open");
    if (input.window === "ended") return refused("session_ended");
    if (input.checkedIntoSession) return { status: "already_checked_in", reason: null };
    return { status: "ready", reason: null };
  }
  if (!input.eventDay) return refused("not_event_day");
  if (input.pointDay !== input.today) return refused("wrong_day");
  if (input.kind === "venue_check_in")
    return input.presence === "checked_in"
      ? { status: "already_checked_in", reason: null }
      : { status: "ready", reason: null };
  if (input.presence === "none") return refused("not_checked_in");
  return input.presence === "checked_out"
    ? { status: "already_checked_out", reason: null }
    : { status: "ready", reason: null };
}

/** On site is everyone whose latest venue scan that day is a check-in. */
export function dayOccupancy(counts: { checkedIn: number; checkedOut: number; capacity: number | null }) {
  const onSite = Math.max(0, counts.checkedIn - counts.checkedOut);
  return {
    ...counts,
    onSite,
    available: counts.capacity === null ? null : Math.max(0, counts.capacity - onSite),
  };
}
