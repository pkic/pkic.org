import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventLiveControlRoom } from "../../assets/ts/member-flows/portal/sections/events/detail/live/EventLiveControlRoom";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { approvedAgendaSnapshot } from "../fixtures/approved-agenda";
const fixture = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("../../assets/ts/hooks/useData", () => ({
  useData: () => ({ data: fixture.data, loading: false, error: null, reload: async () => {} }),
}));
const hosts: HTMLElement[] = [];
function mount(id: string) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() =>
    render(
      <EventLiveControlRoom
        slug="pqc"
        occurrenceId={id}
        sessionPath={(next) => `/events/pqc/live/${next}`}
        renderSession={(next) => <p>Desk {next}</p>}
      />,
      host,
    ),
  );
  return host;
}
beforeEach(() => {
  fixture.data = {
    agenda: agendaSnapshotSchema.parse({
      ...approvedAgendaSnapshot,
      rooms: [
        { id: "hall", name: "Main hall", capacity: 100 },
        { id: "annex", name: "Annex", capacity: 40 },
      ],
      occurrences: [
        {
          id: "opening",
          title: "Opening",
          startAt: "2026-12-01T09:00:00.000Z",
          endAt: "2026-12-01T10:00:00.000Z",
          roomId: "hall",
          speakers: [],
        },
        {
          id: "break",
          title: "Lunch",
          kind: "break",
          startAt: "2026-12-01T10:00:00.000Z",
          endAt: "2026-12-01T11:00:00.000Z",
          roomId: "hall",
          speakers: [],
        },
        {
          id: "talk",
          title: "Talk",
          startAt: "2026-12-01T11:00:00.000Z",
          endAt: "2026-12-01T12:00:00.000Z",
          roomId: "hall",
          speakers: [],
        },
        {
          id: "workshop",
          title: "Workshop",
          startAt: "2026-12-01T11:00:00.000Z",
          endAt: "2026-12-01T12:00:00.000Z",
          roomId: "annex",
          speakers: [],
        },
      ],
    }),
  };
  history.replaceState(null, "", "/?campaign=event#/events/pqc/live/opening?room=hall&studioSplit=45&chat=operator");
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
  vi.restoreAllMocks();
  history.replaceState(null, "", "#/");
});
it("keeps selectors behind the room button and navigates adjacent real sessions while preserving display preferences", () => {
  const host = mount("opening");
  expect(host.querySelector("select")).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Previous session"]')?.disabled).toBe(true);
  void act(() => host.querySelector<HTMLButtonElement>('[aria-label="Next session"]')!.click());
  expect(location.hash).toContain("/live/talk?");
  expect(location.hash).toContain("studioSplit=45");
  expect(location.hash).toContain("chat=operator");
  expect(location.search).toBe("?campaign=event");
  expect(host.querySelector('[title="Choose room and session"]')?.textContent).toContain("Main hall");
  void act(() =>
    render(
      <EventLiveControlRoom
        slug="pqc"
        occurrenceId="talk"
        sessionPath={(id) => `/events/pqc/live/${id}`}
        renderSession={() => "Desk"}
      />,
      host,
    ),
  );
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Next session"]')?.disabled).toBe(true);
});
it("goes back to the session the agenda has now in the room, and stays put until asked", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T11:30:00.000Z"));
  try {
    const host = mount("opening");
    // Browsing an earlier session never moves on by itself.
    expect(location.hash).toContain("/live/opening?");
    const now = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Now")!;
    expect(now.disabled).toBe(false);
    void act(() => now.click());
    expect(location.hash).toContain("/live/talk?");
  } finally {
    vi.useRealTimers();
  }
});
it("changing room/session is a draft until the shared dialog confirms it", async () => {
  const host = mount("opening");
  await act(async () => host.querySelector<HTMLButtonElement>('[title="Choose room and session"]')!.click());
  const room = host.querySelector<HTMLSelectElement>("dialog select")!;
  await act(async () => {
    room.value = "annex";
    room.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(location.hash).toContain("/live/opening");
  const confirm = [...host.querySelectorAll<HTMLButtonElement>("dialog button")].find(
    (button) => button.textContent === "Open session",
  )!;
  await act(async () => confirm.click());
  expect(location.hash).toContain("/live/workshop?");
  expect(location.hash).toContain("room=annex");
  expect(location.hash).toContain("studioSplit=45");
});
