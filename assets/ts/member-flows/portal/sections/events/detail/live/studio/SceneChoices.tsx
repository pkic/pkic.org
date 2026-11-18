import { memo } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import {
  liveSceneOutline,
  liveSceneThumbnails,
  sameLiveSceneThumbnailRoom,
  type LiveSceneThumbnail,
  type LiveSceneThumbnailRoom,
} from "../../../../../../../live-session/live-scene-thumbnail";
import { formatConjunction } from "../../../../../../../../shared/format-list";
import { overlayBoxPixels } from "../../../../../../../../shared/live-overlay-geometry";
import { liveOverlayLayoutChoices } from "../../../../../../../../shared/live-overlay-layout-presets";
import type { AgendaSnapshot } from "../../../../../../../../shared/schemas/event-agenda";
import {
  LIVE_OVERLAY_FRAME,
  type LiveOverlayElementPlacement,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { LiveOverlayPresentation } from "../../../../../../../live-session/LiveOverlayPresentation";
import { sceneOutputs, type SceneOutput } from "./scene-outputs";
import "../live-tally.css";
import "./SceneChoices.css";

/** Where the scene thumbnails draw from: the shared Preview, the room as it is on air, and the approved agenda. */
export interface SceneSources {
  preview: LiveRoomState;
  program: LiveRoomState | null;
  /** The approved agenda, which Up next and the ticker read; null before the first approval. */
  agenda: AgendaSnapshot | null;
  roomId: string;
  slug: string;
}

/** Up next and the ticker's lines change by the minute, so the thumbnails read the clock by the minute. */
const MINUTE = 60_000;

/**
 * Every scene's thumbnail, made again only when what the thumbnails draw
 * from changes, and then only for the scenes whose picture changed: chat and
 * presence leave them all alone.
 */
function useSceneThumbnails(sources: SceneSources, scenes: readonly string[]) {
  const last = useRef<{ room: LiveSceneThumbnailRoom; thumbnails: Map<string, LiveSceneThumbnail> } | null>(null);
  const { preview, program, agenda } = sources;
  // The session's own Program; the room on air is another session's while this one waits.
  const own = program?.session.occurrenceId === preview.session.occurrenceId ? program.stage : null;
  const room: LiveSceneThumbnailRoom = { preview, program: own, agenda };
  if (!last.current || !sameLiveSceneThumbnailRoom(last.current.room, room))
    last.current = {
      room,
      thumbnails: liveSceneThumbnails(room, scenes, Math.floor(Date.now() / MINUTE) * MINUTE, last.current?.thumbnails),
    };
  return last.current.thumbnails;
}

/** Boxes of the scene as faint hairlines over its thumbnail. */
function SceneOutline({ boxes }: { boxes: readonly LiveOverlayElementPlacement[] }) {
  return (
    <svg
      class="pk-studio-scene__outline"
      viewBox={`0 0 ${LIVE_OVERLAY_FRAME.width} ${LIVE_OVERLAY_FRAME.height}`}
      preserveAspectRatio="none"
    >
      {boxes.map((placement, index) => {
        const box = overlayBoxPixels(placement);
        return <rect key={index} x={box.x} y={box.y} width={box.width} height={box.height} />;
      })}
    </svg>
  );
}

/**
 * Scales a thumbnail's overlay to its picture by the picture's own measured
 * size, given to the stylesheet as a custom property. The overlay's frame
 * scales by its container's units, which the browser does not read again
 * when the strip resizes around a thumbnail that is not redrawn, so a
 * thumbnail would keep the scale of its first size.
 */
function useSceneScale() {
  const picture = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = picture.current;
    if (!node) return;
    // The whole frame fits the picture inside its border, as the frame itself fits its box.
    const fit = (width: number, height: number) =>
      node.style.setProperty(
        "--scene-scale",
        String(Math.min(width / LIVE_OVERLAY_FRAME.width, height / LIVE_OVERLAY_FRAME.height)),
      );
    fit(node.clientWidth, node.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) fit(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return picture;
}

/**
 * One scene as Preview shows it once the scene is loaded, drawn by the same
 * renderer as the monitors and scaled down by its box. Its thumbnail changes
 * only when that picture does. A scene that draws no graphic shows its boxes
 * faintly, so it stays recognizable; so does a graphic only the room can fill.
 */
const SceneThumbnail = memo(function SceneThumbnail({
  scene,
  thumbnail,
  roomId,
  eventSlug,
}: {
  scene: string;
  thumbnail: LiveSceneThumbnail;
  roomId: string;
  eventSlug: string;
}) {
  const outline = liveSceneOutline(thumbnail, scene);
  const picture = useSceneScale();
  return (
    <span ref={picture} class="pk-studio-scene__picture" aria-hidden="true">
      <LiveOverlayPresentation
        view="program"
        layout={scene}
        projection={thumbnail.state}
        roomId={roomId}
        eventSlug={eventSlug}
      />
      {outline.length ? <SceneOutline boxes={outline} /> : null}
    </span>
  );
});

/** The scene Preview holds; an unknown one is drawn as the event's default. */
export function previewSceneOf(preview: LiveRoomState) {
  const choices = liveOverlayLayoutChoices(preview.overlayLayouts);
  return { choices, current: choices.find((choice) => choice.slug === preview.stage.scene) ?? choices[0]! };
}

/** A scene's name and the outputs showing it now, then what choosing it does. */
function sceneHint(name: string, inPreview: boolean, outputs: readonly SceneOutput[]): string {
  const where = outputs.length ? ` · ${formatConjunction(outputs.map((output) => output.where))}` : "";
  return `${name}${where}\n${
    inPreview ? "Transition puts it on Program." : "Load it into Preview. Transition puts it on Program."
  }`;
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A dot per output showing the scene now, in that output's tally color; its name is its hint. */
function SceneMarkers({ outputs }: { outputs: readonly SceneOutput[] }) {
  if (!outputs.length) return null;
  return (
    <span class="pk-studio-scene__markers">
      {outputs.map((output) => (
        <span
          key={output.key}
          class="pk-studio-scene__marker"
          role="img"
          aria-label={sentence(output.where)}
          title={sentence(output.where)}
          {...output.tally}
        />
      ))}
    </span>
  );
}

/**
 * The event's scenes as thumbnails, each named under its picture and marked
 * with a dot for every output showing it now; the one in Preview is edged in
 * Preview's color too. Choosing one loads it into Preview for every
 * operator; the next Take puts it on Program.
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
  const { choices, current } = previewSceneOf(sources.preview);
  const thumbnails = useSceneThumbnails(
    sources,
    choices.map((choice) => choice.slug),
  );
  const shown = sceneOutputs(sources);
  return (
    <>
      {choices.map((choice) => {
        const on = choice.slug === current.slug;
        const outputs = shown.get(choice.slug) ?? [];
        return (
          <button
            key={choice.slug}
            type="button"
            class="pk-studio-scene"
            data-tally={on ? "preview" : undefined}
            aria-pressed={on}
            title={sceneHint(choice.name, on, outputs)}
            disabled={disabled}
            onClick={() => onScene(choice.slug)}
          >
            <SceneThumbnail
              scene={choice.slug}
              thumbnail={thumbnails.get(choice.slug)!}
              roomId={sources.roomId}
              eventSlug={sources.slug}
            />
            {/* The name first, so the scene is read before where it shows; the dots lead it on screen. */}
            <span class="pk-studio-scene__label">
              <span class="pk-studio-scene__name">{choice.name}</span>
              <SceneMarkers outputs={outputs} />
            </span>
          </button>
        );
      })}
    </>
  );
}
