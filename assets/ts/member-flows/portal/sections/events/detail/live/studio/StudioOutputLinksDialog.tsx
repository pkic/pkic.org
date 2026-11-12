import { useState } from "preact/hooks";
import { liveOverlayLayoutChoices } from "../../../../../../../../shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_DEFAULT_LAYOUT,
  type LiveOverlayLayoutGeometry,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { Dialog } from "../../../../../../../ui/Dialog";
import { Field } from "../../../../../../../ui/Field";
import { Select } from "../../../../../../../ui/TextControl";
import { LiveOverlayLinks } from "../LiveOverlayLinks";

/**
 * The room's output links for the production software, from the studio's
 * toolbar rather than a panel: they are set up once, not watched. Each scene
 * loads an output with the layout it needs.
 */
export function StudioOutputLinksDialog({
  slug,
  roomId,
  layouts,
  onClose,
}: {
  slug: string;
  roomId: string;
  layouts: readonly LiveOverlayLayoutGeometry[];
  onClose: () => void;
}) {
  const choices = liveOverlayLayoutChoices(layouts);
  const [chosen, choose] = useState<string>(LIVE_OVERLAY_DEFAULT_LAYOUT);
  const layout = choices.find((choice) => choice.slug === chosen) ?? choices[0]!;
  return (
    <Dialog
      open
      viewer
      title="Output links"
      description="Add each output to your production software as a browser source."
      closeLabel="Close output links"
      confirmLabel="Close"
      onConfirm={onClose}
      onCancel={onClose}
    >
      <div class="pk-stack">
        <Field label="Layout" help="Each scene loads its output with the layout it needs.">
          {(control) => (
            <Select
              {...control}
              name="layout"
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
    </Dialog>
  );
}
