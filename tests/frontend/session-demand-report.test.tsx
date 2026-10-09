// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { SessionDemandReport } from "../../assets/ts/member-flows/portal/sections/events/detail/SessionDemandReport";
import {
  sessionDemandReportQuerySchema,
  sessionDemandReportExportQuerySchema,
  sessionDemandReportResponseSchema,
} from "../../assets/shared/schemas/event-session-demand-report";

let host: HTMLDivElement | null = null;
afterEach(() => {
  if (host) {
    void act(() => render(null, host!));
    host.remove();
    host = null;
  }
  vi.unstubAllGlobals();
});
it("uses published server results and exports the same searched population without page bounds", async () => {
  const queries: unknown[] = [];
  const payload = sessionDemandReportResponseSchema.parse({
    sessions: [
      {
        occurrenceId: "10000000-0000-4000-8000-000000000001",
        title: "Shared planning session",
        startAt: "2030-01-01T10:00:00.000Z",
        endAt: "2030-01-01T10:30:00.000Z",
        admissionPolicy: "reservation",
        accessPolicy: "open",
        attendanceMode: "physical",
        preferences: 7,
        confirmed: 3,
        pending: 2,
        waitlisted: 1,
        occupied: 4,
        sessionCapacity: 10,
        locations: [{ id: "10000000-0000-4000-8000-000000000002", name: "Main room", capacity: 20, occupied: 4 }],
      },
    ],
    page: { limit: 50, offset: 0, total: 1, hasMore: false },
    report: {
      eventId: "10000000-0000-4000-8000-000000000003",
      scheduleBasis: "published_agenda",
      publishedRevision: 2,
      timeZone: "Europe/Amsterdam",
      dayDate: null,
      generatedAt: "2030-01-01T09:00:00.000Z",
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      expect(url.pathname).toBe("/api/v1/events/event-one/agenda/reports/demand");
      queries.push(sessionDemandReportQuerySchema.parse(Object.fromEntries(url.searchParams)));
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    render(<SessionDemandReport slug="event-one" />, host!);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host?.querySelector("tbody")?.textContent).toContain("Shared planning session");
    expect(
      host?.querySelector('section[aria-label="Session demand · Published revision 2 · Europe/Amsterdam"]'),
    ).not.toBeNull();
  });
  expect(host.textContent).toContain("Main room: 4 occupied");
  expect(host.textContent).toContain("Favorites (interest)");
  const search = host.querySelector<HTMLInputElement>('input[type="search"]');
  expect(search).not.toBeNull();
  await act(async () => {
    search!.value = "Shared";
    search!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    search!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(queries.at(-1)).toMatchObject({ q: "Shared", sort: "startAt", offset: 0 });
  });
  const link = host.querySelector<HTMLAnchorElement>('a[aria-label="Download session demand (CSV)"]');
  expect(link).not.toBeNull();
  expect(link!.querySelector("svg")).not.toBeNull();
  const exportUrl = new URL(link!.href, location.origin);
  expect(exportUrl.pathname).toBe("/api/v1/events/event-one/agenda/reports/demand/exports");
  expect(sessionDemandReportExportQuerySchema.parse(Object.fromEntries(exportUrl.searchParams))).toMatchObject({
    q: "Shared",
    sort: "startAt",
  });
  expect(exportUrl.searchParams.has("limit")).toBe(false);
  expect(exportUrl.searchParams.has("offset")).toBe(false);
});
