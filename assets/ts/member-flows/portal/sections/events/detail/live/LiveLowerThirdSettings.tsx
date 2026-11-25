import { useState } from "preact/hooks";
import { LIVE_LOWER_THIRD_MOTIONS, LIVE_LOWER_THIRD_MOTION_LABELS } from "../../../../../../../shared/live-lower-third";
import { liveCompositionInputSchema, type LiveStage } from "../../../../../../../shared/schemas/live-session-room";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Radio } from "../../../../../../ui/Checkbox";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import type { LiveTargets } from "./live-output-targets";
import { LIVE_SETTINGS_NOT_SENT } from "./live-graphic-settings";
import { Alert } from "../../../../../../ui/Alert";

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
  const [error, setError] = useState<string | null>(null);
  const form = useContractForm(lowerThirdMotionSchema, draft);
  // For someone who sets up the studio, the choice is also where every room of the event starts.
  const setup = targets.setup?.canSave ? targets.setup : undefined;
  return (
    <Dialog
      open
      title="Lower third"
      description={setup ? "Every room of the event starts with this choice." : undefined}
      confirmLabel="Save"
      onCancel={onClose}
      onConfirm={() => {
        const checked = form.submit();
        if (!checked.data) return;
        const composition = checked.data;
        void (
          setup ? setup.saveGraphic("lowerThird", { motion: composition.lowerThirdMotion }) : Promise.resolve(null)
        ).then((problem) => {
          if (problem) return setError(problem);
          if (!targets.sendProgram({ type: "preview.set", composition })) return setError(LIVE_SETTINGS_NOT_SENT);
          onClose();
        });
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
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </Dialog>
  );
}
