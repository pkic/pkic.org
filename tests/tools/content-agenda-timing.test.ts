import { describe, expect, it } from "vitest";
import { contentAgendaSlotTiming, type ContentAgendaTimingSource } from "../../assets/shared/content-agenda-timing";

describe("published conference timing", () => {
  const session = { time: "9:00", sessions: [{}] };
  const next = { time: "9:30", sessions: [{}] };
  const timing = (
    slot: ContentAgendaTimingSource = session,
    following: ContentAgendaTimingSource = next,
    transition = 5,
  ) => contentAgendaSlotTiming("2025-10-29", "Asia/Kuala_Lumpur", slot, following, transition);

  it("retains the event zone and handover used by the production program", () => {
    expect(timing()).toEqual({ startsAt: "2025-10-29T01:00:00.000Z", durationMinutes: 25 });
    expect(timing(session, next, 10).durationMinutes).toBe(20);
  });

  it("keeps breaks, explicit windows, and handover exemptions intact", () => {
    expect(timing({ ...session, noTransition: true }).durationMinutes).toBe(30);
    expect(timing({ ...session, durationMinutes: 90 }).durationMinutes).toBe(90);
    expect(timing(session, { ...next, sessions: [] }).durationMinutes).toBe(30);
    expect(timing({ ...session, sessions: [] }).durationMinutes).toBe(30);
    expect(timing(session, { ...next, time: "9:05" }).durationMinutes).toBe(5);
    expect(timing(session, { ...next, time: "9:00", sessions: [] }).durationMinutes).toBe(0);
  });

  it("resolves daylight saving through the canonical wall-clock codec", () => {
    expect(contentAgendaSlotTiming("2026-10-25", "Europe/Amsterdam", { time: "01:30" }, { time: "03:30" })).toEqual({
      startsAt: "2026-10-24T23:30:00.000Z",
      durationMinutes: 180,
    });
    expect(() => contentAgendaSlotTiming("2026-03-29", "Europe/Amsterdam", { time: "02:30" })).toThrow();
  });

  it("leaves an unspecified final window open and refuses reversed times", () => {
    expect(contentAgendaSlotTiming("2025-10-29", "Asia/Kuala_Lumpur", session).durationMinutes).toBeUndefined();
    expect(() => timing(session, { ...next, time: "8:30" })).toThrow("Invalid conference duration");
  });
});
