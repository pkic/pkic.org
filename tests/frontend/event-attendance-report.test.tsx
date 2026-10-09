// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attendanceActionLabel } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/attendance-navigation";
import { EventAttendanceReport } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/EventAttendanceReport";
import { AttendanceReport } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AttendanceReport";
import {
  attendanceSummarySchema,
  attendanceAttemptsResponseSchema,
  attendanceScopeQuerySchema,
} from "../../assets/shared/schemas/event-attendance-reporting";
import { attendanceQuerySchema } from "../../assets/shared/schemas/event-participation-reporting";
import { scanActionSchema } from "../../assets/shared/schemas/event-participation-scanning";
import {
  attendancePeopleExportQuerySchema,
  attendanceAttemptsExportQuerySchema,
  attendanceSummaryExportQuerySchema,
} from "../../assets/shared/schemas/event-attendance-exports";
const id = "11111111-1111-4111-8111-111111111111",
  instant = "2026-12-01T10:00:00.000Z";
const summary = attendanceSummarySchema.parse({
  eventId: id,
  timeZone: "Europe/Amsterdam",
  dayDate: null,
  occurrenceId: null,
  currentIntent: { timeZone: "Europe/Amsterdam", startAt: null, endAt: null, dayIntervalAvailable: true },
  classification: {
    basis: "captured_calendar_date",
    missingObservations: 0,
    missingAttempts: 0,
    capturedTimeZones: 1,
    mixedTimeZones: false,
    dayFilterExcludesMissing: false,
    missingScope: "event_occurrence_mode_without_day",
  },
  generatedAt: instant,
  contactRetention: { state: "unconfigured", contactUntil: null, closedAt: null },
  observed: {
    uniquePeople: 2,
    physicalPeople: 1,
    virtualPeople: 1,
    providerAssertedVirtualPeople: 1,
    originalObservations: 3,
    effectiveObservations: 2,
    voidedObservations: 1,
    entryObservations: 2,
    reentryObservations: 0,
    checkoutObservations: 0,
    importedObservations: 1,
    offlineAuthorizedObservations: 1,
  },
  attempts: {
    recognized: 4,
    successful: 2,
    unsuccessful: 2,
    businessDenials: 1,
    warnings: 1,
    unverified: 0,
    checks: 1,
    admissions: 1,
    attendance: 1,
    exceptions: 1,
  },
  sync: {
    knownGrants: 5,
    unclosedGrants: 3,
    unclosedDevices: 2,
    revokedUnclosedGrants: 1,
    expiredUnclosedGrants: 1,
    reconciledAdmissions: 1,
    heldUnspentSlots: 7,
    deviceBacklog: "unknown",
    scannerReconciliation: {
      scope: "event",
      coverage: "legacy_unknown",
      coverageStartedAt: null,
      sourceState: "live",
      knownEpochs: 0,
      openEpochs: 0,
      closingEpochs: 0,
      closedEpochs: 0,
      unknownHighWaterEpochs: 0,
      missingDeclaredReceipts: 0,
      unprovenClosedEpochs: 0,
      untrackedAttempts: 4,
      unclosedGrants: 3,
      deviceBacklog: "unknown",
    },
    completeness: "not_established",
    lastReceivedAt: instant,
  },
  evidence: {
    clockVerification: "unverified",
    providerVerification: "source_assertion",
    presenceDuration: "not_established",
    checkoutCaptureSupported: false,
    entryCounting: "person_target_mode_browser_observations",
  },
});
const page = { limit: 50, offset: 0, total: 1, hasMore: false };
let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
async function mount(view: "summary" | "attendees" | "scan-log" | "diagnostics" = "summary", reasons = false) {
  document.adoptedStyleSheets = [];
  if (!host?.isConnected) {
    host = document.createElement("div");
    document.body.append(host);
  }
  await act(() =>
    render(
      <EventAttendanceReport slug="event" timeZone="Europe/Amsterdam" epoch={0} view={view} reasons={reasons} />,
      host,
    ),
  );
  await settle();
}
function fixture(url: string) {
  if (new URL(url, "https://example.test").pathname.endsWith("/attendance"))
    return {
      sessions: [{ occurrenceId: id, title: "Opening session", scans: 4, unsuccessful: 2, attendees: 2 }],
      page,
    };
  if (url.includes("/summary")) return summary;
  if (url.includes("/people"))
    return {
      attendees: [
        {
          userId: id,
          displayName: "Private attendee",
          firstObservedAt: instant,
          lastObservedAt: instant,
          observationCount: 2,
          missingContextObservations: 1,
          capturedTimeZones: 1,
          physicalObservations: 1,
          virtualObservations: 1,
          importedObservations: 1,
          providerAssertedVirtualObservations: 1,
          reservedSessions: 3,
          savedSessions: 2,
          approvalPendingSessions: 1,
        },
      ],
      page,
    };
  if (url.includes("/attempts"))
    return {
      attempts: [
        {
          id,
          userId: id,
          displayName: "Private attendee",
          occurrenceId: null,
          operatorUserId: id,
          deviceId: id,
          action: "exception",
          outcome: "admitted",
          reason: "override",
          exceptionReason: "Organizer approved",
          admissionDecision: null,
          observedAt: instant,
          receivedAt: instant,
          clockVerification: "unverified",
          offlineReconciled: true,
          captureContext: { state: "missing", reason: "not_captured" },
        },
      ],
      page,
    };
  return {
    reasons: [
      {
        key: "reason",
        action: "exception",
        outcome: "admitted",
        reason: "override",
        exceptionReason: "Organizer approved",
        count: 1,
      },
    ],
    page,
  };
}
describe("event and day attendance report", () => {
  it.each(["pending", "complete"] as const)(
    "shows %s transport status without claiming complete attendance",
    async (deviceBacklog) => {
      const current = attendanceSummarySchema.parse({
        ...summary,
        sync: {
          ...summary.sync,
          deviceBacklog,
          scannerReconciliation: {
            ...summary.sync.scannerReconciliation,
            coverage: "from_event_creation",
            coverageStartedAt: instant,
            knownEpochs: 2,
            openEpochs: deviceBacklog === "pending" ? 1 : 0,
            closedEpochs: deviceBacklog === "complete" ? 2 : 1,
            untrackedAttempts: 0,
            unclosedGrants: deviceBacklog === "pending" ? 3 : 0,
            deviceBacklog,
          },
        },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) => json(String(input).includes("/summary") ? current : fixture(String(input)))),
      );
      await mount("diagnostics");
      expect(host.textContent).toContain(deviceBacklog === "pending" ? "Uploads pending" : "Uploads accounted for");
      expect(host.textContent).toContain("do not establish complete reporting or presence duration");
      expect(host.textContent).toContain("covers the entire event");
      expect(host.textContent).toContain("Enrolled scanner sessions");
      expect(host.textContent).not.toContain("Device backlog is unknown");
    },
  );
  it("reports evidence limits, separate physical/virtual counts and scoped day/mode queries", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(String(input), "https://example.test");
        requests.push(url);
        (url.pathname.endsWith("/attendance") ? attendanceQuerySchema : attendanceScopeQuerySchema).parse(
          Object.fromEntries(url.searchParams),
        );
        return json(fixture(String(input)));
      }),
    );
    await mount();
    expect(host.textContent).toContain("Some uploads may still be outstanding");
    expect(host.textContent).toContain("Eligibility checks do not establish attendance or presence duration");
    expect(host.textContent).toContain("Physical attendance");
    expect(host.textContent).toContain("Virtual attendance");
    await mount("diagnostics");
    expect(host.textContent).toContain("Upload coverage unknown");
    expect(host.textContent).toContain("Device times are unverified");
    expect(host.textContent).toContain("Revoked historical grants still unclosed");
    expect(host.textContent).toContain("Expired historical grants still unclosed");
    expect(host.textContent).not.toContain("Private attendee");
    await act(() => {
      const input = host.querySelector<HTMLInputElement>('input[type="date"]')!;
      input.value = "2026-12-01";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const mode = host.querySelector<HTMLSelectElement>("select")!;
      mode.value = "virtual";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    const scoped = requests.filter((url) => url.searchParams.has("dayDate"));
    expect(scoped.length).toBeGreaterThan(0);
    expect(
      scoped.every(
        (url) =>
          url.searchParams.get("dayDate") === "2026-12-01" && url.searchParams.get("attendanceMode") === "virtual",
      ),
    ).toBe(true);
    for (const label of ["Scan attempts", "Reasons and exceptions"]) {
      await mount(label === "Scan attempts" ? "scan-log" : "diagnostics", label === "Reasons and exceptions");
      if (label === "Scan attempts") {
        await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Choose columns"]')!.click());
        await act(() =>
          [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
            .find((item) => item.textContent?.includes("Exception explanation"))!
            .click(),
        );
      }
      expect(host.textContent).toContain("Organizer approved");
    }
    expect(requests.some((url) => url.pathname.endsWith("/attempts"))).toBe(true);
    expect(requests.some((url) => url.pathname.endsWith("/reasons"))).toBe(true);
  });
  it("explains unclassified day exclusions and mixed captured zones independently of current schedule intent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const value = fixture(String(input));
        if (String(input).includes("/summary"))
          return json(
            attendanceSummarySchema.parse({
              ...summary,
              dayDate: "2026-12-01",
              classification: {
                ...summary.classification,
                missingObservations: 12,
                missingAttempts: 4,
                capturedTimeZones: 2,
                mixedTimeZones: true,
                dayFilterExcludesMissing: true,
              },
            }),
          );
        return json(value);
      }),
    );
    await mount("diagnostics");
    expect(host.textContent).toContain("12 observations and 4 scan attempts");
    expect(host.textContent).toContain("their date has not been inferred");
    expect(host.textContent).toContain("Captures span multiple recorded time zones");
    expect(host.textContent).toContain("Current schedule time zoneEurope/Amsterdam");
    expect(host.textContent).not.toContain("Day boundaries use");
  });
  it("uses bounded server session selection and sends the selected session to every evidence view", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(String(input), "https://example.test");
        requests.push(url);
        (url.pathname.endsWith("/attendance") ? attendanceQuerySchema : attendanceScopeQuerySchema).parse(
          Object.fromEntries(url.searchParams),
        );
        return json(fixture(String(input)));
      }),
    );
    await mount();
    const picker = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await act(() => picker.click());
    await act(() =>
      [...host.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((option) => option.textContent === "Opening session")!
        .click(),
    );
    await settle();
    expect(picker.value).toBe("Opening session");
    for (const [label, schema] of [
      ["Download observed people (CSV)", attendancePeopleExportQuerySchema],
      ["Download attendance summary (CSV)", attendanceSummaryExportQuerySchema],
    ] as const) {
      await mount(label === "Download observed people (CSV)" ? "attendees" : "summary");
      const link = host.querySelector<HTMLAnchorElement>(`a[aria-label="${label}"]`)!;
      const url = new URL(link.href);
      const parsed = schema.parse(Object.fromEntries(url.searchParams));
      expect(parsed.occurrenceId).toBe(id);
      expect(url.searchParams.has("limit")).toBe(false);
      expect(url.searchParams.has("offset")).toBe(false);
    }
    expect(
      requests.some((url) => url.pathname.endsWith("/summary") && url.searchParams.get("occurrenceId") === id),
    ).toBe(true);
    for (const label of ["Scan attempts", "Reasons and exceptions"]) {
      await mount(label === "Scan attempts" ? "scan-log" : "diagnostics", label === "Reasons and exceptions");
    }
    expect(
      requests
        .filter((url) => /\/(attempts|reasons)$/.test(url.pathname))
        .every((url) => url.searchParams.get("occurrenceId") === id),
    ).toBe(true);
    const catalog = requests.find((url) => url.pathname.endsWith("/attendance"))!;
    expect(catalog.searchParams.get("limit")).toBe("25");
    expect(catalog.searchParams.get("sort")).toBe("title");
    await mount("summary");
    const currentPicker = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await act(() => currentPicker.click());
    await act(() =>
      [...host.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((option) => option.textContent === "All sessions")!
        .click(),
    );
    await settle();
    expect(requests.at(-1)!.searchParams.has("occurrenceId")).toBe(false);
  });
  it("offers every canonical scan action including checkout in the attempt filter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => json(fixture(String(input)))),
    );
    await mount();
    await mount("scan-log");
    await settle();
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Action column options"]')!.click());
    await act(() =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.includes("Filter"))!
        .click(),
    );
    const choices = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    for (const action of scanActionSchema.options)
      expect(choices.some((item) => item.textContent?.trim() === attendanceActionLabel(action))).toBe(true);
    await act(() => choices.find((item) => item.textContent?.trim() === attendanceActionLabel("checkout"))!.click());
    await settle();
    const link = host.querySelector<HTMLAnchorElement>('a[aria-label="Download scan log (CSV)"]')!;
    const url = new URL(link.href);
    const query = attendanceAttemptsExportQuerySchema.parse(Object.fromEntries(url.searchParams));
    expect(query.action).toBe("checkout");
    expect(query.sort).toBe("-receivedAt");
    expect(url.searchParams.has("limit")).toBe(false);
    expect(url.searchParams.has("offset")).toBe(false);
  });
  it("clears people while offline or hidden and after a failed refresh", async () => {
    const fetcher = vi.fn(async (input: string) => json(fixture(String(input))));
    vi.stubGlobal("fetch", fetcher);
    await mount("attendees");
    expect(host.textContent).toContain("Private attendee");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(host.textContent).not.toContain("Private attendee");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();
    expect(host.textContent).toContain("Private attendee");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(host.textContent).not.toContain("Private attendee");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    fetcher.mockImplementation(async (input) =>
      String(input).includes("/people")
        ? json({ error: { code: "REFUSED", message: "Access revoked" } }, 403)
        : json(fixture(String(input))),
    );
    await act(() => host.querySelector<HTMLButtonElement>('button[title="Refresh observed event attendees"]')!.click());
    await settle();
    expect(host.textContent).not.toContain("Private attendee");
  });
  it("explains expired contact access and keeps only aggregate views and summary export", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("/summary"))
          return json(
            attendanceSummarySchema.parse({
              ...summary,
              contactRetention: { state: "closed", contactUntil: instant, closedAt: instant },
            }),
          );
        if (String(input).includes("/people"))
          return json(
            { error: { code: "EVENT_CONTACT_RETENTION_EXPIRED", message: "Contact access has expired" } },
            410,
          );
        return json(fixture(String(input)));
      }),
    );
    await mount();
    await settle();
    expect(host.textContent).toContain("Attendee contact access has ended");
    expect(host.textContent).not.toContain("Private attendee");
    expect(host.querySelector('a[aria-label="Download observed people (CSV)"]')).toBeNull();
    expect(host.querySelector('a[aria-label="Download scan log (CSV)"]')).toBeNull();
    expect(host.querySelector('a[aria-label="Download attendance summary (CSV)"]')).not.toBeNull();
    await mount("attendees");
    expect(host.textContent).toContain("Contact access has expired");
    expect(host.textContent).not.toContain("Private attendee");
    expect(host.querySelector('a[aria-label="Download observed people (CSV)"]')).toBeNull();
    await mount("diagnostics", true);
    expect(host.textContent).toContain("Scan reason breakdown");
  });
  it("makes no reporting request for an import-only operator", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    document.adoptedStyleSheets = [];
    host = document.createElement("div");
    document.body.append(host);
    await act(() => render(<AttendanceReport slug="event" timeZone="UTC" canRead={false} canImport />, host));
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Import attendance");
    expect(host.textContent).not.toContain("Event and day attendance");
  });
  it.each([false, true])(
    "separates decision counts from attendance and preserves unavailable history (%s)",
    async (available) => {
      const attempts = available
        ? {
            ...summary.attempts,
            admissionAllowed: 1,
            admissionRefused: 0,
            admissionUnresolved: 1,
            admissionUnknown: 0,
            uniqueAllowedAdmissionPeople: 1,
          }
        : summary.attempts;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) =>
          json(
            String(input).includes("/summary")
              ? attendanceSummarySchema.parse({ ...summary, attempts })
              : fixture(String(input)),
          ),
        ),
      );
      await mount();
      await mount("diagnostics");
      const evidence = host.querySelector('[aria-label="Attendance diagnostics"]')!;
      for (const [label, count] of [
        ["Allowed admission decisions", 1],
        ["Refused admission decisions", 0],
        ["Unresolved admission decisions", 1],
        ["Admission decisions not recorded", 0],
        ["People with allowed admission", 1],
      ] as const) {
        const row = [...evidence.querySelectorAll("tbody tr")].find((element) => element.textContent?.includes(label))!;
        expect(row.textContent).toContain(available ? String(count) : "Unavailable");
      }
      expect(evidence.textContent).toContain("Admission attempts");
    },
  );
  it.each(["allowed", "refused", "unresolved", null] as const)(
    "shows the attempt decision independently of its eligibility (%s)",
    async (admissionDecision) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) => {
          const value = fixture(String(input));
          if (String(input).includes("/attempts")) {
            const response = attendanceAttemptsResponseSchema.parse(value);
            return json({
              ...response,
              attempts: response.attempts.map((row) => ({ ...row, outcome: "eligible", admissionDecision })),
            });
          }
          return json(value);
        }),
      );
      await mount();
      await mount("scan-log");
      await settle();
      await act(() => host.querySelector<HTMLButtonElement>('[aria-label="Choose columns"]')!.click());
      const decisionColumn = [...host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent?.trim() === "Admission decision",
      )!;
      await act(() => decisionColumn.click());
      const table = [...host.querySelectorAll("table")].find(
        (element) => element.querySelector("caption")?.textContent === "Scan log",
      )!;
      expect([...table.querySelectorAll("thead th")].map((header) => header.textContent?.trim())).toContain(
        "Admission decision",
      );
      expect(table.textContent).toContain(
        admissionDecision === null
          ? "Not recorded"
          : `${admissionDecision[0]!.toUpperCase()}${admissionDecision.slice(1)}`,
      );
      expect(table.textContent).toContain("Successful");
    },
  );
});
