import { liveOutputProjection, liveOutputScene } from "../../../../../../../live-session/live-output-projection";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { liveOverlayLayoutChoices } from "../../../../../../../../shared/live-overlay-layout-presets";
import {
  LIVE_PREVIEW_OUTPUT_DETAILS,
  LIVE_PROGRAM_OUTPUT_DETAILS,
  liveRoomOutputs,
} from "../../../../../../../../shared/live-room-outputs";
import { liveTallyAttributes } from "../live-tally";

/** One output that shows a scene now: where, in the studio's words, and its tally color. */
export interface SceneOutput {
  key: string;
  /** "on Program", "in Preview", "on Projector": a marker says it as its name, a hint within a sentence. */
  where: string;
  tally: ReturnType<typeof liveTallyAttributes>;
}

/**
 * The outputs showing each scene now, by the scene's slug: Program, then
 * Preview, then the room's screens in their order. An output that names no
 * scene, or one retired since, shows the event's default one, as it is
 * drawn. A screen's scene is its own, also while it follows Program; the
 * speaker's screen draws its own layout and no scene. Program and the
 * screens are read from the room on air, as their monitors are.
 */
export function sceneOutputs(sources: {
  preview: LiveRoomState;
  program: LiveRoomState | null;
}): Map<string, SceneOutput[]> {
  const { preview, program } = sources;
  const choices = liveOverlayLayoutChoices(preview.overlayLayouts);
  const shown = new Map<string, SceneOutput[]>();
  const add = (scene: string | null, output: SceneOutput) => {
    const slug = (choices.find((choice) => choice.slug === scene) ?? choices[0]!).slug;
    shown.set(slug, [...(shown.get(slug) ?? []), output]);
  };
  const room = liveRoomOutputs(preview.session);
  if (program)
    add(program.stage.scene, {
      key: "program",
      where: `on ${LIVE_PROGRAM_OUTPUT_DETAILS.label}`,
      tally: liveTallyAttributes(room, "program"),
    });
  add(preview.stage.scene, {
    key: "preview",
    where: `in ${LIVE_PREVIEW_OUTPUT_DETAILS.label}`,
    tally: liveTallyAttributes(room, "preview"),
  });
  if (program)
    for (const output of room) {
      if (output.role === "speaker") continue;
      add(liveOutputScene(liveOutputProjection(program, output.key), output.key), {
        key: output.key,
        where: `on ${output.name}`,
        tally: liveTallyAttributes(room, output.key),
      });
    }
  return shown;
}
