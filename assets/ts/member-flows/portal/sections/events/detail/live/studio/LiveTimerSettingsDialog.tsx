import { useState } from "preact/hooks";
import type { LiveRoomClientMessage, LiveTimer } from "../../../../../../../../shared/schemas/live-session-room";
import {
  LIVE_TIMER_SOUND_PLACES,
  LIVE_TIMER_ZERO_ACTIONS,
  liveTimerAtZeroSchema,
  liveTimerResetsAtZero,
  liveTimerSettingsSchema,
  type LiveTimerSoundPlace,
  type LiveTimerZeroAction,
} from "../../../../../../../../shared/schemas/live-session-timer";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../../ui/Alert";
import { Checkbox } from "../../../../../../../ui/Checkbox";
import { Dialog } from "../../../../../../../ui/Dialog";
import { Field } from "../../../../../../../ui/Field";
import { FormSection } from "../../../../../../../ui/FormSection";
import { Select, TextInput } from "../../../../../../../ui/TextControl";

const ZERO_LABELS: Record<LiveTimerZeroAction, string> = {
  overtime: "Keep counting as overtime",
  stop: "Stop at zero",
  reset: "Reset to its full length",
};
const PLACE_LABELS: Record<LiveTimerSoundPlace, string> = { studio: "Studio", "stage-display": "Stage display" };

const seconds = (value: string) => (value.trim() ? Number(value) : null);

/**
 * One timer's settings: what it does at zero and where its sounds play. The
 * stage display plays a timer's sounds only while it shows that timer.
 */
export function LiveTimerSettingsDialog({
  timer,
  send,
  onClose,
}: {
  timer: LiveTimer;
  send: (message: LiveRoomClientMessage) => boolean;
  onClose: () => void;
}) {
  const [action, setAction] = useState(timer.atZero.action);
  const [resetAfter, setResetAfter] = useState(String(timer.atZero.resetAfterSeconds));
  const [restart, setRestart] = useState(timer.atZero.restart);
  const [places, setPlaces] = useState<readonly LiveTimerSoundPlace[]>(timer.sound.places);
  const [warning, setWarning] = useState(timer.sound.warningSeconds === null ? "" : String(timer.sound.warningSeconds));
  const [zero, setZero] = useState(timer.sound.zero);
  const [error, setError] = useState<string | null>(null);
  const body = {
    atZero: { action, resetAfterSeconds: seconds(resetAfter), restart },
    sound: { places, warningSeconds: seconds(warning), zero },
  };
  const form = useContractForm(liveTimerSettingsSchema, body);
  const actions = LIVE_TIMER_ZERO_ACTIONS.filter((option) => option !== "reset" || liveTimerResetsAtZero(timer.kind));
  return (
    <Dialog
      open
      title={`${timer.name} settings`}
      confirmLabel="Save"
      onCancel={onClose}
      onConfirm={() => {
        const checked = form.submit();
        if (!checked.data) return setError(checked.formMessage);
        if (!send({ type: "timer.configure", timerId: timer.id, settings: checked.data }))
          return setError("The control room is reconnecting. Try again when it is connected.");
        onClose();
      }}
    >
      <form noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => event.preventDefault()}>
        <FormSection title="At zero">
          <Field label="When it reaches zero" {...form.of("atZero.action")}>
            {(control) => (
              <Select
                {...control}
                name="atZero.action"
                value={action}
                onChange={(event) => setAction(liveTimerAtZeroSchema.shape.action.parse(event.currentTarget.value))}
              >
                {actions.map((option) => (
                  <option key={option} value={option}>
                    {ZERO_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {action === "reset" ? (
            <>
              <Field
                label="Reset after (seconds over)"
                help="Overtime shows this long first."
                {...form.of("atZero.resetAfterSeconds")}
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="atZero.resetAfterSeconds"
                    type="number"
                    min="0"
                    max="600"
                    inputMode="numeric"
                    value={resetAfter}
                    onInput={(event) => setResetAfter(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Checkbox
                name="atZero.restart"
                label="Start again right away"
                hint="Otherwise it waits at its full length for Start."
                checked={restart}
                onChange={(event) => setRestart(event.currentTarget.checked)}
              />
            </>
          ) : null}
        </FormSection>
        <FormSection title="Sounds" description="Off until you choose where they play.">
          <Field label="Play in" group {...form.of("sound.places")}>
            {() =>
              LIVE_TIMER_SOUND_PLACES.map((place) => (
                <Checkbox
                  key={place}
                  name="sound.places"
                  value={place}
                  label={PLACE_LABELS[place]}
                  hint={place === "stage-display" ? "While the stage display shows this timer." : undefined}
                  checked={places.includes(place)}
                  onChange={(event) => {
                    const on = event.currentTarget.checked;
                    setPlaces((current) =>
                      LIVE_TIMER_SOUND_PLACES.filter((entry) => (entry === place ? on : current.includes(entry))),
                    );
                  }}
                />
              ))
            }
          </Field>
          {places.length ? (
            <>
              <Field
                label="Chime at (seconds left)"
                help="Leave empty for no chime."
                {...form.of("sound.warningSeconds")}
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="sound.warningSeconds"
                    type="number"
                    min="1"
                    max="3600"
                    inputMode="numeric"
                    value={warning}
                    onInput={(event) => setWarning(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Checkbox
                name="sound.zero"
                label="Buzzer at zero"
                checked={zero}
                onChange={(event) => setZero(event.currentTarget.checked)}
              />
            </>
          ) : null}
        </FormSection>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </Dialog>
  );
}
