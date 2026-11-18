/**
 * The sample room the studio's on-screen previews share: the room itself,
 * the projector's Q&A layout, and the projector screen and livestream overlay
 * it is drawn on. Synthetic room, fixed clock.
 */
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  EMPTY_LIVE_OUTPUTS,
  type LiveStage,
} from "../../../shared/schemas/live-session-room";
import { LIVE_OVERLAY_PRESET_LAYOUTS } from "../../../shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_ELEMENTS,
  liveOverlayPixelBox,
  type LiveOverlayLayout,
  type LiveOverlayLayoutElements,
} from "../../../shared/schemas/live-overlay-layout";
import { ScreenView } from "../../event-screens/ScreenApp";
import { LiveOverlayPresentation } from "../../live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../live-session/live-room-state";
import { sampleOverlayRoom } from "../../member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sample";
import { SCREEN_FIXTURE, SCREEN_FIXTURE_NOW } from "./event-screens-fixtures";
import "./event-screens-preview.css";

export const ROOM = sampleOverlayRoom(SCREEN_FIXTURE_NOW);

/**
 * An organizer's layout for the room's projector during Q&A: top questions
 * large on the left, reactions up the right, every other element hidden. It
 * is sized in the event's layout settings like any other card.
 */
const FULL_FRAME = LIVE_OVERLAY_PRESET_LAYOUTS["talk"].elements;
const QA_ELEMENTS = Object.fromEntries(
  LIVE_OVERLAY_ELEMENTS.map((element) => [
    element,
    { ...FULL_FRAME[element], visible: element === "topQuestions" || element === "reactions" },
  ]),
) as LiveOverlayLayoutElements;
QA_ELEMENTS.topQuestions = {
  visible: true,
  shared: false,
  ...liveOverlayPixelBox(0, 0, 1920, 1080, { horizontal: "center", vertical: "middle" }),
};
export const QA_LAYOUT: LiveOverlayLayout = {
  slug: "projector-qa",
  name: "Projector Q&A",
  preset: "talk",
  builtIn: false,
  saved: true,
  elements: QA_ELEMENTS,
  updatedAt: "2026-11-30T09:00:00.000Z",
};

/** The room with only the audience graphics on: on the projector's own composition, and on Program. */
export function roomWith(projector: Partial<LiveStage>, program: Partial<LiveStage> = {}): LiveRoomState {
  return {
    ...ROOM,
    overlayLayouts: [{ slug: QA_LAYOUT.slug, name: QA_LAYOUT.name, elements: QA_LAYOUT.elements }],
    stage: { ...EMPTY_LIVE_AUX_COMPOSITION, ...program },
    outputs: { ...EMPTY_LIVE_OUTPUTS, projector: { ...EMPTY_LIVE_AUX_COMPOSITION, ...projector } },
  };
}

/** A projector screen at the venue, drawn through the screen's own display code. */
export function ProjectorScreen({ state, layout = null }: { state: LiveRoomState; layout?: string | null }) {
  return (
    <div class="pk-preview__screen">
      <ScreenView
        screenId={SCREEN_FIXTURE.screenId}
        now={SCREEN_FIXTURE_NOW}
        display={{
          kind: "output",
          output: "projector",
          layout,
          roomId: SCREEN_FIXTURE.roomId,
          eventSlug: SCREEN_FIXTURE.eventSlug,
          state,
          marker: null,
        }}
      />
    </div>
  );
}

/** The livestream overlay over a stand-in for the camera, as the production software composes it. */
export function LivestreamOverlay({ state, elements }: { state: LiveRoomState; elements?: LiveOverlayLayoutElements }) {
  return (
    <div class="pk-preview__screen pk-preview__camera">
      <LiveOverlayPresentation view="program" projection={state} elements={elements} broadcast />
    </div>
  );
}

/** A layout preset with only the named elements on. */
export function presetWith(
  preset: keyof typeof LIVE_OVERLAY_PRESET_LAYOUTS,
  shown: readonly (typeof LIVE_OVERLAY_ELEMENTS)[number][],
): LiveOverlayLayoutElements {
  const elements = LIVE_OVERLAY_PRESET_LAYOUTS[preset].elements;
  return Object.fromEntries(
    LIVE_OVERLAY_ELEMENTS.map((element) => [element, { ...elements[element], visible: shown.includes(element) }]),
  ) as LiveOverlayLayoutElements;
}
