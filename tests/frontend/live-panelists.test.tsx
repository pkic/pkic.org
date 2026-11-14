// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  liveRoomClientMessageSchema,
  liveStageSchema,
  type LiveRoomClientMessage,
} from "../../assets/shared/schemas/live-session-room";
import { LivePanelistsOverlay, livePanelistsArrangement } from "../../assets/ts/live-session/LivePanelistsOverlay";
import { liveBoardSize } from "../../assets/ts/live-session/LiveBoard";
import { LivePanelistControls } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LivePanelistControls";
import { liveSnapshot, liveTargets } from "./helpers/live-room-socket";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
/** The full-frame panelists box. */
const BOX = { width: 1728, height: 864 };
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
    await act(() => render(<LivePanelistsOverlay session={session} panelists={{ layout }} box={BOX} />, host!));
    expect(host.querySelector("[data-layout]")?.getAttribute("data-layout")).toBe(layout);
    // The moderator sits after the speakers, set apart from them.
    const speakers = [...host.querySelectorAll(".pk-live-panelists__speaker")];
    expect(speakers.at(-1)?.hasAttribute("data-set-apart")).toBe(true);
    expect(speakers.at(-1)?.querySelector(".pk-live-panelists__moderator")?.textContent).toBe("Moderator");
    expect(host.textContent).toContain(session.title);
    expect(host.querySelectorAll(".pk-live-panelists__speaker")).toHaveLength(6);
    expect(host.querySelectorAll(".pk-live-panelists__moderator")).toHaveLength(1);
    expect(host.querySelectorAll(".pk-live-panelists__title")).toHaveLength(6);
    expect(host.querySelectorAll(".pk-live-panelists__headshot img")).toHaveLength(1);
    expect(host.querySelectorAll(".pk-avatar__initials")).toHaveLength(5);
    await act(() => render(<LivePanelistsOverlay session={session} panelists={null} box={BOX} />, host!));
    expect(host.textContent).toBe("");
  },
);
it("sits two speakers or a full panel in one row across a wide board and lists them beside the camera", () => {
  const wide = liveBoardSize(BOX).shape;
  const column = liveBoardSize({ width: 560, height: 520 }).shape;
  const strip = liveBoardSize({ width: 1728, height: 512 });
  expect([wide, column, strip.shape]).toEqual(["wide", "tall", "strip"]);
  // A thin band is set at least the minimum height, so a heading and a row of people still fit.
  expect(strip).toMatchObject({ width: 2160, height: 640 });
  expect(livePanelistsArrangement("panel", "strip", 6)).toBe("row");
  expect([2, 3, 6].map((count) => livePanelistsArrangement("panel", wide, count))).toEqual(["row", "row", "row"]);
  expect([2, 6].map((count) => livePanelistsArrangement("panel", column, count))).toEqual(["rows", "rows"]);
  expect(livePanelistsArrangement("panel", "medium", 5)).toBe("grid");
  expect(livePanelistsArrangement("columns", wide, 4)).toBe("grid");
  expect(livePanelistsArrangement("list", wide, 6)).toBe("rows");
  // More people than a panel seats never squeeze into one row or one list.
  expect([livePanelistsArrangement("panel", wide, 8), livePanelistsArrangement("list", column, 8)]).toEqual([
    "grid",
    "grid",
  ]);
  // A small box scales a board of at least the minimum width, keeping the box's shape.
  expect(liveBoardSize({ width: 560, height: 520 })).toMatchObject({ width: 1040, height: 966 });
});
it("rolls a panelist's identities in turn and shows a single identity still", async () => {
  const session = liveSnapshot().session;
  const credit = session.credits[0]!;
  session.credits = [
    {
      ...credit,
      key: "speaker:two",
      identity: { title: "Principal architect", organization: "Example Trust" },
      additionalIdentities: [{ title: "Co-chair", organization: "Example Working Group" }],
    },
    {
      ...credit,
      key: "speaker:one",
      identity: { title: "Engineer", organization: "Example" },
      additionalIdentities: [],
    },
  ];
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LivePanelistsOverlay session={session} panelists={{ layout: "panel" }} box={BOX} />, host!));
  const [two, one] = [...host.querySelectorAll(".pk-live-panelists__title")];
  expect([...two!.querySelectorAll(".pk-affiliation-rotation__unit")].map((unit) => unit.textContent)).toEqual([
    "Principal architect, Example Trust",
    "Co-chair, Example Working Group",
  ]);
  expect(two!.querySelector(".pk-affiliation-rotation--rotate-2")).not.toBeNull();
  expect([one!.querySelector(".pk-affiliation-rotation"), one!.textContent]).toEqual([null, "Engineer, Example"]);
});
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
