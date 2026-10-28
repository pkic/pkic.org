// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { virtualRoomResponseSchema } from "../../assets/shared/schemas/event-live-stream";
import {
  personalAgendaProgramResponseSchema,
  personalAgendaSessionSchema,
} from "../../assets/shared/schemas/event-personal-agenda";
import { sponsorsDisplayResponseSchema } from "../../assets/shared/schemas/public-sponsors";
import { VirtualRoom } from "../../assets/ts/member-flows/portal/sections/events/app/virtual-room/VirtualRoom";
import { WatchLiveCard } from "../../assets/ts/member-flows/portal/sections/events/app/virtual-room/WatchLiveCard";
import { chooseLocation } from "../../assets/ts/member-flows/portal/sections/events/app/virtual-room/virtual-room-schedule";
import { HeadingOutline } from "../../assets/ts/ui/HeadingOutline";

const hashLocation = vi.hoisted(() => ({ current: "/events/summit/virtual" }));
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => [hashLocation.current, vi.fn()] }));

const HALL = "a0000000-0000-4000-8000-000000000001";
const STUDIO = "a0000000-0000-4000-8000-000000000002";
const KEYNOTE = "b0000000-0000-4000-8000-000000000001";
const PANEL = "b0000000-0000-4000-8000-000000000002";
const WORKSHOP = "b0000000-0000-4000-8000-000000000003";
const HALL_STREAM = "jfKfPfyJRdk";
const STUDIO_STREAM = "o-1sSF_xP5Q";

function occurrence(id: string, title: string, roomId: string, startAt: string, endAt: string, speaker: string) {
  return {
    id,
    title,
    roomId,
    startAt,
    endAt,
    description: "",
    speakers: [{ userId: `${id}-speaker`, displayName: speaker }],
  };
}

const program = personalAgendaProgramResponseSchema.parse({
  agenda: agendaSnapshotSchema.parse({
    eventSlug: "summit",
    timeZone: "UTC",
    revision: 4,
    publishedRevision: 4,
    rooms: [
      { id: HALL, name: "Main hall", capacity: null },
      { id: STUDIO, name: "Studio", capacity: null },
    ],
    occurrences: [
      occurrence(KEYNOTE, "Opening keynote", HALL, "2027-01-20T09:00:00.000Z", "2027-01-20T10:00:00.000Z", "Ada"),
      occurrence(PANEL, "Migration panel", HALL, "2027-01-20T10:00:00.000Z", "2027-01-20T11:00:00.000Z", "Grace"),
      occurrence(WORKSHOP, "Hands-on lab", STUDIO, "2027-01-20T09:00:00.000Z", "2027-01-20T11:00:00.000Z", "Linus"),
    ],
    shifts: [],
    roleMembers: [],
    assignments: [],
  }),
  marks: [],
});
const streams = virtualRoomResponseSchema.parse({
  timeZone: "UTC",
  locations: [
    { id: HALL, name: "Main hall", stream: { provider: "youtube", videoId: HALL_STREAM }, days: [] },
    { id: STUDIO, name: "Studio", stream: { provider: "youtube", videoId: STUDIO_STREAM }, days: [] },
  ],
});
const sponsors = sponsorsDisplayResponseSchema.parse({
  groups: [
    {
      weight: 5,
      tierName: "Gold",
      sponsors: [
        {
          id: "c0000000-0000-4000-8000-000000000001",
          name: "Example Trust",
          website: "https://trust.example.test/",
          logoUrl: "/assets/sponsor.svg",
          tier: null,
          eventTier: "Gold",
          effectiveTier: "Gold",
          weight: 5,
        },
      ],
    },
  ],
  page: { limit: 200, offset: 0, total: 1, hasMore: false },
});

let host: HTMLDivElement;
let streamStatus = 200;
let waiting = false;

beforeEach(() => {
  window.history.replaceState(null, "", "/portal/#/events/summit/virtual");
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2027-01-20T09:30:00.000Z"));
  hashLocation.current = "/events/summit/virtual";
  streamStatus = 200;
  waiting = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), location.origin).pathname;
      if (path.endsWith("/agenda/streams"))
        return streamStatus === 200
          ? Response.json(waiting ? { ...streams, locations: [] } : streams)
          : Response.json(
              { error: { code: "VIRTUAL_ROOM_UNAVAILABLE", message: "A registration is required." } },
              { status: streamStatus },
            );
      if (path.endsWith("/agenda/participation/program"))
        return Response.json(
          waiting
            ? {
                ...program,
                agenda: {
                  ...program.agenda,
                  rooms: program.agenda!.rooms.map((room) => ({ ...room, equipment: ["live_streaming"] })),
                },
              }
            : program,
        );
      if (path.endsWith("/sponsors/display")) return Response.json(sponsors);
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function open() {
  await act(async () => {
    render(
      <HeadingOutline titleLevel={1}>
        <VirtualRoom slug="summit" eventName="Summit" />
      </HeadingOutline>,
      host,
    );
  });
  for (let round = 0; round < 5; round += 1)
    await act(async () => {
      await Promise.resolve();
    });
}

const player = () => host.querySelector<HTMLIFrameElement>("iframe");
const nowPlaying = () => host.querySelector('[aria-label="Now in this room"]')?.textContent ?? "";
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const tab = (label: string) => tabs().find((item) => item.textContent === label)!;

describe("virtual room", () => {
  it("plays the first location's stream in the privacy-enhanced player with the running session under it", async () => {
    await open();
    expect(player()?.getAttribute("src")).toMatch(
      new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${HALL_STREAM}\\?`),
    );
    expect(nowPlaying()).toContain("Opening keynote");
    expect(nowPlaying()).toContain("Ada");
    const title = host.querySelector<HTMLAnchorElement>('[aria-label="Now in this room"] h2 a');
    expect(title?.getAttribute("href")).toBe(`#/events/summit/agenda?session=${KEYNOTE}`);
  });

  it("offers the room's question and chat panels alongside its current schedule", async () => {
    await open();
    expect(tabs().map((item) => item.textContent)).toEqual(["Now & next", "Questions", "Chat", "Sponsors"]);
    // The player comes before the panels, so a phone shows it first and keeps it above them.
    const order = [...host.querySelectorAll('iframe, [aria-label="In this room"]')].map((node) => node.tagName);
    expect(order).toEqual(["IFRAME", "SECTION"]);
    await act(async () => tab("Questions").click());
    // A session is running in the fixture, so the tab joins its live questions rather than waiting.
    const panel = host.querySelector('[role="tabpanel"]');
    expect(panel?.textContent).not.toContain("Questions open when the session is live");
    expect(panel?.querySelector('section[aria-labelledby="virtual-room-tab-questions"]')).not.toBeNull();
    await act(async () => tab("Sponsors").click());
    const logo = host.querySelector<HTMLAnchorElement>('[role="tabpanel"] a');
    expect(logo?.getAttribute("href")).toBe("https://trust.example.test/");
    expect(logo?.getAttribute("target")).toBe("_blank");
  });

  it("lists now and next for the location and moves on at the session boundary without asking the server", async () => {
    await open();
    const schedule = () =>
      [...host.querySelectorAll('[aria-label="Sessions in this room"] li')].map((item) => item.textContent ?? "");
    expect(schedule()).toHaveLength(2);
    expect(schedule()[0]).toContain("Now");
    expect(schedule()[0]).toContain("Opening keynote");
    expect(schedule()[1]).toContain("Migration panel");
    const requests = vi.mocked(fetch).mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(31 * 60_000);
    });
    expect(nowPlaying()).toContain("Migration panel");
    expect(nowPlaying()).toContain("Grace");
    expect(schedule()).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.length).toBe(requests);
  });

  it("restores the bookmarked room panel without putting attendee input in the URL", async () => {
    window.history.replaceState(null, "", "/portal/#/events/summit/virtual?roomPanel=questions");
    await open();
    expect(tab("Questions").getAttribute("aria-selected")).toBe("true");
    expect(location.hash).toContain("roomPanel=questions");
    expect(host.querySelector('[aria-label="Sessions in this room"]')).toBeNull();
  });

  it("switches location through its own address and opens on the session that brought the reader", async () => {
    await open();
    const locations = [...host.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Locations"] a')];
    expect(locations.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Main hall", `#/events/summit/virtual?room=${HALL}`],
      ["Studio", `#/events/summit/virtual?room=${STUDIO}`],
    ]);
    render(null, host);
    hashLocation.current = `/events/summit/virtual?session=${WORKSHOP}`;
    await open();
    expect(player()?.getAttribute("src")).toContain(STUDIO_STREAM);
    expect(nowPlaying()).toContain("Hands-on lab");
    expect(chooseLocation(streams.locations, program.agenda, { room: "unknown", session: null })).toBe(HALL);
  });

  it("opens a planned room before a stream is configured, counts down, and shows disabled interaction controls", async () => {
    waiting = true;
    vi.setSystemTime(new Date("2027-01-19T09:00:00.000Z"));
    await open();
    expect(player()).toBeNull();
    expect(host.querySelector('[role="timer"]')?.textContent).toContain("1d");
    expect(host.textContent).not.toContain("No live streams yet");
    await act(() => tab("Chat").click());
    expect(host.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.disabled).toBe(true);
    await act(() => tab("Questions").click());
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
  });

  it("refreshes stream configuration when the waiting room reaches its first session", async () => {
    waiting = true;
    vi.setSystemTime(new Date("2027-01-20T08:59:00.000Z"));
    await open();
    expect(player()).toBeNull();
    waiting = false;
    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });
    for (let round = 0; round < 5; round += 1)
      await act(async () => {
        await Promise.resolve();
      });
    expect(player()?.getAttribute("src")).toContain(HALL_STREAM);
  });

  it("shows the refusal and no player to a reader who may not watch", async () => {
    streamStatus = 403;
    await open();
    expect(player()).toBeNull();
    expect(host.textContent).toContain("A registration is required.");
  });
});

describe("watch live entry", () => {
  const live = (liveStreamRoomId: string | null, id: string, title: string) =>
    personalAgendaSessionSchema.parse({
      id,
      publishedRevision: 4,
      title,
      liveStreamRoomId,
      rooms: [{ id: HALL, name: "Main hall" }],
      timeZone: "UTC",
      startAt: "2027-01-20T09:00:00.000Z",
      endAt: "2027-01-20T10:00:00.000Z",
      admissionPolicy: "preference",
      status: null,
      attendanceMode: null,
    });

  it("sends a virtual attendee into the streaming location's room for the running session", async () => {
    const sessions = [live(null, WORKSHOP, "Unstreamed lab"), live(HALL, KEYNOTE, "Opening keynote")];
    await act(async () => {
      render(<WatchLiveCard slug="summit" live={sessions} />, host);
    });
    expect(host.querySelector("h3")?.textContent).toBe("Opening keynote");
    const watch = [...host.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent === "Watch live");
    expect(watch?.getAttribute("href")).toBe(`#/events/summit/virtual?room=${HALL}&session=${KEYNOTE}`);
  });

  it("is absent while nothing running is streamed", async () => {
    await act(async () => {
      render(<WatchLiveCard slug="summit" live={[live(null, WORKSHOP, "Unstreamed lab")]} />, host);
    });
    expect(host.textContent).toBe("");
  });
});
