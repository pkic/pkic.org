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
import { FakeLiveSocket, liveLocationChatSnapshot, liveSnapshot } from "./helpers/live-room-socket";

const hashLocation = vi.hoisted(() => ({ current: "/events/summit/virtual", navigate: vi.fn() }));
vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => [hashLocation.current, hashLocation.navigate],
}));

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
  productionPartners: [
    {
      role: "Camera Technology Provider",
      organizationId: "30000000-0000-4000-8000-000000000001",
      name: "Northlight",
      website: "https://northlight.example.test/",
      logoUrl: "/api/v1/members/30000000-0000-4000-8000-000000000001/logo?v=1",
    },
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
/** The session the studio has loaded in the main hall. */
let loadedInHall: string | null = null;

/** The browser's own zone, an hour ahead of the agenda's, whatever zone the machine running the tests is in. */
const VIEWER_ZONE = "Europe/Amsterdam";
const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

beforeEach(() => {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...resolvedOptions.call(this), timeZone: VIEWER_ZONE };
  });
  window.history.replaceState(null, "", "/portal/#/events/summit/virtual");
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2027-01-20T09:30:00.000Z"));
  hashLocation.current = "/events/summit/virtual";
  hashLocation.navigate.mockClear();
  streamStatus = 200;
  waiting = false;
  loadedInHall = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), location.origin).pathname;
      if (path.endsWith("/agenda/streams"))
        return streamStatus === 200
          ? Response.json(
              waiting
                ? { ...streams, locations: [] }
                : {
                    ...streams,
                    locations: streams.locations.map((location) =>
                      location.id === HALL ? { ...location, loadedOccurrenceId: loadedInHall } : location,
                    ),
                  },
            )
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
  vi.mocked(Intl.DateTimeFormat.prototype.resolvedOptions).mockRestore();
});

async function open(away = false) {
  await act(async () => {
    render(
      <HeadingOutline titleLevel={1}>
        <VirtualRoom
          slug="summit"
          away={away}
          agenda={(read) => <p>The event’s whole agenda, {read.data?.agenda?.occurrences.length} sessions</p>}
        />
      </HeadingOutline>,
      host,
    );
  });
  for (let round = 0; round < 5; round += 1)
    await act(async () => {
      await Promise.resolve();
    });
}

/** A desktop's width; without it the room lays itself out for a phone, as jsdom has no screen. */
function onDesktop() {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: true,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

/** The rooms the virtual room connects to, and a way to answer as the latest one would. */
function fakeRoomSockets() {
  const sockets: FakeLiveSocket[] = [];
  vi.stubGlobal(
    "WebSocket",
    class extends FakeLiveSocket {
      static OPEN = 1;
      constructor(url: string, protocols: string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    },
  );
  // A session's room and the location's chat speak on sockets of their own.
  const rooms = () => sockets.filter((socket) => socket.url.includes("/occurrences/"));
  const chats = () => sockets.filter((socket) => socket.url.endsWith("/live/chat"));
  const roomOn = () => new URL(rooms().at(-1)!.url).pathname.split("/").at(-2);
  const answer = async (opening: "scheduled" | "open" | "closed") => {
    const id = roomOn()!;
    const session = program.agenda!.occurrences.find((item) => item.id === id)!;
    await act(async () => {
      rooms().at(-1)!.open();
      rooms()
        .at(-1)!
        .deliver(
          liveSnapshot({
            opening,
            session: { ...liveSnapshot().session, occurrenceId: id, startAt: session.startAt!, endAt: session.endAt! },
          }),
        );
    });
  };
  /** The main hall's chat answers for its day: the keynote, then the panel. */
  const answerChat = async (opening: "scheduled" | "open" | "closed") => {
    const sessions = program.agenda!.occurrences.filter((item) => item.roomId === HALL);
    await act(async () => {
      chats().at(-1)!.open();
      chats()
        .at(-1)!
        .deliver(
          liveLocationChatSnapshot({
            opening,
            scope: {
              eventName: "Summit",
              roomId: HALL,
              day: "2027-01-20",
              timeZone: "UTC",
              sessions: sessions.map((item) => ({
                occurrenceId: item.id,
                title: item.title,
                startAt: item.startAt!,
                endAt: item.endAt!,
              })),
            },
          }),
        );
    });
  };
  return { sockets, rooms, chats, roomOn, answer, answerChat };
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

  it("shows one panel at a time on a phone, with the stream and the sponsors always above it", async () => {
    await open();
    expect(tabs().map((item) => item.textContent)).toEqual(["Questions", "Chat", "Agenda"]);
    // A session is running in the fixture, so the room opens on its questions.
    expect(tab("Questions").getAttribute("aria-selected")).toBe("true");
    // The sponsors sit under the stream, outside the panel: nobody has to look for them.
    const logo = host.querySelector<HTMLAnchorElement>('section[aria-label="Sponsors"] a');
    expect(logo?.getAttribute("href")).toBe("https://trust.example.test/");
    expect(logo?.getAttribute("target")).toBe("_blank");
    expect(logo?.getAttribute("title")).toBe("Example Trust, Gold sponsor");
    expect(logo?.closest('[role="tabpanel"]')).toBeNull();
    // The player comes before the panel, so a phone shows it first and keeps it above.
    const order = [...host.querySelectorAll('iframe, [role="tabpanel"]')].map((node) => node.tagName);
    expect(order).toEqual(["IFRAME", "DIV"]);
    // A session is running in the fixture, so the panel joins its live questions rather than waiting.
    const panel = host.querySelector('[role="tabpanel"]');
    expect(panel?.getAttribute("aria-labelledby")).toBe("virtual-room-tab-questions");
    expect(panel?.textContent).not.toContain("Questions open when the session is live");
    expect(panel?.textContent).toContain("Joining the session’s questions");
    expect(host.querySelector('[aria-label="Sessions in this room"]')).toBeNull();
  });

  it("gives a phone a bottom bar of its own that switches the panel in place and leads back to the event", async () => {
    await open();
    const bar = [...host.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Virtual room"] a')];
    expect(bar.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Questions", "#/events/summit/virtual"],
      ["Chat", "#/events/summit/virtual?roomPanel=chat"],
      ["Agenda", "#/events/summit/virtual?roomPanel=agenda"],
      ["Event", "#/events/summit"],
    ]);
    expect(bar[0]?.getAttribute("aria-current")).toBe("page");
    await act(async () => bar[2]!.click());
    expect(location.hash).toContain("roomPanel=agenda");
    // The Agenda tab holds the event's own agenda, with the production partners credited at its foot.
    const panel = host.querySelector('[role="tabpanel"]');
    // It is handed the program the room read, and asks the server for nothing itself.
    expect(panel?.textContent).toContain("The event’s whole agenda, 3 sessions");
    // Once opened it stays in the page behind the other panels, so coming back to it is instant.
    await act(async () => bar[1]!.click());
    expect(host.querySelector<HTMLElement>("#virtual-room-agenda")?.hidden).toBe(true);
    expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.id).toBe("virtual-room-chat");
    await act(async () => bar[2]!.click());
    const partner = panel?.querySelector('section[aria-label="Production partners"] li');
    expect(partner?.firstElementChild?.textContent).toBe("Camera Technology Provider");
    expect(partner?.querySelector("img")?.getAttribute("alt")).toBe("Northlight");
    expect(partner?.querySelector("a")?.getAttribute("href")).toBe("https://northlight.example.test/");
    expect(host.querySelector('section[aria-label="Sponsors"]')?.textContent).not.toContain("Camera");
    // The stream keeps playing above whichever panel is open.
    expect(player()).not.toBeNull();
  });

  it("keeps questions and chat both open beside the stream on a desktop, with the agenda under it", async () => {
    onDesktop();
    await open();
    expect(tabs()).toEqual([]);
    expect(host.querySelector('nav[aria-label="Virtual room"]')).toBeNull();
    const panels = [...host.querySelectorAll(".pk-virtual-room__side .pk-panel__title")].map(
      (title) => title.textContent,
    );
    expect(panels).toEqual(["Questions and polls", "Chat"]);
    // Asking is in the questions' header, where it never scrolls away.
    const ask = [...host.querySelectorAll("button")].find((button) => button.textContent === "Ask a question");
    expect(ask?.closest(".pk-panel__header")?.textContent).toContain("Questions and polls");
    // The event's own agenda sits under the stream, handed the program the room read.
    const main = host.querySelector(".pk-virtual-room__main")!;
    expect(main.textContent).toContain("The event’s whole agenda, 3 sessions");
    expect(host.querySelector('[aria-label="Sessions in this room"]')).toBeNull();
    expect(
      host.querySelector('section[aria-label="Production partners"]')?.closest(".pk-virtual-room__main"),
    ).not.toBeNull();
  });

  it("holds one connection for the session and one for the location's chat, however many parts are on screen", async () => {
    const opened: string[] = [];
    vi.stubGlobal(
      "WebSocket",
      class {
        static OPEN = 1;
        readyState = 0;
        constructor(url: string) {
          opened.push(new URL(url).pathname);
        }
        addEventListener() {}
        close() {}
        send() {}
      },
    );
    onDesktop();
    await open();
    // Reactions, questions and chat are all on screen beside the stream.
    expect(host.querySelectorAll(".pk-virtual-room__side .pk-panel")).toHaveLength(2);
    expect(opened.sort()).toEqual([
      `/api/v1/events/summit/agenda/occurrences/${KEYNOTE}/live`,
      `/api/v1/events/summit/agenda/rooms/${HALL}/live/chat`,
    ]);
  });

  it("moves on to the next session at the boundary without asking the server", async () => {
    await open();
    expect(nowPlaying()).toContain("Opening keynote");
    const requests = vi.mocked(fetch).mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(31 * 60_000);
    });
    expect(nowPlaying()).toContain("Migration panel");
    expect(vi.mocked(fetch).mock.calls.length).toBe(requests);
  });

  it("follows the session loaded in the studio past its end, until the studio loads the next one", async () => {
    const { rooms, chats, roomOn, answer, answerChat } = fakeRoomSockets();
    // The keynote runs over: the agenda has the panel on, the studio still the keynote.
    loadedInHall = KEYNOTE;
    vi.setSystemTime(new Date("2027-01-20T10:22:00.000Z"));
    onDesktop();
    await open();
    await answer("scheduled");
    await answerChat("scheduled");
    expect(nowPlaying()).toContain("Opening keynote");
    expect(roomOn()).toBe(KEYNOTE);
    // Its room closes half an hour after its scheduled end, in the viewer's zone an hour ahead of the agenda's.
    expect(host.textContent).toContain("Questions for this session close at 11:30");
    expect(host.textContent).not.toContain("Chat closes");

    // The studio loads the panel: the room goes with it.
    await act(async () =>
      rooms()
        .at(-1)!
        .deliver({ type: "room.moved.changed", movedOn: { occurrenceId: PANEL } }),
    );
    expect(nowPlaying()).toContain("Migration panel");
    expect(roomOn()).toBe(PANEL);
    await answer("closed");
    expect(host.textContent).toContain("The organizers closed questions.");
    // The location's chat carries on through the change, on the same connection, until an operator ends it.
    expect(chats()).toHaveLength(1);
    expect(host.querySelector<HTMLTextAreaElement>(".pk-live-chat-workspace textarea")?.disabled).toBe(false);
    await answerChat("closed");
    expect(host.textContent).toContain("The organizers ended this chat.");
  });

  it("moves on at the scheduled end when the studio has nothing loaded, and says when", async () => {
    const { answer } = fakeRoomSockets();
    vi.setSystemTime(new Date("2027-01-20T09:52:00.000Z"));
    onDesktop();
    await open();
    await answer("scheduled");
    expect(nowPlaying()).toContain("Opening keynote");
    expect(host.textContent).toContain("Questions for this session close at 11:00");
  });

  it("says when the location's chat closes, half an hour after its last session", async () => {
    const { answerChat } = fakeRoomSockets();
    vi.setSystemTime(new Date("2027-01-20T11:22:00.000Z"));
    onDesktop();
    await open();
    await answerChat("scheduled");
    expect(host.textContent).toContain("Chat closes at 12:30.");
  });

  it("restores the bookmarked room panel without putting attendee input in the URL", async () => {
    window.history.replaceState(null, "", "/portal/#/events/summit/virtual?roomPanel=chat");
    await open();
    expect(tab("Chat").getAttribute("aria-selected")).toBe("true");
    expect(location.hash).toContain("roomPanel=chat");
    expect(host.querySelector('section[aria-labelledby="virtual-room-tab-questions"]')).toBeNull();
  });

  it("switches location through its own address and opens on the session that brought the reader", async () => {
    await open();
    // A phone picks the location on the running session's line.
    const picker = host.querySelector<HTMLSelectElement>('select[aria-label="Location"]')!;
    expect([...picker.options].map((option) => option.textContent)).toEqual(["Main hall", "Studio"]);
    picker.value = STUDIO;
    await act(async () => {
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(hashLocation.navigate).toHaveBeenCalledWith(`/events/summit/virtual?room=${STUDIO}`);
    render(null, host);
    onDesktop();
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

  it("stays connected while the attendee is elsewhere in the event, and comes back where they left", async () => {
    const { sockets } = fakeRoomSockets();
    onDesktop();
    hashLocation.current = `/events/summit/virtual?session=${WORKSHOP}`;
    await open();
    expect(player()?.getAttribute("src")).toContain(STUDIO_STREAM);
    const joined = sockets.length;
    // On the event's agenda the room plays nothing and keeps its connections.
    hashLocation.current = "/events/summit/agenda";
    await open(true);
    expect(player()).toBeNull();
    expect(sockets).toHaveLength(joined);
    expect(sockets.every((socket) => socket.readyState !== 3)).toBe(true);
    // The room's tab carries no location; it opens on the one the attendee left, on the same connections.
    hashLocation.current = "/events/summit/virtual";
    await open();
    expect(player()?.getAttribute("src")).toContain(STUDIO_STREAM);
    expect(sockets).toHaveLength(joined);
  });

  it("follows a moved session instead of the room saved in its bookmarked link", async () => {
    hashLocation.current = `/events/summit/virtual?room=${HALL}&session=${WORKSHOP}`;
    await open();
    expect(player()?.getAttribute("src")).toContain(STUDIO_STREAM);
    expect(nowPlaying()).toContain("Hands-on lab");
    expect(host.querySelector(".pk-alert")).toBeNull();
  });

  it("preserves a requested additional room that still carries the session", () => {
    const agenda = {
      occurrences: [{ ...program.agenda!.occurrences[0]!, additionalRoomIds: [STUDIO] }],
    };
    expect(chooseLocation(streams.locations, agenda, { room: STUDIO, session: KEYNOTE })).toBe(STUDIO);
    expect(chooseLocation(streams.locations, agenda, { room: HALL, session: KEYNOTE })).toBe(HALL);
    expect(chooseLocation([], agenda, { room: HALL, session: KEYNOTE })).toBeNull();
  });

  it("opens the first stream when its join window opens", async () => {
    vi.setSystemTime(new Date("2027-01-20T08:44:00.000Z"));
    await open();
    expect(player()).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(59_999);
    });
    expect(player()).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(251);
    });
    expect(player()?.getAttribute("src")).toContain(HALL_STREAM);
    expect(nowPlaying()).toContain("Up next");
  });

  it("says a linked session has ended, or when it starts, above what the room is showing now", async () => {
    vi.setSystemTime(new Date("2027-01-20T10:30:00.000Z"));
    hashLocation.current = `/events/summit/virtual?room=${HALL}&session=${KEYNOTE}`;
    await open();
    expect(host.querySelector(".pk-alert")?.textContent).toContain("Opening keynote has ended");
    expect(nowPlaying()).toContain("Migration panel");
    render(null, host);

    vi.setSystemTime(new Date("2027-01-20T09:30:00.000Z"));
    hashLocation.current = `/events/summit/virtual?room=${HALL}&session=${PANEL}`;
    await open();
    expect(host.querySelector(".pk-alert")?.textContent).toContain("Migration panel starts");
    expect(host.querySelector(".pk-alert")?.textContent).toContain("Main hall");
    render(null, host);

    hashLocation.current = `/events/summit/virtual?room=${HALL}&session=${KEYNOTE}`;
    await open();
    expect(host.querySelector(".pk-alert")).toBeNull();
  });

  it("opens a planned room before a stream is configured, counts down, and says when the chat opens", async () => {
    const { answerChat } = fakeRoomSockets();
    waiting = true;
    vi.setSystemTime(new Date("2027-01-19T09:00:00.000Z"));
    await open();
    expect(player()).toBeNull();
    expect(host.querySelector('[role="timer"]')?.textContent).toContain("1d");
    expect(host.textContent).not.toContain("No live streams yet");
    // The room opens on the next session's questions, which take questions ahead; the chat waits for it to go live.
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("virtual-room-tab-questions");
    expect(host.textContent).toContain("Joining the session’s questions");
    await answerChat("scheduled");
    await act(() => tab("Chat").click());
    // A quarter of an hour before the keynote, on the viewer's clock an hour ahead, the next day.
    expect(host.textContent).toContain("Chat opens Wed, Jan 20 at 09:45.");
    expect(host.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.disabled).toBe(true);
  });

  it("refreshes stream configuration when the first join window opens", async () => {
    waiting = true;
    vi.setSystemTime(new Date("2027-01-20T08:44:00.000Z"));
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
