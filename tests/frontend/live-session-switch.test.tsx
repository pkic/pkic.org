// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { EventLiveControlRoom } from "../../assets/ts/member-flows/portal/sections/events/detail/live/EventLiveControlRoom";
import { approvedAgendaSnapshot } from "../fixtures/approved-agenda";
import { FakeLiveSocket, LIVE_OCCURRENCE, liveSnapshot } from "./helpers/live-room-socket";

const NEXT = "20000000-0000-4000-8000-000000000098";
const fixture = vi.hoisted(() => ({ data: null as unknown, programs: 0 }));
// The approved agenda answers; anything else the panels ask for stays loading, which this test has no use for.
vi.mock("../../assets/ts/shared/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/shared/api-client")>()),
  getJson: (url: string) =>
    url.endsWith("/agenda/participation/program") ? Promise.resolve(fixture.data) : new Promise(() => {}),
}));
vi.mock("../../assets/ts/live-session/useLiveRoomProgram", async () => {
  const { useEffect } = await import("preact/hooks");
  return {
    useLiveRoomProgram: () => {
      // Counts the room program's connections: a remounted desk would join the room again.
      useEffect(() => {
        fixture.programs += 1;
      }, []);
      return {
        selection: { roomId: "hall", occurrenceId: LIVE_OCCURRENCE, revision: 1 },
        status: "live",
        error: null,
        select: vi.fn(),
      };
    },
  };
});

const sockets: FakeLiveSocket[] = [];
class BrowserSocket extends FakeLiveSocket {
  static readonly OPEN = 1;
  constructor(url: string, protocols: string[]) {
    super(url, protocols);
    sockets.push(this);
  }
}
/** The first room socket the studio opened for this session; the Program feed of another opens after it. */
const roomOf = (occurrenceId: string) => sockets.filter((socket) => socket.url.includes(occurrenceId)).at(0)!;

const at = (hour: number) => `2026-12-01T${String(hour).padStart(2, "0")}:00:00.000Z`;
let host: HTMLElement;
beforeEach(() => {
  sockets.length = 0;
  fixture.programs = 0;
  vi.stubGlobal("WebSocket", BrowserSocket);
  fixture.data = {
    agenda: agendaSnapshotSchema.parse({
      ...approvedAgendaSnapshot,
      rooms: [{ id: "hall", name: "Main hall", capacity: 100 }],
      occurrences: [
        { id: LIVE_OCCURRENCE, title: "Opening", startAt: at(9), endAt: at(10), roomId: "hall", speakers: [] },
        { id: NEXT, title: "Next talk", startAt: at(10), endAt: at(11), roomId: "hall", speakers: [] },
      ],
    }),
  };
  history.replaceState(null, "", `/#/events/pqc/live/${LIVE_OCCURRENCE}?room=hall`);
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

async function mount(occurrenceId: string) {
  await act(async () => {
    render(
      <EventLiveControlRoom slug="pqc" occurrenceId={occurrenceId} sessionPath={(id) => `/events/pqc/live/${id}`} />,
      host,
    );
    // The approved agenda arrives.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // The studio's effects run after the next paint, which jsdom only reaches by timing out.
  await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
}
const notice = () => host.querySelector(".pk-studio-header__notice")?.textContent ?? "";

it("keeps the studio in place when moving to the next session, then shows it once its room answers", async () => {
  await mount(LIVE_OCCURRENCE);
  void act(() => {
    roomOf(LIVE_OCCURRENCE).open();
    roomOf(LIVE_OCCURRENCE).deliver(
      liveSnapshot({
        viewer: { role: "operator", name: "Olga Operator" },
        session: { ...liveSnapshot().session, title: "Opening" },
      }),
    );
  });
  const studio = host.querySelector(".pk-studio");
  expect(studio).not.toBeNull();
  expect(host.querySelector(".pk-studio-header")?.textContent).toContain("Opening");

  void act(() => host.querySelector<HTMLButtonElement>('[aria-label="Next session"]')!.click());
  expect(location.hash).toContain(`/live/${NEXT}?`);
  await mount(NEXT);
  // The same studio stays on screen with the last session's picture, its controls paused, never a blank page.
  expect(host.querySelector(".pk-studio")).toBe(studio);
  expect(host.textContent).not.toContain("Joining the live room");
  expect(notice()).toContain("Opening the session");
  expect(
    host.querySelector<HTMLButtonElement>('.pk-studio-transition button[aria-label="Transition to Program"]')!.disabled,
  ).toBe(true);
  expect(fixture.programs).toBe(1);

  void act(() => {
    roomOf(NEXT).open();
    roomOf(NEXT).deliver(
      liveSnapshot({
        viewer: { role: "operator", name: "Olga Operator" },
        session: { ...liveSnapshot().session, occurrenceId: NEXT, title: "Next talk" },
      }),
    );
  });
  expect(host.querySelector(".pk-studio")).toBe(studio);
  expect(host.querySelector(".pk-studio-header")?.textContent).toContain("Next talk");
  expect(notice()).not.toContain("Opening the session");
  expect(
    host.querySelector<HTMLButtonElement>('.pk-studio-transition button[aria-label="Transition to Program"]')!.disabled,
  ).toBe(false);
  expect(fixture.programs).toBe(1);
});
