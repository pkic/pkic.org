// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualRoom } from "../../assets/ts/member-flows/portal/sections/events/app/virtual-room/VirtualRoom";
import { chooseLocation } from "../../assets/ts/member-flows/portal/sections/events/app/virtual-room/virtual-room-schedule";
import { HeadingOutline } from "../../assets/ts/ui/HeadingOutline";
import {
  HALL,
  STUDIO,
  BREAKOUT,
  ROUNDTABLE,
  KEYNOTE,
  PANEL,
  WORKSHOP,
  HALL_STREAM,
  STUDIO_STREAM,
  occurrence,
  program,
  streams,
  sponsors,
  onDesktop,
  fakeRoomSockets,
} from "./virtual-room-fixture";

const hashLocation = vi.hoisted(() => ({ current: "/events/summit/virtual", navigate: vi.fn() }));
vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => [hashLocation.current, hashLocation.navigate],
}));

let host: HTMLDivElement;
let streamStatus = 200;
let waiting = false;
/** The session the studio has loaded in the main hall. */
let loadedInHall: string | null = null;
/** A third location, held in the room only: it has a session and a recording plan, and no stream. */
let roomOnly = false;

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
  roomOnly = false;
  // The room's tour opens by itself on a device's first visit; these tests start on a later one.
  localStorage.setItem("virtual-room-tour-seen", "yes");
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
            : roomOnly
              ? {
                  ...program,
                  agenda: {
                    ...program.agenda,
                    rooms: [
                      ...program.agenda!.rooms,
                      { id: BREAKOUT, name: "Breakout", capacity: null, equipment: ["recording"] },
                    ],
                    occurrences: [
                      ...program.agenda!.occurrences,
                      occurrence(
                        ROUNDTABLE,
                        "Roundtable",
                        BREAKOUT,
                        "2027-01-20T09:00:00.000Z",
                        "2027-01-20T10:00:00.000Z",
                        "Hedy",
                      ),
                    ],
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
    // A dot marks the running session; its people sit as portraits at the end of the time line.
    expect(host.querySelector(".pk-virtual-room__live-dot")).not.toBeNull();
    expect(nowPlaying()).toContain("Live now");
    const face = host.querySelector<HTMLButtonElement>('[role="group"][aria-label="Speakers"] button');
    expect(face?.getAttribute("aria-label")).toBe("Ada");
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
    // Asking sits at the foot of the questions, where the chat keeps its message field.
    const ask = [...host.querySelectorAll("button")].find((button) => button.textContent === "Ask a question");
    expect(ask?.closest(".pk-virtual-room__ask")).not.toBeNull();
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

  it("shows a session the studio loaded days early as up next, not live, after the ones before it", async () => {
    loadedInHall = PANEL;
    vi.setSystemTime(new Date("2027-01-12T09:30:00.000Z"));
    onDesktop();
    await open();
    expect(nowPlaying()).toContain("Up next");
    expect(nowPlaying()).toContain("Opening keynote");
    expect(nowPlaying()).not.toContain("Live now");
    expect(host.querySelector(".pk-virtual-room__live-dot")).toBeNull();
    // Another day already shows its date: no countdown.
    expect(nowPlaying()).not.toContain(" min");
  });

  it("counts down to the next session later the same day", async () => {
    vi.setSystemTime(new Date("2027-01-20T08:48:00.000Z"));
    onDesktop();
    await open();
    expect(nowPlaying()).toContain("Up next");
    expect(nowPlaying()).toContain("in 12 min");
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
    const locationLinks = () =>
      [...host.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Locations"] a')].map((link) => [
        link.textContent,
        link.getAttribute("href"),
      ]);
    const expected = [
      ["Main hall", `#/events/summit/virtual?room=${HALL}`],
      ["Studio", `#/events/summit/virtual?room=${STUDIO}`],
    ];
    // A phone and a desktop switch location through the same tabs.
    await open();
    expect(locationLinks()).toEqual(expected);
    render(null, host);
    onDesktop();
    await open();
    expect(locationLinks()).toEqual(expected);
    render(null, host);
    hashLocation.current = `/events/summit/virtual?session=${WORKSHOP}`;
    await open();
    expect(player()?.getAttribute("src")).toContain(STUDIO_STREAM);
    expect(nowPlaying()).toContain("Hands-on lab");
    expect(chooseLocation(streams.locations, program.agenda, { room: "unknown", session: null })).toBe(HALL);
  });

  it("opens its tour by itself on the first visit only, and again from the help button", async () => {
    localStorage.removeItem("virtual-room-tour-seen");
    onDesktop();
    // While the attendee is elsewhere in the event, the hidden room waits with its tour.
    await open(true);
    expect(document.querySelector(".pk-guided-tour")).toBeNull();
    await open();
    expect(document.querySelector(".pk-guided-tour")?.textContent).toContain("Choose a location");
    expect(localStorage.getItem("virtual-room-tour-seen")).toBe("yes");
    render(null, host);
    await open();
    expect(document.querySelector(".pk-guided-tour")).toBeNull();
    const help = host.querySelector<HTMLButtonElement>('button[aria-label="Room tour"]')!;
    await act(async () => help.click());
    expect(document.querySelector(".pk-guided-tour")?.textContent).toContain("Choose a location");
    await act(async () => help.click());
    expect(document.querySelector(".pk-guided-tour")).toBeNull();
  });

  it("offers questions and chat in a location that is not streamed, with its plan and no player", async () => {
    roomOnly = true;
    onDesktop();
    await open();
    const locations = [...host.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Locations"] a')];
    expect(locations.map((link) => link.textContent)).toEqual(["Main hall", "Studio", "Breakout"]);
    expect(locations[2]!.getAttribute("title")).toBe("Breakout\nNot streamed: questions and chat only.");
    expect(locations[0]!.getAttribute("title")).toBeNull();
    render(null, host);
    hashLocation.current = `/events/summit/virtual?session=${ROUNDTABLE}`;
    await open();
    expect(player()).toBeNull();
    expect(host.textContent).toContain("Breakout · Not streamed · Recording planned");
    expect(host.textContent).toContain("Ask questions and chat here during its sessions");
    expect(nowPlaying()).toContain("Roundtable");
    const panels = [...host.querySelectorAll(".pk-virtual-room__side .pk-panel__title")].map(
      (title) => title.textContent,
    );
    expect(panels).toEqual(["Questions and polls", "Chat"]);
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
