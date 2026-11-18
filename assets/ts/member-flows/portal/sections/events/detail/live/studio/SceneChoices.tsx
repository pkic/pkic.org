import { memo } from "preact/compat";
import { useRef } from "preact/hooks";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import {
  liveSceneThumbnailState,
  sameLiveSceneThumbnailSource,
} from "../../../../../../../live-session/live-scene-thumbnail";
import { liveOverlayLayoutChoices } from "../../../../../../../../shared/live-overlay-layout-presets";
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

/** The room state the thumbnails draw, made again only when what they show changes. */
function useSceneThumbnailState(sources: SceneSources): LiveRoomState {
  const last = useRef<{ preview: LiveRoomState; program: LiveRoomState | null; state: LiveRoomState } | null>(null);
  if (!last.current || !sameLiveSceneThumbnailSource(last.current, sources))
    last.current = {
      preview: sources.preview,
      program: sources.program,
      state: liveSceneThumbnailState(sources.preview, sources.program),
    };
  return last.current.state;
}

/**
 * One scene drawn with the room's real content, by the same renderer as the
 * monitors and scaled down by its box. Its state changes only when what it
 * shows does, so chat and presence leave it alone.
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
    </span>
  );
});

/** The scene Preview holds; an unknown one is drawn as the event's default. */
export function previewSceneOf(preview: LiveRoomState) {
  const choices = liveOverlayLayoutChoices(preview.overlayLayouts);
  return { choices, current: choices.find((choice) => choice.slug === preview.stage.scene) ?? choices[0]! };
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
            title={`Load ${choice.name} into Preview. Take puts it on Program.`}
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
