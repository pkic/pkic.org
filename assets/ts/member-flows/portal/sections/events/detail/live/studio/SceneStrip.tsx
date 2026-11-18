import { memo } from "preact/compat";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { liveOverlayLayoutChoices } from "../../../../../../../../shared/live-overlay-layout-presets";
import { LiveOverlayPresentation } from "../../../../../../../live-session/LiveOverlayPresentation";
import "../live-tally.css";
import "./SceneStrip.css";

/**
 * One scene drawn with what the shared Preview holds now: the same renderer
 * as the monitors, scaled down by its box. It renders again only when what
 * Preview draws from changes, so chat and presence leave it alone.
 */
const SceneThumbnail = memo(
  function SceneThumbnail({
    scene,
    preview,
    roomId,
    eventSlug,
  }: {
    scene: string;
    preview: LiveRoomState;
    roomId: string;
    eventSlug: string;
  }) {
    return (
      <span class="pk-studio-scenes__picture" aria-hidden="true">
        <LiveOverlayPresentation
          view="program"
          layout={scene}
          projection={preview}
          roomId={roomId}
          eventSlug={eventSlug}
        />
      </span>
    );
  },
  (previous, next) =>
    previous.scene === next.scene &&
    previous.roomId === next.roomId &&
    previous.eventSlug === next.eventSlug &&
    previous.preview.stage === next.preview.stage &&
    previous.preview.timers === next.preview.timers &&
    previous.preview.polls === next.preview.polls &&
    previous.preview.session === next.preview.session &&
    previous.preview.overlayLayouts === next.preview.overlayLayouts &&
    previous.preview.burst === next.preview.burst,
);

/**
 * The event's scenes under Preview, each a live thumbnail of Preview in that
 * scene. Choosing one loads it into Preview for every operator, as the scene
 * menu in Preview's header does; the next Take puts it on Program.
 */
export function SceneStrip({
  preview,
  roomId,
  eventSlug,
  disabled,
  onScene,
}: {
  preview: LiveRoomState;
  roomId: string;
  eventSlug: string;
  disabled: boolean;
  onScene: (scene: string) => void;
}) {
  const choices = liveOverlayLayoutChoices(preview.overlayLayouts);
  const current = choices.find((choice) => choice.slug === preview.stage.scene)?.slug ?? choices[0]?.slug;
  return (
    <div class="pk-studio-scenes" role="group" aria-label="Load a scene into Preview">
      {choices.map((choice) => (
        <button
          key={choice.slug}
          type="button"
          class="pk-studio-scenes__scene"
          data-tally={choice.slug === current ? "preview" : undefined}
          aria-pressed={choice.slug === current}
          title={`Load ${choice.name} into Preview. Take puts it on Program.`}
          disabled={disabled}
          onClick={() => onScene(choice.slug)}
        >
          <SceneThumbnail scene={choice.slug} preview={preview} roomId={roomId} eventSlug={eventSlug} />
          <span class="pk-studio-scenes__name">{choice.name}</span>
        </button>
      ))}
    </div>
  );
}
