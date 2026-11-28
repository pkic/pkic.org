// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  liveRoomClientMessageSchema,
  liveStageSchema,
  type LivePanelists,
  type LiveRoomClientMessage,
} from "../../assets/shared/schemas/live-session-room";
import { LivePanelistsOverlay, livePanelistsArrangement } from "../../assets/ts/live-session/LivePanelistsOverlay";
import { liveBoardSize } from "../../assets/ts/live-session/LiveBoard";
import { LivePanelQuestionOverlay } from "../../assets/ts/live-session/LivePanelQuestionOverlay";
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
    // The moderator sits after the speakers, named by the badge on their photo.
    const speakers = [...host.querySelectorAll(".pk-live-panelists__speaker")];
    expect(speakers.at(-1)?.hasAttribute("data-moderator")).toBe(true);
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
it("shows the session's title alone or with its abstract, and its one speaker", async () => {
  const session = { ...liveSnapshot().session, abstract: "How to plan the move to post-quantum certificates." };
  session.credits = session.credits.slice(0, 1);
  host = document.body.appendChild(document.createElement("div"));
  const draw = (panelists: LivePanelists) =>
    act(() => render(<LivePanelistsOverlay session={session} panelists={panelists} box={BOX} />, host!));
  await draw({ layout: "title" });
  expect(host.querySelector(".pk-live-panelists__session")?.textContent).toBe(session.title);
  expect(host.querySelector(".pk-live-panelists__credits")).toBeNull();
  expect(host.querySelector(".pk-live-panelists__abstract")).toBeNull();
  await draw({ layout: "title", abstract: true });
  expect(host.querySelector(".pk-live-panelists__abstract")?.textContent).toBe(session.abstract);
  await draw({ layout: "panel", abstract: true });
  expect(host.querySelectorAll(".pk-live-panelists__speaker")).toHaveLength(1);
  expect(host.querySelector(".pk-live-panelists__abstract")).not.toBeNull();
  // A session without an abstract shows none, whatever the operator chose.
  await act(() =>
    render(
      <LivePanelistsOverlay
        session={{ ...session, abstract: null }}
        panelists={{ layout: "title", abstract: true }}
        box={BOX}
      />,
      host!,
    ),
  );
  expect(host.querySelector(".pk-live-panelists__abstract")).toBeNull();
});
it("gives a question to the panel the room its session title would take", async () => {
  const snapshot = liveSnapshot();
  const session = { ...snapshot.session, abstract: "How to plan the move to post-quantum certificates." };
  const question = {
    id: "question-1",
    text: "Is hybrid signing worth it?",
    authorName: null,
    authorPhotoUrl: null,
    authorAffiliation: null,
    addressedTo: null,
  };
  host = document.body.appendChild(document.createElement("div"));
  await act(() =>
    render(
      <LivePanelQuestionOverlay
        stage={{ ...snapshot.stage, question, panelists: { layout: "panel", abstract: true } }}
        session={session}
        box={BOX}
      />,
      host!,
    ),
  );
  expect(host.textContent).toContain(question.text);
  expect(host.querySelectorAll(".pk-live-panelists__speaker")).toHaveLength(session.credits.length);
  expect(host.textContent).not.toContain(session.title);
  expect(host.querySelector(".pk-live-panelists__abstract")).toBeNull();
});
it("sits two speakers or a full panel in one row across a wide board and lists them beside the camera", () => {
  const wide = liveBoardSize(BOX).shape;
  const column = liveBoardSize({ width: 560, height: 520 }).shape;
  const strip = liveBoardSize({ width: 1728, height: 512 });
  expect([wide, column, strip.shape]).toEqual(["wide", "tall", "strip"]);
  // A larger text size lays the same box out smaller, in the same shape, so it scales up into the box.
  const larger = liveBoardSize({ ...BOX, textSize: 1.5 });
  expect(larger).toEqual({ width: Math.round(BOX.width / 1.5), height: Math.round(BOX.height / 1.5), shape: "wide" });
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
  host.querySelector<HTMLButtonElement>('button[aria-label="Show session graphic in preview"]')!.click();
  host.querySelector<HTMLButtonElement>('button[aria-label="Show session graphic on air"]')!.click();
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
