import { describe, expect, it } from "vitest";
import { LIVE_OVERLAY_PRESET_LAYOUTS } from "../../assets/shared/live-overlay-layout-presets";
import { applyLiveRoomMessage, type LiveRoomState } from "../../assets/ts/live-session/live-room-state";
import {
  liveSceneOutline,
  liveSceneThumbnailEmpty,
  liveSceneThumbnailState,
  sameLiveSceneThumbnailSource,
} from "../../assets/ts/live-session/live-scene-thumbnail";
import { LIVE_POLL, liveSnapshot } from "./helpers/live-room-socket";

const QUESTION = {
  id: "20000000-0000-4000-8000-000000000031",
  text: "What about hybrid certificates?",
  authorName: null,
  authorPhotoUrl: null,
  authorAffiliation: null,
  addressedTo: null,
};

function room(overrides: Parameters<typeof liveSnapshot>[0] = {}): LiveRoomState {
  return applyLiveRoomMessage(
    null,
    liveSnapshot({ viewer: { role: "operator", name: "Olga Operator" }, ...overrides }),
  )!;
}

/** The studio's Preview: the room with Preview's composition as its stage. */
const previewOf = (state: LiveRoomState): LiveRoomState => ({ ...state, stage: state.preview });

describe("scene thumbnails", () => {
  it("draw exactly what Preview holds, never what Program or the session would add", () => {
    const state = room({
      preview: { ...liveSnapshot().stage, question: QUESTION },
      stage: { ...liveSnapshot().stage, poll: { id: LIVE_POLL, presentation: { chart: "bar" as const } } },
    });
    const preview = previewOf(state);
    const thumbnail = liveSceneThumbnailState(preview);
    expect(thumbnail).toBe(preview);
    expect(thumbnail.stage.question?.text).toBe("What about hybrid certificates?");
    expect(thumbnail.stage.poll).toBeNull();
    expect(thumbnail.stage.lowerThird).toBeNull();
  });

  it("stay still, without reaction bursts", () => {
    const state = { ...previewOf(room()), burst: { sequence: 1, counts: { applause: 2 }, people: { applause: 2 } } };
    expect(liveSceneThumbnailState(state).burst).toBeNull();
  });

  it("change only when Preview's picture does", () => {
    const preview = previewOf(room());
    expect(sameLiveSceneThumbnailSource(preview, { ...preview, chat: [] })).toBe(true);
    expect(sameLiveSceneThumbnailSource(preview, { ...preview, stage: { ...preview.stage, question: QUESTION } })).toBe(
      false,
    );
  });

  it("outline the scene's boxes only while Preview holds no graphic", () => {
    const empty = previewOf(room());
    expect(liveSceneThumbnailEmpty(empty.stage)).toBe(true);
    expect(liveSceneThumbnailEmpty({ ...empty.stage, question: QUESTION })).toBe(false);
    const scene = Object.keys(LIVE_OVERLAY_PRESET_LAYOUTS)[0]!;
    const outline = liveSceneOutline(empty, scene);
    expect(outline.length).toBeGreaterThan(0);
    expect(outline.every((box) => box.visible)).toBe(true);
  });
});
