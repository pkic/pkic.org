// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_OVERLAY_DEFAULT_POSITIONS,
  LIVE_OVERLAY_PRESET_LAYOUTS,
  LIVE_OVERLAY_STANDARD_ELEMENTS,
} from "../../assets/shared/live-overlay-layout-presets";
import { liveProgramLayers } from "../../assets/shared/live-overlay-stacking";
import { liveOverlaySharedBox, resolveLiveSceneElements } from "../../assets/shared/live-scene-elements";
import {
  liveRoomClientMessageSchema,
  liveStageQuestionSchema,
  type LiveRoomClientMessage,
} from "../../assets/shared/schemas/live-session-room";
import { LiveOverlayPresentation } from "../../assets/ts/live-session/LiveOverlayPresentation";
import { applyLiveRoomMessage, type LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import { LiveGraphicRow } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveGraphicRow";
import { liveLayerTargets } from "../../assets/ts/member-flows/portal/sections/events/detail/live/live-output-targets";
import { LIVE_QUESTION, liveSnapshot, liveTargets } from "./helpers/live-room-socket";

let host: HTMLElement | undefined;
afterEach(async () => {
  if (!host) return;
  await act(() => render(null, host!));
  host.remove();
  host = undefined;
});

const question = liveStageQuestionSchema.parse({ id: LIVE_QUESTION, text: "How do we migrate?", authorName: null });

/** A room with a question and reactions on air in Q&A, a scene that leaves reactions out. */
function roomState(overrides: Partial<LiveRoomState> = {}): LiveRoomState {
  const state = applyLiveRoomMessage(null, liveSnapshot())!;
  return {
    ...state,
    stage: { ...state.stage, scene: "questions", question, reactions: true },
    preview: { ...state.preview, scene: "questions", reactions: true },
    ...overrides,
  };
}

describe("graphics kept in every scene", () => {
  it("draws a kept graphic in a scene that leaves it out, at its shared position, in front of the scene's own", () => {
    expect(LIVE_OVERLAY_PRESET_LAYOUTS.questions.elements.reactions.visible).toBe(false);
    const unlocked = resolveLiveSceneElements({ overlayLayouts: [], lockedGraphics: [] }, "questions");
    expect(unlocked.reactions.visible).toBe(false);
    const locked = resolveLiveSceneElements({ overlayLayouts: [], lockedGraphics: ["reactions"] }, "questions");
    expect(locked.reactions).toMatchObject({ visible: true, ...LIVE_OVERLAY_DEFAULT_POSITIONS.reactions });
    expect(liveProgramLayers(locked).at(-1)).toBe("reactions");
    // The scene's own graphics stay where and in the order the scene has them.
    expect(locked.question).toMatchObject(unlocked.question);
    expect(liveProgramLayers(locked).slice(0, -1)).toEqual(
      liveProgramLayers(unlocked).filter((layer) => layer !== "reactions"),
    );
  });

  it("takes the event's shared position from the layouts that share it, and the standard one otherwise", () => {
    const moved = { ...LIVE_OVERLAY_STANDARD_ELEMENTS.lowerThird, x: 0.1, y: 0.5 };
    const own = { ...LIVE_OVERLAY_STANDARD_ELEMENTS.lowerThird, x: 0.3, shared: false };
    const layouts = [
      { slug: "own", name: "Own", elements: { ...LIVE_OVERLAY_STANDARD_ELEMENTS, lowerThird: own } },
      { slug: "talk", name: "Talk", elements: { ...LIVE_OVERLAY_STANDARD_ELEMENTS, lowerThird: moved } },
    ];
    expect(liveOverlaySharedBox(layouts, "lowerThird")).toMatchObject({ x: 0.1, y: 0.5 });
    expect(liveOverlaySharedBox(layouts.slice(0, 1), "lowerThird")).toEqual(LIVE_OVERLAY_DEFAULT_POSITIONS.lowerThird);
    // A scene that places it itself draws a kept one at the shared position too.
    expect(
      resolveLiveSceneElements({ overlayLayouts: layouts, lockedGraphics: ["lowerThird"] }, "own").lowerThird,
    ).toMatchObject({ visible: true, x: 0.1, y: 0.5 });
  });

  it("draws kept reactions on an output whose scene leaves them out, above the question, only while they are on", async () => {
    host = document.body.appendChild(document.createElement("div"));
    const drawn = () =>
      [...host!.querySelectorAll<HTMLElement>("[data-overlay-element]")].map((layer) => layer.dataset.overlayElement);
    await act(() => render(<LiveOverlayPresentation view="program" projection={roomState()} />, host!));
    expect(drawn()).toContain("question");
    expect(drawn()).not.toContain("reactions");
    await act(() =>
      render(
        <LiveOverlayPresentation view="program" projection={roomState({ lockedGraphics: ["reactions"] })} />,
        host!,
      ),
    );
    expect(drawn().at(-1)).toBe("reactions");
    expect(drawn().indexOf("question")).toBeLessThan(drawn().indexOf("reactions"));
    // Keeping it in every scene never puts it on air.
    const off = roomState({ lockedGraphics: ["reactions"] });
    await act(() =>
      render(
        <LiveOverlayPresentation view="program" projection={{ ...off, stage: { ...off.stage, reactions: false } }} />,
        host!,
      ),
    );
    expect(drawn()).not.toContain("reactions");
  });

  it("no longer says a kept graphic is not in this scene", () => {
    const layer = { kind: "reactions" } as const;
    expect(liveLayerTargets(liveTargets(roomState()), layer).programUnseen).toEqual({ reason: "scene", scene: "Q&A" });
    const kept = roomState({ lockedGraphics: ["reactions"] });
    expect(liveLayerTargets(liveTargets(kept), layer)).toMatchObject({ programUnseen: null, previewUnseen: null });
  });
});

describe("keeping a graphic in every scene from its row", () => {
  async function reactionsRow(state: LiveRoomState) {
    const sent: LiveRoomClientMessage[] = [];
    const sendProgram = vi.fn((message: LiveRoomClientMessage) => {
      sent.push(liveRoomClientMessageSchema.parse(message));
      return true;
    });
    host = document.body.appendChild(document.createElement("div"));
    await act(() =>
      render(
        <LiveGraphicRow
          name="Reactions"
          detail="Floating over the picture"
          outputs={{ targets: liveTargets(state, { sendProgram }), layer: { kind: "reactions" }, subject: "reactions" }}
        />,
        host!,
      ),
    );
    await act(() => host!.querySelector<HTMLButtonElement>('[aria-label="Reactions actions"]')!.click());
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((each) =>
      each.textContent?.includes("Keep in every scene"),
    )!;
    return { sent, item };
  }

  it("keeps it from the row's menu, and marks the row while it is kept", async () => {
    const free = await reactionsRow(roomState());
    expect(free.item.getAttribute("aria-checked")).toBe("false");
    expect(host!.querySelector(".pk-live-scene-lock")).toBeNull();
    expect(host!.querySelector(".pk-live-unseen")?.textContent).toBe("On air · not in this scene");
    await act(() => free.item.click());
    expect(free.sent).toEqual([{ type: "graphic.lock", graphic: "reactions", locked: true }]);
    await act(() => render(null, host!));
    host!.remove();

    const kept = await reactionsRow(roomState({ lockedGraphics: ["reactions"] }));
    expect(kept.item.getAttribute("aria-checked")).toBe("true");
    expect(host!.querySelector(".pk-live-scene-lock")?.getAttribute("title")).toBe("Kept in every scene");
    expect(host!.querySelector(".pk-live-unseen")).toBeNull();
    await act(() => kept.item.click());
    expect(kept.sent).toEqual([{ type: "graphic.lock", graphic: "reactions", locked: false }]);
  });

  it("keeps the room's list from the changes it receives", () => {
    const state = roomState();
    const next = applyLiveRoomMessage(state, { type: "graphic.lock.changed", lockedGraphics: ["reactions", "ticker"] });
    expect(next?.lockedGraphics).toEqual(["reactions", "ticker"]);
  });
});
