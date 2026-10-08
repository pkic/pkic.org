import { describe, expect, it } from "vitest";
import { agendaLocalClock, agendaTimeZones } from "../../assets/shared/agenda-time-display";
import { instantToDateTimeLocal } from "../../assets/shared/timezone";

describe("agenda clock presentation policy", () => {
  it("keeps physical and unknown attendance venue-primary and makes remote browser-primary", () => {
    expect(agendaTimeZones("Europe/Amsterdam", "Asia/Tokyo", "physical")).toEqual({
      primary: { zone: "Europe/Amsterdam", label: "Event time" },
      secondary: undefined,
    });
    expect(agendaTimeZones("Europe/Amsterdam", "Asia/Tokyo", null).primary.zone).toBe("Europe/Amsterdam");
    expect(agendaTimeZones("Europe/Amsterdam", "Asia/Tokyo", "remote")).toEqual({
      primary: { zone: "Asia/Tokyo", label: "Your time" },
      secondary: { zone: "Europe/Amsterdam", label: "Event time" },
    });
    expect(agendaTimeZones("Europe/Amsterdam", "Asia/Tokyo", "physical", true).secondary?.zone).toBe("Asia/Tokyo");
    expect(agendaTimeZones("Europe/Amsterdam", "Europe/Amsterdam", "remote").secondary).toBeUndefined();
  });

  it.each([
    ["2026-03-29T00:30:00.000Z", "2026-03-29T01:30", "9:30"],
    ["2026-03-29T01:30:00.000Z", "2026-03-29T03:30", "10:30"],
    ["2026-10-25T00:30:00.000Z", "2026-10-25T02:30", "9:30"],
    ["2026-10-25T01:30:00.000Z", "2026-10-25T02:30", "10:30"],
  ])("reads canonical UTC %s correctly across spring/fall venue DST", (instant, venueClock, browserClock) => {
    expect(instantToDateTimeLocal(instant, "Europe/Amsterdam")).toBe(venueClock);
    const browser = agendaLocalClock(instant, "Europe/Amsterdam", "Asia/Tokyo");
    expect(browser.time).toMatch(new RegExp(`^0?${browserClock}$`));
    expect(browser.time).not.toContain("Invalid Date");
    expect(browser.date).toBeUndefined();
  });

  it("labels both next and previous local dates and keeps same-day clocks compact", () => {
    const next = agendaLocalClock("2026-12-01T22:30:00.000Z", "Europe/Amsterdam", "Asia/Tokyo");
    const previous = agendaLocalClock("2026-12-01T23:30:00.000Z", "Europe/Amsterdam", "America/Los_Angeles");
    expect(next.date).toBeDefined();
    expect(previous.date).toBeDefined();
    expect(instantToDateTimeLocal("2026-12-01T22:30:00.000Z", "Asia/Tokyo")).toBe("2026-12-02T07:30");
    expect(instantToDateTimeLocal("2026-12-01T23:30:00.000Z", "America/Los_Angeles")).toBe("2026-12-01T15:30");
    expect(agendaLocalClock("2026-12-01T09:00:00.000Z", "Europe/Amsterdam", "Asia/Tokyo").date).toBeUndefined();
    expect(agendaLocalClock("invalid", "Europe/Amsterdam", "Asia/Tokyo")).toEqual({ time: "—", date: undefined });
  });
});
