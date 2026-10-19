import { describe, expect, it } from "vitest";
import {
  attributeSessionStays,
  eventAttendanceSettings,
  eventAttendanceSettingsSchema,
  type MovementEvent,
} from "../assets/shared/attendance-attribution";

const at = (time: string) => `2026-10-05T${time}:00.000Z`;
const session = (id: string, start: string, end: string) => ({ id, startAt: at(start), endAt: at(end) });
const checkIn = (sessionId: string, time: string): MovementEvent => ({ kind: "check_in", sessionId, at: at(time) });
const checkOut = (time: string): MovementEvent => ({ kind: "check_out", at: at(time) });

// Two parallel tracks from 09:00 to 10:00, a short talk overlapping both, and one later session.
const keynote = session("keynote", "09:00", "10:00");
const workshop = session("workshop", "09:00", "10:00");
const lightning = session("lightning", "09:50", "10:10");
const panel = session("panel", "11:00", "12:00");
const agenda = [keynote, workshop, lightning, panel];

const summary = (events: MovementEvent[], minimumStayPercent?: number) =>
  attributeSessionStays(agenda, events, minimumStayPercent).map(
    ({ sessionId, dwellSeconds, tooShort, attributed }) => ({
      sessionId,
      minutes: dwellSeconds / 60,
      tooShort,
      attributed,
    }),
  );

describe("session attribution", () => {
  it("runs a stay until the session ends when nothing follows", () => {
    expect(attributeSessionStays(agenda, [checkIn("keynote", "09:10")])).toEqual([
      {
        sessionId: "keynote",
        checkedInAt: at("09:10"),
        leftAt: at("10:00"),
        dwellSeconds: 3000,
        tooShort: false,
        attributed: true,
      },
    ]);
  });

  it("attributes overlapping sessions to the one attended longest", () => {
    // 20 minutes in the keynote, then 40 in the workshop next door.
    expect(summary([checkIn("keynote", "09:00"), checkIn("workshop", "09:20")])).toEqual([
      { sessionId: "keynote", minutes: 20, tooShort: true, attributed: false },
      { sessionId: "workshop", minutes: 40, tooShort: false, attributed: true },
    ]);
  });

  it("clips a stay to the session's own start and end", () => {
    // Checked in 25 minutes early; the time before 09:00 does not count.
    expect(summary([checkIn("keynote", "08:35"), checkIn("panel", "10:30")])).toEqual([
      { sessionId: "keynote", minutes: 60, tooShort: false, attributed: true },
      { sessionId: "panel", minutes: 60, tooShort: false, attributed: true },
    ]);
  });

  it("ends a stay at a check-out and adds a later return to the same session", () => {
    expect(
      summary([
        checkIn("keynote", "09:00"),
        checkOut("09:15"),
        checkIn("workshop", "09:20"),
        checkIn("keynote", "09:30"),
      ]),
    ).toEqual([
      { sessionId: "keynote", minutes: 45, tooShort: false, attributed: true },
      { sessionId: "workshop", minutes: 10, tooShort: true, attributed: false },
    ]);
  });

  it("ignores a repeated check-in at the session the person is already in", () => {
    expect(summary([checkIn("keynote", "09:00"), checkIn("keynote", "09:40")])).toEqual([
      { sessionId: "keynote", minutes: 60, tooShort: false, attributed: true },
    ]);
  });

  it("keeps sessions that do not overlap separate, and attributes across a gap", () => {
    // Out from 09:30 until the panel: the gap is nobody's time.
    expect(summary([checkIn("workshop", "09:00"), checkOut("09:30"), checkIn("panel", "11:05")])).toEqual([
      { sessionId: "workshop", minutes: 30, tooShort: false, attributed: true },
      { sessionId: "panel", minutes: 55, tooShort: false, attributed: true },
    ]);
  });

  it("attributes both ends of a chain when the short talk in the middle overlaps them", () => {
    // Keynote and lightning overlap, lightning and panel do not; the keynote wins the overlap.
    expect(summary([checkIn("keynote", "09:00"), checkIn("lightning", "09:55"), checkIn("panel", "11:00")])).toEqual([
      { sessionId: "keynote", minutes: 55, tooShort: false, attributed: true },
      { sessionId: "lightning", minutes: 15, tooShort: false, attributed: false },
      { sessionId: "panel", minutes: 60, tooShort: false, attributed: true },
    ]);
  });

  it("never attributes a stay with no time inside the session, and breaks ties by the earlier check-in", () => {
    expect(summary([checkIn("panel", "10:30"), checkIn("keynote", "10:40")])).toEqual([
      { sessionId: "panel", minutes: 0, tooShort: true, attributed: false },
      { sessionId: "keynote", minutes: 0, tooShort: true, attributed: false },
    ]);
    expect(summary([checkIn("keynote", "09:30"), checkIn("workshop", "09:30")])).toEqual([
      { sessionId: "keynote", minutes: 0, tooShort: true, attributed: false },
      { sessionId: "workshop", minutes: 30, tooShort: false, attributed: true },
    ]);
    expect(summary([checkIn("workshop", "09:00"), checkIn("keynote", "09:30")])).toEqual([
      { sessionId: "workshop", minutes: 30, tooShort: false, attributed: true },
      { sessionId: "keynote", minutes: 30, tooShort: false, attributed: false },
    ]);
  });

  it("counts the session someone stayed for, not the end of the one before it", () => {
    // Walks into the last 15 minutes of the keynote to wait for the panel.
    const morning = [session("keynote", "09:00", "10:00"), session("panel", "10:00", "11:00")];
    expect(attributeSessionStays(morning, [checkIn("keynote", "09:45"), checkIn("panel", "10:00")])).toMatchObject([
      { sessionId: "keynote", dwellSeconds: 900, tooShort: true, attributed: false },
      { sessionId: "panel", dwellSeconds: 3600, tooShort: false, attributed: true },
    ]);
  });

  it("counts a stay from the minimum share of the session's length, which the event sets", () => {
    // 30 of 60 minutes is exactly half; 29 is not.
    expect(summary([checkIn("workshop", "09:30")])).toMatchObject([{ tooShort: false, attributed: true }]);
    expect(summary([checkIn("workshop", "09:31")])).toMatchObject([{ tooShort: true, attributed: false }]);
    expect(summary([checkIn("workshop", "09:31")], 25)).toMatchObject([{ tooShort: false, attributed: true }]);
    expect(summary([checkIn("workshop", "09:10")], 100)).toMatchObject([{ tooShort: true, attributed: false }]);
  });

  it("lets a counting stay win an overlap over a longer one that is too short", () => {
    // 15 minutes of the 20-minute lightning talk counts; 20 of the 60-minute keynote does not.
    expect(summary([checkIn("keynote", "09:30"), checkIn("lightning", "09:50"), checkOut("10:05")])).toEqual([
      { sessionId: "keynote", minutes: 20, tooShort: true, attributed: false },
      { sessionId: "lightning", minutes: 15, tooShort: false, attributed: true },
    ]);
  });

  it("reads the event's minimum stay setting, falling back to half the session", () => {
    expect(eventAttendanceSettings({ attendance: { minimumStayPercent: 75 } })).toEqual({ minimumStayPercent: 75 });
    expect(eventAttendanceSettings({})).toEqual({ minimumStayPercent: 50 });
    expect(eventAttendanceSettings({ attendance: { minimumStayPercent: 5 } })).toEqual({ minimumStayPercent: 50 });
    expect(eventAttendanceSettingsSchema.safeParse({ minimumStayPercent: 101 }).success).toBe(false);
    expect(eventAttendanceSettingsSchema.safeParse({ minimumStayPercent: 10 }).success).toBe(true);
  });

  it("orders events by time, whatever order they arrive in, and ignores unknown sessions", () => {
    expect(summary([checkIn("workshop", "09:20"), checkIn("removed", "09:10"), checkIn("keynote", "09:00")])).toEqual(
      summary([checkIn("keynote", "09:00"), checkIn("workshop", "09:20")]),
    );
  });
});
