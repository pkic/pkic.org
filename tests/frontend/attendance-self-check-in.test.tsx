// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attendancePointCommandSchema,
  attendancePointResultSchema,
  type AttendancePointResult,
} from "../../assets/shared/schemas/event-attendance-points";
import { scannedAttendancePoint } from "../../assets/ts/components/attendance-points/attendance-point-url";
import { EventCheckIn } from "../../assets/ts/member-flows/portal/sections/events/app/EventCheckIn";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/events/summit/check-in", vi.fn()] }));

const token = `pkc1_${"a".repeat(40)}.${"b".repeat(43)}`;
const day = {
  action: "check_in",
  kind: "venue_check_in",
  dayDate: "2026-12-01",
  dayLabel: "Day 1",
  room: null,
  session: null,
  timeZone: "Europe/Amsterdam",
  clockCity: "Amsterdam",
} as const;
const room = { id: "a0000000-0000-4000-8000-000000000031", name: "Blue hall" };
const keynote = {
  ...day,
  kind: "room",
  room,
  session: {
    id: "a0000000-0000-4000-8000-000000000032",
    title: "Opening keynote",
    startAt: "2026-12-01T09:00:00.000Z",
    endAt: "2026-12-01T10:00:00.000Z",
    room,
  },
} as const;

let host: HTMLDivElement;
let preview: AttendancePointResult;
let posted: { url: string; body: unknown }[];
let recorded: Partial<AttendancePointResult>;

function result(value: Partial<AttendancePointResult>): AttendancePointResult {
  return attendancePointResultSchema.parse({
    status: "ready",
    reason: null,
    target: day,
    recordedAt: null,
    standing: "in_person",
    booked: null,
    ...value,
  });
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 5; index++) await Promise.resolve();
  });
}

async function show(pointToken?: string) {
  await act(async () => render(<EventCheckIn slug="summit" pointToken={pointToken} />, host));
  await flush();
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  posted = [];
  preview = result({});
  recorded = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), location.origin);
      if (init?.method === "POST") {
        posted.push({ url: url.pathname, body: JSON.parse(String(init.body)) });
        return Response.json(
          result({ ...preview, status: "checked_in", recordedAt: "2026-12-01T08:55:00.000Z", ...recorded }),
        );
      }
      return Response.json(preview);
    }),
  );
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe("attendee check-in screens", () => {
  it("confirms what a code does before recording it, then shows the check-in", async () => {
    await show(token);
    expect(host.textContent).toContain("Check in to Day 1");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Check in")!;
    await act(async () => button.click());
    await flush();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toBe("/api/v1/events/summit/attendance/check-ins");
    expect(attendancePointCommandSchema.parse(posted[0]!.body).pointToken).toBe(token);
    expect(host.textContent).toContain("You're checked in");
    expect(host.textContent).toContain("Welcome to Day 1.");
    expect(host.querySelector(".pk-alert")).toBeNull();
  });

  it("lets someone without a registration or a booked seat check in, and tells them how it is recorded", async () => {
    preview = result({ target: keynote, standing: "not_registered", booked: false });
    await show(token);
    expect(host.textContent).toContain(
      "You're not registered for in-person attendance on Day 1. You can still check in.",
    );
    expect(host.textContent).toContain(
      "No seat booked for this session. If you found a free seat, you can still check in.",
    );
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Check in")!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    await flush();
    expect(host.textContent).toContain("You're checked in");
    expect(host.textContent).toContain("Your check-in is recorded, and the organizers can see it.");
    expect(host.textContent).toContain("No seat booked for this session. Your check-in is recorded.");
  });

  it("tells an online registrant their check-in counts as online attendance", async () => {
    preview = result({ standing: "remote" });
    await show(token);
    expect(host.textContent).toContain(
      "You're registered to join Day 1 online, so this counts as online attendance, not in person.",
    );
    preview = result({ status: "already_checked_in", standing: "no_in_person_place" });
    render(null, host);
    await show(token);
    expect(host.textContent).toContain("You don't have an in-person place for Day 1 yet.");
  });

  it("names the session and room a room code checks in to", async () => {
    preview = result({ target: keynote });
    await show(token);
    expect(host.textContent).toContain("Check in to Opening keynote");
    expect(host.textContent).toContain("Blue hall");
  });

  it("shows an existing check-in without asking again", async () => {
    preview = result({ status: "already_checked_in" });
    await show(token);
    expect(host.textContent).toContain("You're checked in");
    expect(host.querySelector("button")).toBeNull();
  });

  it("explains each refusal in the attendee's terms", async () => {
    const cases: [AttendancePointResult["reason"], string][] = [
      ["wrong_day", "This code is for another day"],
      ["not_checked_in", "You're not checked in"],
      ["session_ended", "This session has ended"],
      ["daily_limit", "Too many scans today"],
    ];
    for (const [reason, title] of cases) {
      preview = result({ status: "refused", reason, standing: null });
      await show(token);
      expect(host.textContent).toContain(title);
      render(null, host);
    }
  });

  it("treats a reissued or damaged code as one that no longer works, without reading it", async () => {
    preview = result({ status: "refused", reason: "invalid_code", target: null, standing: null });
    await show(token);
    expect(host.textContent).toContain("This code doesn't work");
    render(null, host);
    const fetch = vi.mocked(globalThis.fetch);
    fetch.mockClear();
    await show("not-a-code");
    expect(host.textContent).toContain("This code doesn't work");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("scanned check-in links", () => {
  it("reads the event and code from a portal check-in link only", () => {
    expect(scannedAttendancePoint(`https://pkic.org/portal/#/events/summit/check-in/${token}`)).toEqual({
      eventSlug: "summit",
      token,
    });
    expect(scannedAttendancePoint(`https://pkic.org/portal/#/events/summit/ticket`)).toBeNull();
    expect(scannedAttendancePoint(`https://example.test/elsewhere#/events/summit/check-in/${token}`)).toBeNull();
    expect(scannedAttendancePoint("ABCD-EFGH-IJKL-MNOP")).toBeNull();
  });
});
