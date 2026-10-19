// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  liveRoomClientMessageSchema,
  liveStageSchema,
  type LiveRoomClientMessage,
} from "../../assets/shared/schemas/live-session-room";
import { LivePanelistsOverlay } from "../../assets/ts/live-session/LivePanelistsOverlay";
import { LivePanelistControls } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LivePanelistControls";
import { liveSnapshot, liveTargets } from "./helpers/live-room-socket";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
let host: HTMLElement | undefined;
afterEach(async () => {
  if (host) {
    await act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
});
it.each(["panel", "list", "columns"] as const)(
  "renders six approved panelists in the original %s view",
  async (layout) => {
    const session = liveSnapshot().session;
    const credit = session.credits[0]!;
    session.credits = Array.from({ length: 6 }, (_, index) => ({
      ...credit,
      key: `speaker:${index}`,
      name: `Approved Speaker ${index}`,
      moderator: index === 0,
      photoUrl: index === 0 ? "/approved.webp" : null,
      title: "Approved Chair · Frozen Organization",
    }));
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<LivePanelistsOverlay session={session} panelists={{ layout }} />, host!));
    expect(host.querySelector("[data-layout]")?.getAttribute("data-layout")).toBe(layout);
    expect(host.textContent).toContain(session.title);
    expect(host.querySelectorAll(".pk-live-panelists__speaker")).toHaveLength(6);
    expect(host.querySelectorAll(".pk-live-panelists__moderator")).toHaveLength(1);
    expect(host.querySelectorAll(".pk-live-panelists__title")).toHaveLength(6);
    expect(host.querySelectorAll(".pk-live-panelists__headshot img")).toHaveLength(1);
    expect(host.querySelectorAll(".pk-avatar__initials")).toHaveLength(5);
    await act(() => render(<LivePanelistsOverlay session={session} panelists={null} />, host!));
    expect(host.textContent).toBe("");
  },
);
it("routes panelist preview and program independently and preserves canonical atomic state", async () => {
  const state = applyLiveRoomMessage(null, liveSnapshot());
  if (!state) throw new Error("Missing fixture");
  const stage = state.stage;
  const programStage = liveStageSchema.parse({ ...stage, panelists: { layout: "panel" } });
  const sendProgram = vi.fn((_message: LiveRoomClientMessage) => true);
  host = document.body.appendChild(document.createElement("div"));
  await act(() =>
    render(
      <LivePanelistControls
        targets={liveTargets(
          { ...state, stage: programStage, preview: { ...state.preview, panelists: { layout: "panel" } } },
          { programActive: false, sendProgram },
        )}
      />,
      host!,
    ),
  );
  host.querySelector<HTMLButtonElement>('button[aria-label="Show panelists in preview"]')!.click();
  host.querySelector<HTMLButtonElement>('button[aria-label="Show panelists on air"]')!.click();
  expect(sendProgram.mock.calls.map(([message]) => liveRoomClientMessageSchema.parse(message))).toEqual([
    { type: "preview.set", composition: { panelists: null } },
    { type: "stage.panelists", panelists: { layout: "panel" } },
  ]);
  expect(
    liveRoomClientMessageSchema.safeParse({
      type: "stage.set",
      questionId: null,
      creditKey: null,
      pollId: null,
      pollPresentation: { chart: "bar" },
      ticker: null,
    }).success,
  ).toBe(false);
  expect(
    liveRoomClientMessageSchema.safeParse({
      type: "stage.set",
      questionId: null,
      creditKey: null,
      pollId: null,
      pollPresentation: { chart: "bar" },
      ticker: null,
      panelists: { layout: "columns" },
    }).success,
  ).toBe(true);
});
