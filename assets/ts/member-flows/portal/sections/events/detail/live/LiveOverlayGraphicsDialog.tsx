import { useState } from "preact/hooks";
import {
  LIVE_OVERLAY_ELEMENT_LABELS,
  type LiveOverlayElement,
} from "../../../../../../../shared/schemas/live-overlay-layout";
import {
  ALL_LIVE_OVERLAY_GRAPHICS,
  liveOverlayCropElement,
  liveOverlaySourceGraphics,
  type LiveOverlayGraphics,
} from "../../../../../../live-session/live-overlay-graphics";
import { CopyLinkRow } from "../../../../../../shared/widgets/copy-link-row";
import { Checkbox, Radio } from "../../../../../../ui/Checkbox";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";

type GraphicsChoice = "all" | "only" | "except";

const CHOICES: ReadonlyArray<{ id: GraphicsChoice; label: string }> = [
  { id: "all", label: "All graphics" },
  { id: "only", label: "Only these" },
  { id: "except", label: "All except these" },
];

/** The graphics parameters a choice writes: only one of show and hide, never both. */
function graphicsOf(choice: GraphicsChoice, picked: readonly LiveOverlayElement[], crop: boolean): LiveOverlayGraphics {
  if (choice === "all") return ALL_LIVE_OVERLAY_GRAPHICS;
  return choice === "only" ? { show: [...picked], hide: null, crop } : { show: null, hide: [...picked], crop };
}

/**
 * Builds one output's browser-source link that draws only some graphics, or
 * all but some, and can crop to the one left, so the production software can
 * place that graphic on its own.
 */
export function LiveOverlayGraphicsDialog({
  label,
  link,
  onClose,
}: {
  /** The output's name, as its row lists it. */
  label: string;
  /** The output's link for these graphics. */
  link: (graphics: LiveOverlayGraphics) => string;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<GraphicsChoice>("all");
  const [picked, setPicked] = useState<readonly LiveOverlayElement[]>([]);
  const [crop, setCrop] = useState(false);
  const graphics = graphicsOf(choice, picked, crop);
  // Crop needs exactly one graphic left; with more or none it is off, and the link leaves it out.
  const croppable = liveOverlayCropElement(graphicsOf(choice, picked, true)) !== null;
  const shown = croppable ? graphics : { ...graphics, crop: false };
  const toggle = (element: LiveOverlayElement, on: boolean) =>
    setPicked((current) =>
      liveOverlaySourceGraphics().filter((each) => (each === element ? on : current.includes(each))),
    );
  return (
    <Dialog
      open
      title={`${label} link`}
      description="Choose the graphics this browser source draws, then copy its link into your production software."
      closeLabel={`Close ${label} link`}
      confirmLabel="Done"
      cancelLabel={null}
      onConfirm={onClose}
      onCancel={onClose}
    >
      <div class="pk-stack">
        <Field group label="Graphics">
          {() => (
            <div class="pk-stack pk-stack--snug">
              {CHOICES.map((each) => (
                <Radio
                  key={each.id}
                  name="graphics"
                  value={each.id}
                  label={each.label}
                  checked={choice === each.id}
                  onChange={() => setChoice(each.id)}
                />
              ))}
            </div>
          )}
        </Field>
        {choice === "all" ? null : (
          <Field group label={choice === "only" ? "Draw only" : "Leave out"}>
            {() => (
              <div class="pk-stack pk-stack--snug">
                {liveOverlaySourceGraphics().map((element) => (
                  <Checkbox
                    key={element}
                    name="graphic"
                    value={element}
                    label={LIVE_OVERLAY_ELEMENT_LABELS[element]}
                    checked={picked.includes(element)}
                    onChange={(event) => toggle(element, event.currentTarget.checked)}
                  />
                ))}
              </div>
            )}
          </Field>
        )}
        {choice === "all" ? null : (
          <Checkbox
            name="crop"
            label="Crop to the graphic"
            hint="Fits the page to the one graphic left, so you can place it yourself. Leave exactly one graphic to crop."
            checked={croppable && crop}
            disabled={!croppable}
            onChange={(event) => setCrop(event.currentTarget.checked)}
          />
        )}
        <CopyLinkRow label={`${label} link`} url={link(shown)} />
      </div>
    </Dialog>
  );
}
