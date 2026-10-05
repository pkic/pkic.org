import { describe, expect, it } from "vitest";
import {
  attendanceCaptureContextSchema,
  attendanceCaptureRequestFieldsSchema,
  attendanceCaptureTimeZoneSchema,
  captureAttendanceContext,
  storedAttendanceCaptureContext,
  nativeEventCaptureContextSchema,
} from "../assets/shared/schemas/event-attendance-capture";
import { eventScanRequestSchema } from "../assets/shared/schemas/event-participation-scanning";
const input = { timeZone: "Europe/Amsterdam", publicationRevision: 7, source: "published_manifest" as const };
describe("Immutable attendance calendar capture policy", () => {
  it("keeps native calendar capture nullable without inventing publication authority", () => {
    const nativeEventContext = nativeEventCaptureContextSchema.parse({
      profileKey: "meeting",
      timeZone: "Europe/Amsterdam",
    });
    expect(
      attendanceCaptureRequestFieldsSchema.parse({ capturePublicationRevision: null, nativeEventContext }),
    ).toEqual({ capturePublicationRevision: null, nativeEventContext });
    expect(attendanceCaptureRequestFieldsSchema.parse({})).toEqual({});
    for (const capturePublicationRevision of [undefined, 7])
      expect(
        attendanceCaptureRequestFieldsSchema.safeParse({ capturePublicationRevision, nativeEventContext }).success,
      ).toBe(false);
    expect(nativeEventCaptureContextSchema.safeParse({ ...nativeEventContext, profileKey: "conference" }).success).toBe(
      false,
    );
    expect(
      nativeEventCaptureContextSchema.safeParse({ ...nativeEventContext, email: "person@example.test" }).success,
    ).toBe(false);
    const captured = captureAttendanceContext("2026-10-24T23:30:00.000Z", {
      timeZone: nativeEventContext.timeZone,
      publicationRevision: null,
      source: "native_event_manifest",
    });
    expect(captured.dayDate).toBe("2026-10-25");
    expect(attendanceCaptureContextSchema.safeParse({ ...captured, publicationRevision: 1 }).success).toBe(false);
    expect(
      storedAttendanceCaptureContext({
        capture_day_date: captured.dayDate,
        capture_time_zone: captured.timeZone,
        capture_publication_revision: null,
        capture_context_source: captured.source,
      }),
    ).toEqual(captured);
  });

  it("applies the one native context refinement to composed scan requests", () => {
    const scan = {
      operatorUserId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      badgeId: crypto.randomUUID(),
      occurrenceId: null,
      observedAt: "2026-10-24T23:30:00.000Z",
      action: "attendance",
      capturePublicationRevision: null,
      nativeEventContext: { profileKey: "board_meeting", timeZone: "UTC" },
    };
    expect(eventScanRequestSchema.safeParse(scan).success).toBe(true);
    for (const extra of [
      { occurrenceId: crypto.randomUUID() },
      { roomId: crypto.randomUUID() },
      { offlineRight: { grantId: crypto.randomUUID(), activationId: crypto.randomUUID() } },
      { capturePublicationRevision: 0 },
    ])
      expect(eventScanRequestSchema.safeParse({ ...scan, ...extra }).success).toBe(false);
  });
  it("classifies original UTC time in the captured event zone rather than the viewer zone", () => {
    const captured = captureAttendanceContext("2026-12-01T23:30:00.000Z", input);
    expect(captured).toEqual({ state: "captured", dayDate: "2026-12-02", ...input });
    expect(
      captureAttendanceContext("2026-12-01T23:30:00.000Z", { ...input, timeZone: "America/New_York" }).dayDate,
    ).toBe("2026-12-01");
  });
  it.each([
    ["2025-11-02T04:30:00.000Z", "2025-11-02"],
    ["2025-11-03T04:30:00.000Z", "2025-11-02"],
    ["2025-11-03T05:00:00.000Z", "2025-11-03"],
    ["2025-03-09T06:59:00.000Z", "2025-03-09"],
    ["2025-03-09T07:01:00.000Z", "2025-03-09"],
  ])("preserves IANA DST calendar classification for %s", (instant, dayDate) => {
    expect(captureAttendanceContext(instant, { ...input, timeZone: "America/New_York" }).dayDate).toBe(dayDate);
  });
  it.each(["CET", "+01:00", "Invalid/Timezone", ""])("refuses ambiguous or invalid capture zone %s", (zone) => {
    expect(attendanceCaptureTimeZoneSchema.safeParse(zone).success).toBe(false);
  });
  it("keeps historical context stable and refuses private metadata in strict transport", () => {
    const context = captureAttendanceContext("2026-12-01T23:30:00.000Z", input);
    expect(attendanceCaptureContextSchema.safeParse({ ...context, displayName: "Person" }).success).toBe(false);
    expect(attendanceCaptureContextSchema.parse(context)).toMatchObject({ state: "captured", publicationRevision: 7 });
    expect(
      captureAttendanceContext("2026-12-01T23:30:00.000Z", {
        ...input,
        timeZone: "UTC",
        source: "server_receipt",
        publicationRevision: null,
      }).dayDate,
    ).toBe("2026-12-01");
    expect(attendanceCaptureContextSchema.safeParse({ ...context, publicationRevision: null }).success).toBe(false);
  });
  it("represents uncaptured legacy and partial records honestly without a current-zone fallback", () => {
    const empty = {
      capture_day_date: null,
      capture_time_zone: null,
      capture_publication_revision: null,
      capture_context_source: null,
    };
    expect(storedAttendanceCaptureContext(empty)).toEqual({ state: "missing", reason: "not_captured" });
    expect(storedAttendanceCaptureContext({ ...empty, capture_day_date: "2026-12-01" })).toEqual({
      state: "missing",
      reason: "incomplete_capture",
    });
    expect(
      storedAttendanceCaptureContext({
        capture_day_date: "2026-12-02",
        capture_time_zone: "Europe/Amsterdam",
        capture_publication_revision: 7,
        capture_context_source: "published_manifest",
      }),
    ).toMatchObject({ state: "captured", dayDate: "2026-12-02", publicationRevision: 7 });
  });
  it("distinguishes absent, no-publication and pinned revision metadata without accepting caller day or timezone", () => {
    expect(attendanceCaptureRequestFieldsSchema.parse({})).toEqual({});
    expect(attendanceCaptureRequestFieldsSchema.parse({ capturePublicationRevision: null })).toEqual({
      capturePublicationRevision: null,
    });
    expect(attendanceCaptureRequestFieldsSchema.parse({ capturePublicationRevision: 0 })).toEqual({
      capturePublicationRevision: 0,
    });
    expect(attendanceCaptureRequestFieldsSchema.safeParse({ capturePublicationRevision: -1 }).success).toBe(false);
    expect(attendanceCaptureRequestFieldsSchema.safeParse({ dayDate: "2026-12-01", timeZone: "UTC" }).success).toBe(
      false,
    );
  });
  it("rejects noncanonical timestamps instead of changing original observation precision or offsets", () => {
    expect(() => captureAttendanceContext("2026-12-01T23:30:00+01:00", input)).toThrow();
  });
});
