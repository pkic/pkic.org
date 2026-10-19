// @vitest-environment jsdom
import { useSyncExternalStore } from "preact/compat";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SelectedSessionDesk } from "../../assets/ts/member-flows/portal/sections/events/detail/live/EventLiveControlRoom";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import { liveSnapshot, liveQuestion, LIVE_OCCURRENCE } from "./helpers/live-room-socket";
const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  send: vi.fn(),
  order: [] as string[],
  activeId: "20000000-0000-4000-8000-000000000099",
}));
vi.mock("../../assets/ts/live-session/useLiveRoomProgram", () => ({
  useLiveRoomProgram: () => {
    const activeId = useSyncExternalStore(
      (changed) => {
        window.addEventListener("test-program-ack", changed);
        return () => window.removeEventListener("test-program-ack", changed);
      },
      () => mocks.activeId,
    );
    return {
      selection: { roomId: "hall", occurrenceId: activeId, revision: 1 },
      status: "live",
      error: null,
      select: mocks.select,
    };
  },
}));
const state = applyLiveRoomMessage(null, liveSnapshot({ viewer: { role: "operator", name: "Operator" } }));
vi.mock("../../assets/ts/live-session/useLiveRoom", () => ({
  useLiveRoom: () => ({ state, status: "live", admissionRefusal: null, send: mocks.send }),
}));
let host: HTMLElement;
beforeEach(() => {
  mocks.order.length = 0;
  mocks.activeId = "20000000-0000-4000-8000-000000000099";
  if (state) {
    state.stage.lowerThird = null;
    state.questions = [];
  }
  mocks.select.mockReset().mockImplementation(async () => {
    mocks.order.push("activation");
  });
  mocks.send.mockReset().mockImplementation(() => {
    mocks.order.push("command");
    return true;
  });
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
});
async function mount() {
  await act(() => render(<SelectedSessionDesk slug="conference" occurrenceId={LIVE_OCCURRENCE} roomId="hall" />, host));
}
it("activates the selected session before a single Program click", async () => {
  await mount();
  expect(mocks.select).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Show Sam Speaker on air"]')!.click());
  expect(mocks.order).toEqual(["activation", "command"]);
  expect(mocks.select).toHaveBeenCalledWith(LIVE_OCCURRENCE);
  expect(mocks.send).toHaveBeenCalledWith({ type: "stage.lowerThird", creditKey: "user:speaker", motion: "animated" });
});
it("shows activation refusal and never sends a stage command", async () => {
  mocks.select.mockRejectedValue(new Error("Another operator changed the active session."));
  await mount();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Show Sam Speaker on air"]')!.click());
  expect(mocks.send).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Another operator changed");
});
it("makes the browsed session active without sending anything to Program", async () => {
  await mount();
  const make = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Load session",
  )!;
  expect(make.title).toBe(
    "Load this session into the studio and Preview. Program does not change until you transition.",
  );
  await act(async () => make.click());
  expect(mocks.select).toHaveBeenCalledWith(LIVE_OCCURRENCE);
  expect(mocks.send).not.toHaveBeenCalled();
});
it("warns that the agenda moved on, offers to go there, and never switches by itself", async () => {
  const minute = 60_000;
  const at = (minutes: number) => new Date(Date.now() + minutes * minute).toISOString();
  const choice = (id: string, title: string, start: number, end: number) => ({
    id,
    roomId: "hall",
    roomIds: ["hall"],
    title,
    startsAt: at(start),
    endsAt: at(end),
    label: title,
  });
  const running = choice(mocks.activeId, "Overrunning keynote", -60, -3);
  const agenda = choice(LIVE_OCCURRENCE, "Hybrid certificates", -3, 27);
  const browse = vi.fn();
  await act(() =>
    render(
      <SelectedSessionDesk
        slug="conference"
        occurrenceId={mocks.activeId}
        roomId="hall"
        sessions={[running, agenda]}
        agendaSession={agenda}
        onBrowse={browse}
      />,
      host,
    ),
  );
  // The session bar's own status line says it; nothing is inserted above the panels.
  const warning = host.querySelector(".pk-studio-header__notice")!;
  expect(warning.textContent).toContain("Agenda moved on to “Hybrid certificates” 3 min ago");
  expect(host.querySelector(".pk-studio > .pk-alert")).toBeNull();
  expect(browse).not.toHaveBeenCalled();
  await act(() =>
    Array.from(warning.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Go to agenda session")!
      .click(),
  );
  expect(browse).toHaveBeenCalledWith(LIVE_OCCURRENCE);
  expect(mocks.select).not.toHaveBeenCalled();
});
it("moderates a question without changing the active program", async () => {
  if (state) state.questions = [liveQuestion({ status: "pending" })];
  await mount();
  const approve = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Approve",
  )!;
  await act(() => approve.click());
  expect(mocks.select).not.toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ type: "question.moderate" }));
});
it("does not mark an inactive stored lower third as live, then shows and hides it with one click each", async () => {
  if (!state) throw new Error("Missing fixture");
  state.stage.lowerThird = state.session.credits[0]!;
  await mount();
  const show = host.querySelector<HTMLButtonElement>('button[aria-label="Show Sam Speaker on air"]')!;
  expect(show.getAttribute("aria-pressed")).toBe("false");
  await act(async () => show.click());
  expect(mocks.send).toHaveBeenLastCalledWith({
    type: "stage.lowerThird",
    creditKey: "user:speaker",
    motion: "animated",
  });
  await act(() => {
    mocks.activeId = LIVE_OCCURRENCE;
    window.dispatchEvent(new Event("test-program-ack"));
  });
  const hide = host.querySelector<HTMLButtonElement>('button[aria-label="Show Sam Speaker on air"]')!;
  expect(hide.getAttribute("aria-pressed")).toBe("true");
  await act(async () => hide.click());
  expect(mocks.select).toHaveBeenCalledTimes(1);
  expect(mocks.send).toHaveBeenLastCalledWith({ type: "stage.lowerThird", creditKey: null, motion: "animated" });
});
