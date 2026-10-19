import { useState } from "preact/hooks";
import { LIVE_LOWER_THIRD_MOTIONS, LIVE_LOWER_THIRD_MOTION_LABELS } from "../../../../../../../shared/live-lower-third";
import { liveCompositionInputSchema, type LiveStage } from "../../../../../../../shared/schemas/live-session-room";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Radio } from "../../../../../../ui/Checkbox";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import type { LiveTargets } from "./live-output-targets";

const lowerThirdMotionSchema = liveCompositionInputSchema.pick({ lowerThirdMotion: true });
const MOTION_HINTS: Record<LiveStage["lowerThirdMotion"], string> = {
  animated: "The emblem rolls in and the name comes out of it.",
  cut: "Appears and disappears at once.",
};

/**
 * How lower thirds go on and off air, from the Speakers panel's menu. The
 * choice is made on Preview, goes to Program with a Take, and travels with
 * each lower third put on an output, so every output keeps its own. People's
 * cards put the lower thirds themselves on air.
 */
export function LiveLowerThirdSettings({ targets, onClose }: { targets: LiveTargets; onClose: () => void }) {
  const [draft, setDraft] = useState({ lowerThirdMotion: targets.state.preview.lowerThirdMotion });
  const form = useContractForm(lowerThirdMotionSchema, draft);
  return (
    <Dialog
      open
      title="Lower third"
      confirmLabel="Save"
      onCancel={onClose}
      onConfirm={() => {
        const checked = form.submit();
        if (checked.data && targets.sendProgram({ type: "preview.set", composition: checked.data })) onClose();
      }}
    >
      <form noValidate {...form.handlers} onSubmit={(event) => event.preventDefault()}>
        <Field
          label="On and off air"
          group
          help="Every lower third you put on air from now on goes on and off this way."
          {...form.of("lowerThirdMotion")}
        >
          {(control) => (
            <div class="pk-stack" aria-describedby={control["aria-describedby"]}>
              {LIVE_LOWER_THIRD_MOTIONS.map((choice) => (
                <Radio
                  key={choice}
                  name="lowerThirdMotion"
                  value={choice}
                  checked={draft.lowerThirdMotion === choice}
                  label={LIVE_LOWER_THIRD_MOTION_LABELS[choice]}
                  hint={MOTION_HINTS[choice]}
                  onChange={() => setDraft({ lowerThirdMotion: choice })}
                />
              ))}
            </div>
          )}
        </Field>
      </form>
    </Dialog>
  );
}
