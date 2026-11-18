import { memo } from "preact/compat";
import { useRef } from "preact/hooks";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import {
  liveSceneOutline,
  liveSceneThumbnailEmpty,
  liveSceneThumbnailState,
  sameLiveSceneThumbnailSource,
} from "../../../../../../../live-session/live-scene-thumbnail";
import { overlayBoxPixels } from "../../../../../../../../shared/live-overlay-geometry";
import { liveOverlayLayoutChoices } from "../../../../../../../../shared/live-overlay-layout-presets";
import { LIVE_OVERLAY_FRAME } from "../../../../../../../../shared/schemas/live-overlay-layout";
import { LiveOverlayPresentation } from "../../../../../../../live-session/LiveOverlayPresentation";
import "../live-tally.css";
import "./SceneChoices.css";

/** Where the scene thumbnails draw from: the shared Preview, and the room as it is on air. */
export interface SceneSources {
  preview: LiveRoomState;
  program: LiveRoomState | null;
  roomId: string;
  slug: string;
}

/** The Preview the thumbnails draw, made again only when what they show changes. */
function useSceneThumbnailState(sources: SceneSources): LiveRoomState {
  const last = useRef<{ preview: LiveRoomState; state: LiveRoomState } | null>(null);
  if (!last.current || !sameLiveSceneThumbnailSource(last.current.preview, sources.preview))
    last.current = { preview: sources.preview, state: liveSceneThumbnailState(sources.preview) };
  return last.current.state;
}

/** The scene's boxes, faintly outlined over an empty Preview's thumbnail so each scene stays recognizable. */
function SceneOutline({ scene, state }: { scene: string; state: LiveRoomState }) {
  return (
    <svg
      class="pk-studio-scene__outline"
      viewBox={`0 0 ${LIVE_OVERLAY_FRAME.width} ${LIVE_OVERLAY_FRAME.height}`}
      preserveAspectRatio="none"
    >
      {liveSceneOutline(state, scene).map((placement, index) => {
        const box = overlayBoxPixels(placement);
        return <rect key={index} x={box.x} y={box.y} width={box.width} height={box.height} />;
      })}
    </svg>
  );
}

/**
 * One scene drawn with what Preview holds, by the same renderer as the
 * monitors and scaled down by its box: exactly what Preview shows once the
 * scene is loaded. Its state changes only when Preview's picture does, so
 * chat and presence leave it alone.
 */
const SceneThumbnail = memo(function SceneThumbnail({
  scene,
  state,
  roomId,
  eventSlug,
}: {
  scene: string;
  state: LiveRoomState;
  roomId: string;
  eventSlug: string;
}) {
  return (
    <span class="pk-studio-scene__picture" aria-hidden="true">
      <LiveOverlayPresentation view="program" layout={scene} projection={state} roomId={roomId} eventSlug={eventSlug} />
      {liveSceneThumbnailEmpty(state.stage) ? <SceneOutline scene={scene} state={state} /> : null}
    </span>
  );
});

/** The scene Preview holds; an unknown one is drawn as the event's default. */
export function previewSceneOf(preview: LiveRoomState) {
  const choices = liveOverlayLayoutChoices(preview.overlayLayouts);
  return { choices, current: choices.find((choice) => choice.slug === preview.stage.scene) ?? choices[0]! };
}

/** A scene's name and where it is now, then what choosing it does. */
function sceneHint(name: string, inPreview: boolean, onProgram: boolean): string {
  const where = [inPreview ? "in Preview" : null, onProgram ? "on Program" : null].filter(Boolean).join(" and ");
  return `${name}${where ? ` · ${where}` : ""}\n${
    inPreview ? "Transition puts it on Program." : "Load it into Preview. Transition puts it on Program."
  }`;
}

/**
 * The event's scenes as thumbnails, each named under its picture, the one in
 * Preview edged in Preview's color. Choosing one loads it into Preview for
 * every operator; the next Take puts it on Program.
 */
export function SceneChoices({
  sources,
  disabled,
  onScene,
}: {
  sources: SceneSources;
  disabled: boolean;
  onScene: (scene: string) => void;
}) {
  const state = useSceneThumbnailState(sources);
  const { choices, current } = previewSceneOf(sources.preview);
  const onProgram = sources.program ? previewSceneOf(sources.program).current.slug : null;
  return (
    <>
      {choices.map((choice) => {
        const on = choice.slug === current.slug;
        return (
          <button
            key={choice.slug}
            type="button"
            class="pk-studio-scene"
            data-tally={on ? "preview" : undefined}
            aria-pressed={on}
            title={sceneHint(choice.name, on, choice.slug === onProgram)}
            disabled={disabled}
            onClick={() => onScene(choice.slug)}
          >
            <SceneThumbnail scene={choice.slug} state={state} roomId={sources.roomId} eventSlug={sources.slug} />
            <span class="pk-studio-scene__name">{choice.name}</span>
          </button>
        );
      })}
    </>
  );
}
