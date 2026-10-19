import { describe, expect, it } from "vitest";
import {
  attendanceModeForStanding,
  attendancePointDecision,
  attendeeStanding,
  dayOccupancy,
  decodeAttendancePointResource,
  encodeAttendancePointResource,
  resolveRoomSession,
  sessionCheckInWindow,
  type AttendanceStandingForDay,
} from "../assets/shared/attendance-points";

const eventId = "5f0c9d1e-4b7a-4c39-9a51-6f2f0f3c1a10";
const inPerson: AttendanceStandingForDay = { registered: true, dayAttendance: "in_person", waitlisted: false };
const sessions = [
  { id: "a", startAt: "2026-10-05T07:00:00.000Z", endAt: "2026-10-05T08:00:00.000Z", roomIds: ["hall"] },
  { id: "b", startAt: "2026-10-05T08:15:00.000Z", endAt: "2026-10-05T09:00:00.000Z", roomIds: ["hall", "annex"] },
  { id: "c", startAt: "2026-10-05T22:10:00.000Z", endAt: "2026-10-05T23:00:00.000Z", roomIds: ["hall"] },
];

describe("check-in point codes", () => {
  it("round-trips every point kind and rejects anything else", () => {
    for (const selection of [
      { kind: "venue_check_in", dayDate: "2026-10-05" },
      { kind: "venue_check_out", dayDate: "2026-10-05" },
      { kind: "room", roomId: "4d9a2b1c3e5f60718293a4b5c6d7e8f9" },
      { kind: "session", occurrenceId: eventId },
    ] as const)
      expect(decodeAttendancePointResource(encodeAttendancePointResource(eventId, selection))).toEqual({
        eventId,
        selection,
      });
    expect(decodeAttendancePointResource(`vi:${eventId}:not-a-date`)).toBeNull();
    expect(decodeAttendancePointResource(`zz:${eventId}:2026-10-05`)).toBeNull();
    expect(decodeAttendancePointResource(`vi:${eventId}:2026-10-05:extra`)).toBeNull();
    // A code names its point only: there is no time slot to add.
    expect(decodeAttendancePointResource(`s:${eventId}:${eventId}:29876543`)).toBeNull();
  });
});

describe("room code resolution", () => {
  it("resolves to the running session, then the next one starting soon, across session boundaries", () => {
    expect(resolveRoomSession(sessions, "hall", "2026-10-05T07:59:59.999Z", "UTC")).toMatchObject({
      state: "running",
      session: { id: "a" },
    });
    // The first session has ended; the next starts within the lead time.
    expect(resolveRoomSession(sessions, "hall", "2026-10-05T08:00:00.000Z", "UTC")).toMatchObject({
      state: "starting_soon",
      session: { id: "b" },
    });
    expect(resolveRoomSession(sessions, "annex", "2026-10-05T08:20:00.000Z", "UTC")).toMatchObject({
      state: "running",
      session: { id: "b" },
    });
    expect(resolveRoomSession(sessions, "hall", "2026-10-05T09:30:00.000Z", "UTC")).toEqual({ state: "none" });
  });

  it("only offers a session starting soon on the same event-clock day", () => {
    // 21:50 UTC is 23:50 in Amsterdam; session c starts at 00:10 there, the next day.
    expect(resolveRoomSession(sessions, "hall", "2026-10-05T21:50:00.000Z", "Europe/Amsterdam")).toEqual({
      state: "none",
    });
    // In New York the same instants are 17:50 and 18:10 on one day.
    expect(resolveRoomSession(sessions, "hall", "2026-10-05T21:50:00.000Z", "America/New_York")).toMatchObject({
      state: "starting_soon",
      session: { id: "c" },
    });
  });

  it("opens a session for check-in shortly before it starts until it ends", () => {
    expect(sessionCheckInWindow(sessions[0]!, "2026-10-05T06:29:59.000Z")).toBe("not_open");
    expect(sessionCheckInWindow(sessions[0]!, "2026-10-05T06:30:00.000Z")).toBe("open");
    expect(sessionCheckInWindow(sessions[0]!, "2026-10-05T08:00:00.000Z")).toBe("ended");
  });
});

describe("attendee standing", () => {
  it("names the standing a check-in is recorded with and never turns anyone away for it", () => {
    expect(attendeeStanding(inPerson)).toBe("in_person");
    expect(attendeeStanding(null)).toBe("not_registered");
    expect(attendeeStanding({ ...inPerson, registered: false })).toBe("not_registered");
    expect(attendeeStanding({ ...inPerson, dayAttendance: "none" })).toBe("not_registered");
    expect(attendeeStanding({ ...inPerson, dayAttendance: "virtual" })).toBe("remote");
    expect(attendeeStanding({ ...inPerson, dayAttendance: "on_demand", waitlisted: true })).toBe("remote");
    expect(attendeeStanding({ ...inPerson, waitlisted: true })).toBe("no_in_person_place");
  });

  it("records only online registrants as attending online", () => {
    expect(attendanceModeForStanding("remote")).toBe("virtual");
    for (const standing of ["in_person", "not_registered", "no_in_person_place"] as const)
      expect(attendanceModeForStanding(standing)).toBe("physical");
  });
});

describe("check-in decision", () => {
  const venue = (overrides: Partial<Parameters<typeof attendancePointDecision>[0] & { kind: "venue_check_in" }>) =>
    attendancePointDecision({
      kind: "venue_check_in",
      pointDay: "2026-10-05",
      today: "2026-10-05",
      eventDay: true,
      presence: "none",
      ...overrides,
    });

  it("checks in an in-person attendee once and reports the existing check-in after", () => {
    expect(venue({})).toEqual({ status: "ready", reason: null });
    expect(venue({ presence: "checked_in" })).toEqual({ status: "already_checked_in", reason: null });
    expect(venue({ presence: "checked_out" })).toEqual({ status: "ready", reason: null });
  });

  it("refuses only outside the event days or on another day", () => {
    expect(venue({ eventDay: false })).toMatchObject({ reason: "not_event_day" });
    expect(venue({ pointDay: "2026-10-06" })).toMatchObject({ reason: "wrong_day" });
  });

  it("checks out only while checked in", () => {
    const checkOut = (presence: "none" | "checked_in" | "checked_out") =>
      attendancePointDecision({
        kind: "venue_check_out",
        pointDay: "2026-10-05",
        today: "2026-10-05",
        eventDay: true,
        presence,
      });
    expect(checkOut("none")).toMatchObject({ status: "refused", reason: "not_checked_in" });
    expect(checkOut("checked_in")).toEqual({ status: "ready", reason: null });
    expect(checkOut("checked_out")).toEqual({ status: "already_checked_out", reason: null });
  });

  it("checks in to an open session once, whatever the booking", () => {
    const session = (overrides: Record<string, unknown>) =>
      attendancePointDecision({
        kind: "session",
        sessionDay: "2026-10-05",
        today: "2026-10-05",
        window: "open",
        checkedIntoSession: false,
        ...overrides,
      });
    expect(session({})).toEqual({ status: "ready", reason: null });
    expect(session({ checkedIntoSession: true })).toMatchObject({ status: "already_checked_in" });
    expect(session({ window: "ended" })).toMatchObject({ reason: "session_ended" });
    expect(session({ sessionDay: "2026-10-06", window: "not_open" })).toMatchObject({ reason: "session_not_open" });
  });
});

describe("day occupancy", () => {
  it("counts on site as checked in minus checked out, against capacity", () => {
    expect(dayOccupancy({ checkedIn: 120, checkedOut: 15, capacity: 110 })).toEqual({
      checkedIn: 120,
      checkedOut: 15,
      capacity: 110,
      onSite: 105,
      available: 5,
    });
    expect(dayOccupancy({ checkedIn: 3, checkedOut: 0, capacity: null })).toMatchObject({
      onSite: 3,
      available: null,
    });
  });
});
