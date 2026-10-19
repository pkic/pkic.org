// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attendanceAttributionsResponseSchema,
  attendanceMovementsResponseSchema,
  selfCheckInsQuerySchema,
  selfCheckInsResponseSchema,
} from "../../assets/shared/schemas/event-attendance-movement";
import { AttendanceMovement } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AttendanceMovement";
import { SelfCheckIns } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SelfCheckIns";

const clock = { timeZone: "Europe/Amsterdam", city: "Amsterdam" };
const basePath = "/groups/g/events/e/stats/attendance";
const page = (total: number) => ({ limit: 50, offset: 0, total, hasMore: false });
const room = { id: "a0000000-0000-4000-8000-000000000031", name: "Blue hall" };
const keynote = {
  id: "a0000000-0000-4000-8000-000000000032",
  title: "Opening keynote",
  startAt: "2026-12-01T09:00:00.000Z",
  endAt: "2026-12-01T10:00:00.000Z",
  room,
};
const lab = { ...keynote, id: "a0000000-0000-4000-8000-000000000033", title: "Hands-on lab", room: null };
const walkIn = { userId: "a0000000-0000-4000-8000-000000000041", displayName: null, email: "walk-in@example.test" };

const responses: Record<string, unknown> = {
  "/check-ins": selfCheckInsResponseSchema.parse({
    checkIns: [
      {
        id: "a0000000-0000-4000-8000-000000000051",
        observedAt: "2026-12-01T09:05:00.000Z",
        dayDate: "2026-12-01",
        person: walkIn,
        pointKind: "session",
        standing: "not_registered",
        booked: false,
        expected: false,
        session: { id: lab.id, title: lab.title },
        room: null,
      },
    ],
    page: page(1),
  }),
  "/attributions": attendanceAttributionsResponseSchema.parse({
    sessions: [
      {
        session: keynote,
        checkedIn: 1250,
        attributed: 1180,
        remote: 340,
        unexpected: 12,
      },
    ],
    page: page(1),
    minimumStayPercent: 75,
  }),
  "/movements": attendanceMovementsResponseSchema.parse({
    people: [
      {
        person: { ...walkIn, displayName: "Ada Lovelace" },
        firstCheckInAt: "2026-12-01T09:00:00.000Z",
        stays: [
          {
            session: lab,
            checkedInAt: "2026-12-01T09:00:00.000Z",
            leftAt: "2026-12-01T09:05:00.000Z",
            dwellSeconds: 300,
            tooShort: true,
            attributed: false,
          },
          {
            session: keynote,
            checkedInAt: "2026-12-01T09:05:00.000Z",
            leftAt: "2026-12-01T10:00:00.000Z",
            dwellSeconds: 3300,
            tooShort: false,
            attributed: true,
          },
        ],
      },
    ],
    page: page(1),
    minimumStayPercent: 50,
  }),
};

let host: HTMLDivElement;
let requests: URL[];

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      requests.push(url);
      const key = Object.keys(responses).find((suffix) => url.pathname.endsWith(`/attendance${suffix}`));
      return key ? Response.json(responses[key]) : new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("organizer self check-in and movement reports", () => {
  it("lists who checked in without a registration or a booked seat, from the server's filter", async () => {
    history.replaceState(null, "", "/#/check-ins?attendance-check-ins.f.expected=no");
    await act(async () => render(<SelfCheckIns slug="summit" timeZone={clock} />, host));
    await settle();
    const request = requests.find((url) => url.pathname === "/api/v1/events/summit/attendance/check-ins")!;
    expect(selfCheckInsQuerySchema.parse(Object.fromEntries(request.searchParams))).toMatchObject({ expected: "no" });
    const row = host.querySelector("tbody tr")!;
    for (const text of ["walk-in@example.test", "Hands-on lab", "Not registered", "Not booked", "No"])
      expect(row.textContent).toContain(text);
  });

  it("shows attributed, unexpected and online attendance per session as grouped numbers", async () => {
    await act(async () =>
      render(<AttendanceMovement slug="summit" timeZone={clock} basePath={basePath} view="sessions" />, host),
    );
    await settle();
    const row = host.querySelector("tbody tr")!;
    for (const text of ["Opening keynote", "Blue hall", "1,250", "1,180", "12", "340"])
      expect(row.textContent).toContain(text);
    expect(host.querySelector('a[aria-current="page"]')?.textContent).toBe("By session");
    expect(host.textContent).toContain("at least 75% of the session");
  });

  it("shows each person's sessions in order with time spent and where they are counted", async () => {
    await act(async () =>
      render(<AttendanceMovement slug="summit" timeZone={clock} basePath={basePath} view="people" />, host),
    );
    await settle();
    const stays = [...host.querySelectorAll(".pk-attendance-stays__stay")].map((item) => item.textContent);
    expect(stays).toHaveLength(2);
    expect(stays[0]).toContain("Hands-on lab");
    expect(stays[0]).toContain("5 min");
    expect(stays[0]).toContain("5 min, too short to count");
    expect(host.textContent).toContain("less than half of the session");
    expect(stays[1]).toContain("Opening keynote");
    expect(stays[1]).toContain("55 min, counted here");
    expect(host.textContent).toContain("Ada Lovelace");
  });
});
