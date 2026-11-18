import { SceneChoices, type SceneSources } from "./SceneChoices";
import "./SceneStrip.css";

/**
 * The event's scenes under Preview, each a thumbnail of the scene with the
 * room's real content. Choosing one loads it into Preview for every
 * operator, as the scene button in Preview's header does; the next Take puts
 * it on Program.
 */
export function SceneStrip({
  sources,
  disabled,
  onScene,
}: {
  sources: SceneSources;
  disabled: boolean;
  onScene: (scene: string) => void;
}) {
  return (
    <div class="pk-studio-scenes" role="group" aria-label="Load a scene into Preview">
      <SceneChoices sources={sources} disabled={disabled} onScene={onScene} />
    </div>
  );
}
