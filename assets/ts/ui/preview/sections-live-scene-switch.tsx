/**
 * A scene switch on air: two scenes that include the same graphics, stacked
 * and placed differently. The ticker keeps scrolling, reactions keep
 * floating and the lower third stays as it is. A graphic whose box keeps its
 * size moves to it; one whose box changes size cuts to it. Only the graphic
 * a scene leaves out goes, and the one it adds enters.
 */
import { useEffect, useState } from "preact/hooks";
import { LIVE_OVERLAY_STANDARD_ELEMENTS } from "../../../shared/live-overlay-layout-presets";
import { withLiveProgramOrder, type LiveProgramLayer } from "../../../shared/live-overlay-stacking";
import {
  LIVE_OVERLAY_ELEMENTS,
  liveOverlayPixelBox,
  type LiveOverlayElementBox,
  type LiveOverlayLayoutElements,
  type LiveOverlayLayoutGeometry,
} from "../../../shared/schemas/live-overlay-layout";
import { LiveOverlayPresentation } from "../../live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../live-session/live-room-state";
import { sampleOverlayRoom } from "../../member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sample";
import { Chip } from "../Chip";
import type { PreviewSection } from "./PreviewShell";
import "./event-screens-preview.css";

/** A scene that includes only the listed graphics, front first, each at its standard box unless placed here. */
function scene(
  slug: string,
  name: string,
  frontToBack: readonly LiveProgramLayer[],
  placed: Partial<Record<LiveProgramLayer, LiveOverlayElementBox>> = {},
): LiveOverlayLayoutGeometry {
  const elements = Object.fromEntries(
    LIVE_OVERLAY_ELEMENTS.map((element) => [
      element,
      {
        ...LIVE_OVERLAY_STANDARD_ELEMENTS[element],
        ...placed[element as LiveProgramLayer],
        shared: false,
        visible: (frontToBack as readonly string[]).includes(element),
      },
    ]),
  ) as LiveOverlayLayoutElements;
  return { slug, name, elements: withLiveProgramOrder(elements, frontToBack) };
}

/** The camera with Up next: reactions float over the ticker, each graphic at its standard box. */
export const SCENE_SWITCH_WIDE = scene("wide", "Wide", ["reactions", "ticker", "timer", "lowerThird", "schedule"]);

const COLUMN = liveOverlayPixelBox(1152, 0, 768, 1080, { horizontal: "right", vertical: "middle" });
/**
 * The camera beside a column of top questions: the ticker along the top, in
 * front of the reactions on the left. The ticker, the timer and reactions
 * keep their size, so they move; the lower third is smaller, so it cuts.
 */
export const SCENE_SWITCH_CLOSE = scene(
  "close",
  "Close",
  ["ticker", "lowerThird", "reactions", "timer", "topQuestions", "background"],
  {
    background: COLUMN,
    topQuestions: COLUMN,
    ticker: liveOverlayPixelBox(0, 0, 1920, 126, { horizontal: "center", vertical: "top" }),
    lowerThird: liveOverlayPixelBox(48, 738, 1056, 288, { horizontal: "left", vertical: "bottom" }),
    timer: liveOverlayPixelBox(768, 174, 336, 120, { horizontal: "right", vertical: "top" }),
    reactions: liveOverlayPixelBox(48, 48, 380, 984, { horizontal: "left", vertical: "middle" }),
  },
);

const SCENES = [SCENE_SWITCH_WIDE, SCENE_SWITCH_CLOSE];
const ROOM = sampleOverlayRoom(Date.parse("2026-11-17T15:00:00.000Z"));
const STAGE = {
  ...ROOM.stage,
  question: null,
  poll: null,
  panelists: null,
  checkIn: null,
  chatFeed: null,
  reactions: true,
  reactionsGraphic: { showCount: false },
};

/** The sample room on one of the two scenes, with the graphics both include on in each. */
export function sceneSwitchRoom(scene: string, burst: LiveRoomState["burst"] = null): LiveRoomState {
  return { ...ROOM, overlayLayouts: SCENES, stage: { ...STAGE, scene }, burst };
}

/** Program on air with someone reacting every moment, and the two scenes to switch between. */
function SceneSwitch() {
  const [scene, setScene] = useState(SCENE_SWITCH_WIDE.slug);
  const [sequence, setSequence] = useState(0);
  useEffect(() => {
    const next = setInterval(() => setSequence((value) => value + 1), 600);
    return () => clearInterval(next);
  }, []);
  const burst = sequence ? { sequence, counts: { applause: 1 }, people: { applause: 1 } } : null;
  return (
    <div class="pk-stack pk-stack--snug">
      <div class="pk-cluster" role="group" aria-label="Scene on Program">
        {SCENES.map(({ slug, name }) => (
          <Chip key={slug} pressed={slug === scene} onToggle={() => setScene(slug)}>
            {name}
          </Chip>
        ))}
      </div>
      <div class="pk-preview__screen pk-preview__camera">
        <LiveOverlayPresentation view="program" projection={sceneSwitchRoom(scene, burst)} broadcast />
      </div>
    </div>
  );
}

export const liveSceneSwitchSections: PreviewSection[] = [
  {
    id: "live-scene-switch",
    title: "Scene switch on air",
    note: "Both scenes include the ticker, reactions, the lower third and a timer, stacked and placed differently. Switching restarts none of them: the ticker, the timer and reactions keep their size and move to their new box, the lower third changes size and cuts to it. Up next leaves and the top questions enter.",
    render: () => <SceneSwitch />,
  },
];
