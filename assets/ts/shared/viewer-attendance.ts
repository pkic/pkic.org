/**
 * What the reader holds at an event, day by day: the one reading every event
 * app surface (welcome, attendance check, ticket, events list) takes of the
 * viewer's standing.
 *
 * The registration-level `attendanceType` is a derivation ("in person if any
 * day is") and says nothing about a seat: someone waitlisted for two
 * in-person days and attending the third online is "in_person" there. Only
 * the per-day standing says which days hold an in-person seat, which are
 * still waiting for one, and which are joined online.
 */
import type { EventViewerState } from "../../shared/schemas/event-management";
import { formatDayList, formatDaySpans } from "../../shared/format-date";

export interface AttendanceStanding {
  /** Days with a confirmed in-person seat. */
  inPerson: string[];
  /** In-person days still waiting for, or offered, a seat. */
  waitlisted: string[];
  virtual: string[];
  onDemand: string[];
  /** A confirmed in-person seat on at least one day (or for the whole event when it has no days). */
  holdsInPersonSeat: boolean;
  /** Joins at least one day live online. */
  online: boolean;
  /** A registration without day rows: its type covers the whole event, so there are no dates to name. */
  wholeEvent: boolean;
}

type ViewerAttendance = Pick<EventViewerState, "attendanceType" | "waitlisted" | "days">;

export function attendanceStanding(viewer: ViewerAttendance): AttendanceStanding {
  const pick = (test: (day: EventViewerState["days"][number]) => boolean) =>
    viewer.days.filter(test).map((day) => day.date);
  if (!viewer.days.length) {
    const type = viewer.attendanceType;
    const waiting = type === "in_person" && viewer.waitlisted;
    return {
      inPerson: [],
      waitlisted: [],
      virtual: [],
      onDemand: [],
      holdsInPersonSeat: type === "in_person" && !waiting,
      online: type === "virtual",
      wholeEvent: true,
    };
  }
  const inPerson = pick((day) => day.attendanceType === "in_person" && day.state === "registered");
  const virtual = pick((day) => day.attendanceType === "virtual" && day.state === "registered");
  return {
    inPerson,
    waitlisted: pick((day) => day.state === "waitlisted"),
    virtual,
    onDemand: pick((day) => day.attendanceType === "on_demand" && day.state === "registered"),
    holdsInPersonSeat: inPerson.length > 0,
    online: virtual.length > 0,
    wholeEvent: false,
  };
}

const WHOLE_EVENT_LABELS: Record<EventViewerState["attendanceType"], string> = {
  in_person: "In person",
  virtual: "Virtual",
  on_demand: "On demand",
};

/**
 * Each part of the standing in a few words, for a list row or a card's meta
 * line: ["In person Dec 1", "Virtual Dec 3", "Waitlisted in person Dec 2"].
 * Confirmed days come first; the wait follows.
 */
export function attendanceStandingParts(viewer: ViewerAttendance): string[] {
  const standing = attendanceStanding(viewer);
  if (standing.wholeEvent)
    return [
      viewer.attendanceType === "in_person" && !standing.holdsInPersonSeat
        ? "Waitlisted in person"
        : WHOLE_EVENT_LABELS[viewer.attendanceType],
    ];
  return [
    standing.inPerson.length ? `In person ${formatDaySpans(standing.inPerson)}` : null,
    standing.virtual.length ? `Virtual ${formatDaySpans(standing.virtual)}` : null,
    standing.onDemand.length ? `On demand ${formatDaySpans(standing.onDemand)}` : null,
    standing.waitlisted.length ? `Waitlisted in person ${formatDaySpans(standing.waitlisted)}` : null,
  ].filter((part): part is string => part !== null);
}

/**
 * The standing as one sentence-like line with weekdays, for the event home's
 * welcome: "On the waiting list for Tue Dec 1 and Wed Dec 2 · Virtual on Thu Dec 3".
 * The wait leads there, since it is the one thing still open.
 */
export function attendanceStandingLine(viewer: ViewerAttendance): string {
  const standing = attendanceStanding(viewer);
  if (standing.wholeEvent) return attendanceStandingParts(viewer)[0] ?? "";
  return [
    standing.waitlisted.length ? `On the waiting list for ${formatDayList(standing.waitlisted)}` : null,
    standing.inPerson.length ? `In person on ${formatDayList(standing.inPerson)}` : null,
    standing.virtual.length ? `Virtual on ${formatDayList(standing.virtual)}` : null,
    standing.onDemand.length ? `On demand on ${formatDayList(standing.onDemand)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
