/**
 * What the reader holds at an event, day by day: the one reading every event
 * app surface (welcome, attendance check, ticket, events list) takes of the
 * viewer's standing.
 *
 * Each selected day determines which mode is available and whether its place
 * is held or still on a waiting list.
 */
import type { EventViewerState } from "../../shared/schemas/event-management";
import { formatDayList, formatDaySpans } from "../../shared/format-date";

export interface AttendanceStanding {
  /** Days with a confirmed in-person seat. */
  inPerson: string[];
  /** Days still waiting for, or offered, a place. */
  waitlisted: string[];
  waitlistedInPerson: string[];
  expired: string[];
  virtual: string[];
  onDemand: string[];
  /** A confirmed in-person seat on at least one day. */
  holdsInPersonSeat: boolean;
  /** Joins at least one day live online. */
  online: boolean;
}

type ViewerAttendance = Pick<EventViewerState, "waitlisted" | "days">;

export function attendanceStanding(viewer: ViewerAttendance): AttendanceStanding {
  const pick = (test: (day: EventViewerState["days"][number]) => boolean) =>
    viewer.days.filter(test).map((day) => day.date);
  const access = (day: EventViewerState["days"][number]) => day.accessMode;
  const inPerson = pick((day) => access(day) === "physical" && day.state === "registered");
  const virtual = pick((day) => access(day) === "remote" && day.state === "registered");
  return {
    inPerson,
    waitlisted: pick((day) => day.state === "waitlisted"),
    waitlistedInPerson: pick((day) => day.state === "waitlisted" && access(day) === "physical"),
    expired: pick((day) => day.state === "expired"),
    virtual,
    onDemand: pick((day) => day.attendanceType === "on_demand" && access(day) === "none" && day.state === "registered"),
    holdsInPersonSeat: inPerson.length > 0,
    online: virtual.length > 0,
  };
}

/**
 * Each part of the standing in a few words, for a list row or a card's meta
 * line: ["In person Dec 1", "Virtual Dec 3", "Waitlisted in person Dec 2"].
 * Confirmed days come first; the wait follows.
 */
export function attendanceStandingParts(viewer: ViewerAttendance): string[] {
  const standing = attendanceStanding(viewer);
  return [
    standing.inPerson.length ? `In person ${formatDaySpans(standing.inPerson)}` : null,
    standing.virtual.length ? `Virtual ${formatDaySpans(standing.virtual)}` : null,
    standing.onDemand.length ? `On demand ${formatDaySpans(standing.onDemand)}` : null,
    standing.waitlisted.length ? `Waitlisted ${formatDaySpans(standing.waitlisted)}` : null,
    standing.expired.length ? `Offer expired ${formatDaySpans(standing.expired)}` : null,
  ].filter((part): part is string => part !== null);
}

/**
 * The standing as one sentence-like line with weekdays, for the event home's
 * welcome: "On the waiting list for Tue Dec 1 and Wed Dec 2 · Virtual on Thu Dec 3".
 * The wait leads there, since it is the one thing still open.
 */
export function attendanceStandingLine(viewer: ViewerAttendance): string {
  const standing = attendanceStanding(viewer);
  return [
    standing.waitlisted.length ? `On the waiting list for ${formatDayList(standing.waitlisted)}` : null,
    standing.expired.length ? `Offer expired for ${formatDayList(standing.expired)}` : null,
    standing.inPerson.length ? `In person on ${formatDayList(standing.inPerson)}` : null,
    standing.virtual.length ? `Virtual on ${formatDayList(standing.virtual)}` : null,
    standing.onDemand.length ? `On demand on ${formatDayList(standing.onDemand)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
