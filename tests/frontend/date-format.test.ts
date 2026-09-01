import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatCalendarDate,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDateTimeInZone,
  formatEventWhen,
  formatMonthYear,
  formatRelativeDays,
} from "../../assets/ts/shared/ui";

afterEach(() => {
  vi.useRealTimers();
});

describe("friendly date formatting", () => {
  it("names the zone when speaking a venue's clock and stays local otherwise", () => {
    const zoned = formatDateTimeInZone("2026-12-01T08:00:00.000Z", "Europe/Amsterdam");
    // 08:00Z is 09:00 in Amsterdam in December (CET) — the zone must be visible.
    expect(zoned).toContain("9:00");
    expect(zoned).toMatch(/CET|GMT\+1/);
    expect(formatDateTimeInZone(null, "Europe/Amsterdam")).toBe("—");

    // In-person (has a location): the venue's clock, labeled.
    expect(formatEventWhen("2026-12-01T08:00:00.000Z", "Europe/Amsterdam", "Amsterdam")).toMatch(/CET|GMT\+1/);
    // Virtual (no location): the viewer's local time, unlabeled.
    expect(formatEventWhen("2026-12-01T08:00:00.000Z", "Europe/Amsterdam", null)).not.toMatch(/CET|GMT\+1/);
    // The viewer's own registration outranks the venue heuristic in both directions.
    expect(formatEventWhen("2026-12-01T08:00:00.000Z", "Europe/Amsterdam", null, "in_person")).toMatch(/CET|GMT\+1/);
    expect(formatEventWhen("2026-12-01T08:00:00.000Z", "Europe/Amsterdam", "Amsterdam", "virtual")).not.toMatch(
      /CET|GMT\+1/,
    );
  });

  it("renders a multi-day span as one range in the event's zone", () => {
    const range = formatDateRange("2026-12-01T08:00:00.000Z", "2026-12-03T17:00:00.000Z", "Europe/Amsterdam");
    expect(range).toContain("December");
    expect(range).toContain("2026");
    expect(range).toMatch(/1/);
    expect(range).toMatch(/3/);
  });

  it("collapses a single-day event to one date and survives a missing end", () => {
    const sameDay = formatDateRange("2026-12-01T08:00:00.000Z", "2026-12-01T17:00:00.000Z", "Europe/Amsterdam");
    expect(sameDay).toContain("December");
    expect(sameDay).not.toContain("–");
    expect(formatDateRange("2026-12-01T08:00:00.000Z", null, null)).toContain("December");
    expect(formatDateRange(null, null, null)).toBe("—");
  });

  it("reports days until an instant and stays silent about the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T12:00:00.000Z"));
    expect(formatRelativeDays("2026-12-01T09:00:00.000Z")).toContain("95");
    expect(formatRelativeDays("2026-08-28T15:00:00.000Z")).toBe("today");
    expect(formatRelativeDays("2026-08-29T15:00:00.000Z")).toBe("tomorrow");
    expect(formatRelativeDays("2026-08-01T00:00:00.000Z")).toBeNull();
    expect(formatRelativeDays(null)).toBeNull();
    expect(formatRelativeDays("not-a-date")).toBeNull();
  });

  it("formats a date-only value with no time of day, or an em dash", () => {
    const date = formatDate("2026-12-01T23:00:00.000Z");
    expect(date).not.toMatch(/\d{1,2}:\d{2}/);
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });

  it("renders a calendar date on its own day, never through a zone shift", () => {
    // A date-only value is day-precise in the owning entity's zone. Rendered
    // through the viewer's zone it would fall back to 3 September for anyone
    // west of UTC, so it must stay on the UTC calendar in every time zone.
    expect(formatCalendarDate("2026-09-04")).toBe(
      new Date("2026-09-04T00:00:00Z").toLocaleString(undefined, { dateStyle: "medium", timeZone: "UTC" }),
    );
    expect(formatCalendarDate("2026-09-04")).toContain("4");
    // Not date-only: treated as an instant in the viewer's zone.
    expect(formatCalendarDate("2026-09-04T10:00:00.000Z")).toBe(formatDate("2026-09-04T10:00:00.000Z"));
    expect(formatCalendarDate(null)).toBe("—");
    expect(formatCalendarDate("nonsense")).toBe("—");
  });

  it("renders a month-precise value without a day, pinned to the UTC calendar for date-only input", () => {
    const rendered = formatMonthYear("2026-09-04");
    expect(rendered).toBe(
      new Date("2026-09-04T00:00:00Z").toLocaleString(undefined, {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }),
    );
    expect(rendered).toContain("2026");
    expect(rendered).not.toContain("4");
    expect(formatMonthYear(null)).toBe("—");
  });

  it("widens a date-time to seconds for audit trails and can name the viewer's zone", () => {
    expect(formatDateTime("2026-12-01T08:00:00.000Z")).toBe(
      new Date("2026-12-01T08:00:00.000Z").toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }),
    );
    expect(formatDateTime("2026-12-01T08:00:00.000Z", { seconds: true })).toMatch(/\d{1,2}.\d{2}.\d{2}/);
    // The zone-labeled variant tells the reader whose clock is shown.
    expect(formatDateTime("2026-12-01T08:00:00.000Z", { zoneName: true })).not.toBe(
      formatDateTime("2026-12-01T08:00:00.000Z"),
    );
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("nonsense")).toBe("—");
  });

  it("follows the viewer's own locale and never pins a literal one (issue #10)", () => {
    // Different locales really do order these dates differently…
    const sample = new Date("2026-09-04T00:00:00Z");
    const options = { dateStyle: "medium", timeZone: "UTC" } as const;
    expect(new Intl.DateTimeFormat("en-US", options).format(sample)).toMatch(/^Sep/);
    expect(new Intl.DateTimeFormat("sv-SE", options).format(sample)).toMatch(/^4/);

    // …and every helper hands Intl an undefined locale so the viewer's own
    // browser decides. A literal locale anywhere in the shared formatters is
    // the bug issue #10 reported.
    const spy = vi.spyOn(Date.prototype, "toLocaleString");
    try {
      formatDate("2026-12-01T23:00:00.000Z");
      formatCalendarDate("2026-09-04");
      formatMonthYear("2026-09-04");
      formatDateTime("2026-12-01T08:00:00.000Z", { seconds: true });
      formatDateTime("2026-12-01T08:00:00.000Z", { zoneName: true });
      formatDateTimeInZone("2026-12-01T08:00:00.000Z", "Europe/Amsterdam");
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(6);
      for (const call of spy.mock.calls) expect(call[0]).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
