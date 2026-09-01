import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatDate,
  formatDateRange,
  formatDateTimeInZone,
  formatEventWhen,
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
  });
});
