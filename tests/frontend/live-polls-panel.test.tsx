import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { liveRoomClientMessageSchema, type LiveRoomClientMessage } from "../../assets/shared/schemas/live-session-room";
import {
  LivePollsCreateAction,
  LivePollsPanel,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/LivePollsPanel";
import { applyLiveRoomMessage, type LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import { liveSnapshot, livePoll, livePollResults, liveTargets } from "./helpers/live-room-socket";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
});

const DRAFT = "20000000-0000-4000-8000-000000000099";

function panel(state: LiveRoomState, send = vi.fn((_message: LiveRoomClientMessage) => true)) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  void act(() => render(<LivePollsPanel targets={liveTargets(state)} send={send} />, host));
  return {
    host,
    send,
    redraw: (next: LiveRoomState) =>
      act(() => render(<LivePollsPanel targets={liveTargets(next)} send={send} />, host)),
  };
}

function stateWith(polls: ReturnType<typeof livePoll>[]) {
  const state = applyLiveRoomMessage(null, liveSnapshot({ viewer: { role: "operator", name: "Olga" }, polls }));
  if (!state) throw new Error("Missing fixture");
  return state;
}

async function menu(row: Element): Promise<HTMLElement[]> {
  await act(async () => row.querySelector<HTMLButtonElement>('button[aria-label^="Poll actions"]')!.click());
  return [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')];
}

it("shows one compact row per poll with its state, answers and leading answer, outputs and menu, and no chart", async () => {
  const closed = livePoll({ status: "closed", results: livePollResults({ "Root CA": 3, "TLS endpoints": 1 }) });
  const { host, send } = panel(stateWith([closed, livePoll({ id: DRAFT, status: "draft" })]));
  const rows = [...host.querySelectorAll(".pk-live-polls__row")];
  expect(rows).toHaveLength(2);
  expect(host.querySelector(".pk-chart")).toBeNull();
  expect(rows[0].textContent).toContain("Closed");
  expect(rows[0].textContent).toContain("4 answers · Root CA · 75%");
  expect(rows[0].querySelector(".pk-live-polls__outputs button")).not.toBeNull();
  expect(rows[1].textContent).toContain("Prepared");
  const items = await menu(rows[0]);
  expect(items.map((item) => item.textContent?.trim())).toEqual(["Results and settings", "Reopen voting"]);
  await act(async () => items[1].click());
  expect(send.mock.calls.map(([message]) => liveRoomClientMessageSchema.parse(message))).toEqual([
    { type: "poll.status", pollId: closed.id, status: "open" },
  ]);
  const open = [...rows[1].querySelectorAll("button")].find((button) => button.textContent === "Open voting")!;
  await act(async () => open.click());
  expect(liveRoomClientMessageSchema.parse(send.mock.calls[1][0])).toEqual({
    type: "poll.status",
    pollId: DRAFT,
    status: "open",
  });
});

it("opens a new poll from the panel header's create button", async () => {
  const { host } = panel(stateWith([]));
  expect([...host.querySelectorAll("button")].some((button) => button.textContent === "New poll")).toBe(false);
  const header = document.createElement("div");
  document.body.append(header);
  hosts.push(header);
  const send = vi.fn((_message: LiveRoomClientMessage) => true);
  await act(async () => render(<LivePollsCreateAction disabled={false} send={send} />, header));
  const create = header.querySelector<HTMLButtonElement>("button[aria-label='New poll']")!;
  expect(create.getAttribute("title")).toBe("New poll");
  await act(async () => create.click());
  expect(document.querySelector("dialog[open]")?.textContent).toContain("New poll");
});

it("opens a poll in one dialog with live results, its editor and its chart, never a broadcast picture in the panel", async () => {
  const poll = livePoll({ status: "open", results: livePollResults({ "Root CA": 1 }) });
  const { host, send, redraw } = panel(stateWith([poll]));
  expect(host.querySelector(".pk-live-overlay")).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>(".pk-live-polls__open")!.click());
  const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]")!;
  const tabs = () => [
    ...dialog().querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="Poll"] [role="tab"]'),
  ];
  expect(tabs().map((tab) => tab.textContent)).toEqual(["Results", "Edit", "Settings"]);
  expect(dialog().classList.contains("pk-dialog--wide")).toBe(true);
  const results = () => dialog().querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
  expect(results().querySelector(".pk-chart__bars")).not.toBeNull();
  // The results follow the answers while the dialog is open.
  await redraw(stateWith([{ ...poll, results: livePollResults({ "Root CA": 1, "TLS endpoints": 2 }) }]));
  expect(results().textContent).toContain("3 answers");
  // Settings: the chart, which the results follow.
  await act(async () => tabs()[2]!.click());
  const chart = dialog().querySelector<HTMLSelectElement>("select[name='chart']")!;
  await act(async () => {
    chart.value = "pie";
    chart.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => tabs()[0]!.click());
  expect(results().querySelector(".adm-form-pie--solid")).not.toBeNull();
  // Edit: the confirm becomes Save poll and sends the corrected poll.
  await act(async () => tabs()[1]!.click());
  const confirm = () => [...dialog().querySelectorAll<HTMLButtonElement>(".pk-dialog__foot button")].at(-1)!;
  expect(confirm().textContent).toBe("Save poll");
  await act(async () => confirm().click());
  expect(send.mock.calls.map(([message]) => liveRoomClientMessageSchema.parse(message).type)).toEqual(["poll.save"]);
});
