import { describe, expect, it } from "vitest";
import {
  calendarSubscriptionLink,
  calendarSubscriptionProviders,
  meetingSeriesCalendarPath,
  registrationCalendarPath,
  webcalUrl,
} from "../assets/shared/calendar-subscription-links";

const feed = `https://pkic.org/api/v1/events/pqc-2026/calendar/subscriptions/${"a".repeat(64)}/calendar.ics`;
const webcal = `webcal://pkic.org/api/v1/events/pqc-2026/calendar/subscriptions/${"a".repeat(64)}/calendar.ics`;

describe("calendar subscription links", () => {
  it("addresses the feed as a subscription without changing its host or path", () => {
    expect(webcalUrl(feed)).toBe(webcal);
    expect(webcalUrl("http://localhost:8788/feed.ics")).toBe("webcal://localhost:8788/feed.ics");
    expect(() => webcalUrl("javascript:alert(1)")).toThrow();
  });

  it("opens Google Calendar's subscribe prompt with the encoded webcal address", () => {
    const link = new URL(calendarSubscriptionLink("google", feed, "My agenda"));
    expect(link.origin + link.pathname).toBe("https://calendar.google.com/calendar/r");
    expect(link.searchParams.get("cid")).toBe(webcal);
  });

  it.each([
    ["outlook-com", "https://outlook.live.com/calendar/0/addfromweb"],
    ["microsoft-365", "https://outlook.office.com/calendar/0/addfromweb"],
  ] as const)("opens %s's subscribe-from-web flow with a percent-encoded name", (provider, base) => {
    const href = calendarSubscriptionLink(provider, feed, "PQC Conference 2026 – My agenda");
    const link = new URL(href);
    expect(link.origin + link.pathname).toBe(base);
    expect(link.searchParams.get("url")).toBe(webcal);
    expect(link.searchParams.get("name")).toBe("PQC Conference 2026 – My agenda");
    expect(href).not.toContain("+");
  });

  it("hands Apple Calendar the webcal address directly", () => {
    expect(calendarSubscriptionLink("apple", feed, "My agenda")).toBe(webcal);
  });

  it("builds a link for every offered provider", () => {
    for (const provider of calendarSubscriptionProviders)
      expect(calendarSubscriptionLink(provider, feed, "My agenda")).toMatch(/^(https|webcal):\/\//);
  });
});

describe("calendar file paths", () => {
  const series = "/api/v1/groups/pqc%20wg/meetings/series/series%2F1/calendar.ics";

  it("addresses a meeting series file with encoded identifiers and no empty query", () => {
    expect(meetingSeriesCalendarPath("pqc wg", "series/1")).toBe(series);
  });

  it("scopes a meeting series file to the reader and to one occurrence when asked", () => {
    expect(meetingSeriesCalendarPath("pqc wg", "series/1", { personal: true })).toBe(`${series}?personal=true`);
    const single = new URL(
      meetingSeriesCalendarPath("pqc wg", "series/1", { personal: true, occurrenceId: "occ&1" }),
      "https://pkic.org",
    );
    expect(single.searchParams.get("personal")).toBe("true");
    expect(single.searchParams.get("occurrenceId")).toBe("occ&1");
    expect(meetingSeriesCalendarPath("pqc wg", "series/1", { occurrenceId: "occ-1" })).toBe(
      `${series}?occurrenceId=occ-1`,
    );
  });

  it("addresses a registration's personal event file", () => {
    expect(registrationCalendarPath("pqc 2026", "reg/1")).toBe(
      "/api/v1/events/pqc%202026/registrations/reg%2F1/calendar.ics",
    );
  });
});
