// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attendanceOccupancyResponseSchema,
  attendancePointExportQuerySchema,
  attendancePointsResponseSchema,
} from "../../assets/shared/schemas/event-attendance-points";
import { AttendanceOccupancy } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AttendanceOccupancy";
import { CheckInCodes } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/CheckInCodes";
import { CheckInCodeView } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/CheckInCodeView";

const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction: confirm }));

const token = `pkc1_${"a".repeat(40)}.${"b".repeat(43)}`;
const basePath = "/groups/g/events/e/stats/attendance";
const listing = (canReissue: boolean) =>
  attendancePointsResponseSchema.parse({
    points: [
      {
        kind: "venue_check_in",
        label: "Day 1 check-in",
        dayDate: "2026-12-01",
        dayLabel: "Day 1",
        room: null,
        session: null,
        token,
        path: `/portal/#/events/summit/check-in/${token}`,
      },
      {
        kind: "room",
        label: "Blue hall",
        dayDate: null,
        dayLabel: null,
        room: { id: "a0000000-0000-4000-8000-000000000031", name: "Blue hall" },
        session: null,
        token: `${token}c`,
        path: `/portal/#/events/summit/check-in/${token}c`,
      },
    ],
    page: { limit: 50, offset: 0, total: 2, hasMore: false },
    timeZone: "Europe/Amsterdam",
    clockCity: "Amsterdam",
    issuedAt: "2026-11-20T09:00:00.000Z",
    canReissue,
  });

let host: HTMLDivElement;
let requests: { method: string; path: string }[];
let canReissue = true;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  requests = [];
  canReissue = true;
  confirm.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), location.origin);
      requests.push({ method: init?.method ?? "GET", path: url.pathname + url.search });
      if (url.pathname.endsWith("/attendance/points/issuances"))
        return Response.json({ issuedAt: "2026-12-01T08:00:00.000Z" }, { status: 201 });
      if (url.pathname.endsWith("/attendance/occupancy"))
        return Response.json(
          attendanceOccupancyResponseSchema.parse({
            days: [
              {
                dayDate: "2026-12-01",
                dayLabel: "Day 1",
                capacity: 1200,
                checkedIn: 1180,
                checkedOut: 40,
                onSite: 1140,
                available: 60,
                selfCheckIns: 900,
                staffCheckIns: 280,
              },
            ],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
            generatedAt: "2026-12-01T10:00:00.000Z",
            timeZone: "Europe/Amsterdam",
            clockCity: "Amsterdam",
          }),
        );
      return Response.json(listing(canReissue));
    }),
  );
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

/** The export query a download link asks for, read back through the shared contract. */
function exportQuery(href: string | null | undefined) {
  const url = new URL(href ?? "", location.origin);
  expect(url.pathname).toBe("/api/v1/events/summit/attendance/points/exports");
  return attendancePointExportQuerySchema.parse(Object.fromEntries(url.searchParams));
}

describe("organizer check-in codes", () => {
  it("lists the codes with SVG downloads and reissue, and reissues only after confirmation", async () => {
    await act(async () => render(<CheckInCodes slug="summit" basePath={basePath} />, host));
    await settle();
    expect(host.textContent).toContain("Day 1 check-in");
    expect(host.textContent).toContain("Blue hall");
    expect(host.textContent).not.toContain("Print");
    const all = host.querySelector('a[aria-label="Download listed codes (ZIP of SVG files)"]');
    expect(all?.hasAttribute("download")).toBe(true);
    expect(exportQuery(all?.getAttribute("href"))).toEqual({ format: "zip" });
    const download = async (label: string) => {
      await act(async () =>
        host.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${label}"]`)!.click(),
      );
      const link = [...document.querySelectorAll("a")].find((item) => item.textContent === "Download SVG");
      const query = exportQuery(link?.getAttribute("href"));
      await act(async () =>
        host.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${label}"]`)!.click(),
      );
      return query;
    };
    expect(await download("Day 1 check-in")).toEqual({ format: "svg", kind: "venue_check_in", dayDate: "2026-12-01" });
    expect(await download("Blue hall")).toEqual({
      format: "svg",
      kind: "room",
      roomId: "a0000000-0000-4000-8000-000000000031",
    });
    const reissue = [...host.querySelectorAll("button")].find((button) => button.textContent === "Reissue codes")!;
    await act(async () => reissue.click());
    await settle();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Reissue codes", tone: "danger" }));
    expect(requests.filter((request) => request.method === "POST")).toEqual([
      { method: "POST", path: "/api/v1/events/summit/attendance/points/issuances" },
    ]);
  });

  it("does not offer reissue to a reader who cannot reissue", async () => {
    canReissue = false;
    await act(async () => render(<CheckInCodes slug="summit" basePath={basePath} />, host));
    await settle();
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Reissue codes")).toBe(false);
  });

  it("shows one code full size with its SVG download", async () => {
    await act(async () => render(<CheckInCodeView slug="summit" kind="venue_check_in" target="2026-12-01" />, host));
    await settle();
    expect(requests[0]!.path).toContain("kind=venue_check_in");
    expect(requests[0]!.path).toContain("dayDate=2026-12-01");
    expect(host.querySelector('svg[aria-label="Check-in code: Day 1 check-in"] path')?.getAttribute("d")).toMatch(
      /^M\d/,
    );
    const download = host.querySelector('a[aria-label="Download Day 1 check-in (SVG)"]');
    expect(exportQuery(download?.getAttribute("href"))).toEqual({
      format: "svg",
      kind: "venue_check_in",
      dayDate: "2026-12-01",
    });
  });

  it("reports on-site counts against capacity", async () => {
    await act(async () => render(<AttendanceOccupancy slug="summit" />, host));
    await settle();
    expect(host.textContent).toContain("1,140");
    expect(host.textContent).toContain("1,200");
    expect(host.textContent).toContain("60");
  });
});
