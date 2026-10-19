import { liveOverlayLayoutChoices } from "../../../../../../../../shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_DEFAULT_LAYOUT,
  type LiveOverlayLayoutGeometry,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { useHashQueryParam } from "../../../../../../../hooks/useHashQueryParam";
import { Field } from "../../../../../../../ui/Field";
import { Select } from "../../../../../../../ui/TextControl";
import { LiveOverlayLinks } from "../LiveOverlayLinks";

/** The room's browser sources for one layout at a time; the layout follows the address. */
export function SourcesPanel({
  slug,
  roomId,
  layouts,
}: {
  slug: string;
  roomId: string;
  layouts: readonly LiveOverlayLayoutGeometry[];
}) {
  const choices = liveOverlayLayoutChoices(layouts);
  const [chosen, choose] = useHashQueryParam(
    "sourceLayout",
    LIVE_OVERLAY_DEFAULT_LAYOUT,
    choices.map((choice) => choice.slug),
  );
  const layout = choices.find((choice) => choice.slug === chosen) ?? choices[0]!;
  return (
    <div class="pk-stack">
      <Field label="Layout" help="Each scene in your production software loads its output with the layout it needs.">
        {(control) => (
          <Select
            {...control}
            name="sourceLayout"
            value={layout.slug}
            onChange={(event) => choose(event.currentTarget.value)}
          >
            {choices.map((choice) => (
              <option key={choice.slug} value={choice.slug}>
                {choice.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <LiveOverlayLinks slug={slug} roomId={roomId} layout={layout} />
    </div>
  );
}
