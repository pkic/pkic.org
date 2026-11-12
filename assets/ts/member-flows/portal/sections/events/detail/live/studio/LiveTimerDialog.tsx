import { useContext, useState } from "preact/hooks";
import { z } from "zod";
import type { ClockZone } from "../../../../../../../../shared/event-clock";
import { clockTimeZone } from "../../../../../../../../shared/event-clock";
import { format24HourClockInZone, formatClockName } from "../../../../../../../../shared/format-date";
import { liveTimerHasSettings } from "../../../../../../../../shared/live-timer-policy";
import type {
  LiveRoomClientMessage,
  LiveRoomSession,
  LiveTimer,
} from "../../../../../../../../shared/schemas/live-session-room";
import {
  LIVE_TIMER_MAX_MS,
  LIVE_TIMER_SOUND_PLACES,
  LIVE_TIMER_ZERO_ACTIONS,
  liveTimerAtZeroSchema,
  liveTimerEditSchema,
  liveTimerGraphicSchema,
  liveTimerResetsAtZero,
  liveTimerSettingsSchema,
  type LiveTimerEdit,
  type LiveTimerGraphic,
  type LiveTimerSoundPlace,
  type LiveTimerZeroAction,
} from "../../../../../../../../shared/schemas/live-session-timer";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { LiveClockContext } from "../../../../../../../live-session/useLiveCountdown";
import { Alert } from "../../../../../../../ui/Alert";
import { Checkbox } from "../../../../../../../ui/Checkbox";
import { Dialog } from "../../../../../../../ui/Dialog";
import { Field } from "../../../../../../../ui/Field";
import { FormSection } from "../../../../../../../ui/FormSection";
import { Select, TextInput } from "../../../../../../../ui/TextControl";
import { LiveTimerLookFields } from "../LiveTimerGraphicControls";
import { liveTimerTargetInstant } from "./LiveTimerAddForm";

const ZERO_LABELS: Record<LiveTimerZeroAction, string> = {
  overtime: "Keep counting as overtime",
  stop: "Stop at zero",
  reset: "Reset to its full length",
};
const PLACE_LABELS: Record<LiveTimerSoundPlace, { label: string; hint: string }> = {
  outputs: {
    label: "Where the timer shows",
    hint: "Program and the livestream, the stage display, projectors and screens, while they show this timer.",
  },
  studio: { label: "Studio", hint: "This control room, for the operators." },
};

/** Everything the dialog saves, checked as one: the timer itself, what it does at zero and its sounds, its look. */
const timerDialogSchema = z.object({
  edit: liveTimerEditSchema,
  settings: liveTimerSettingsSchema,
  graphic: liveTimerGraphicSchema,
});

const seconds = (value: string) => (value.trim() ? Number(value) : null);
const RECONNECTING = "The control room is reconnecting or busy. Try again when it is connected.";

/**
 * One timer's settings in one place: its name and length (or the time it
 * counts to), when it warns and whether a chime and a buzzer sound, where
 * they play, what it does at zero, and how it looks on every output. Saving
 * sends only what changed.
 */
export function LiveTimerDialog({
  timer,
  session,
  clock,
  graphic,
  send,
  saveGraphic,
  onClose,
}: {
  timer: LiveTimer;
  session: Pick<LiveRoomSession, "startAt">;
  clock: ClockZone;
  graphic: LiveTimerGraphic;
  send: (message: LiveRoomClientMessage) => boolean;
  /** Whether the graphic reached every output that shows it. */
  saveGraphic: (graphic: LiveTimerGraphic) => boolean;
  onClose: () => void;
}) {
  const now = useContext(LiveClockContext);
  const zone = clockTimeZone(clock);
  const counts = timer.kind !== "clock";
  const settable = liveTimerHasSettings(timer);
  const shownTime = timer.targetAt ? format24HourClockInZone(Date.parse(timer.targetAt), clock) : "";
  const [name, setName] = useState(timer.name);
  const [minutes, setMinutes] = useState(timer.durationSeconds ? String(timer.durationSeconds / 60) : "");
  const [time, setTime] = useState(shownTime);
  const [warning, setWarning] = useState(String(graphic.warningSeconds));
  const [overrun, setOverrun] = useState(String(graphic.overrunSeconds));
  const [chime, setChime] = useState(timer.sound.warningSeconds !== null);
  const [zero, setZero] = useState(timer.sound.zero);
  const [places, setPlaces] = useState<readonly LiveTimerSoundPlace[]>(timer.sound.places);
  const [action, setAction] = useState(timer.atZero.action);
  const [resetAfter, setResetAfter] = useState(String(timer.atZero.resetAfterSeconds));
  const [restart, setRestart] = useState(timer.atZero.restart);
  const [look, setLook] = useState(graphic);
  const [error, setError] = useState<string | null>(null);
  const warnAt = seconds(warning);
  const edit: Record<string, unknown> = { name };
  if (timer.kind === "duration") edit.durationSeconds = minutes.trim() ? Math.round(Number(minutes) * 60) : null;
  // An unchanged time keeps the stored instant, seconds and all.
  if (timer.kind === "until" && time !== shownTime) edit.targetAt = liveTimerTargetInstant(time, session, zone);
  const body = {
    edit,
    settings: {
      atZero: {
        action,
        // The delay only shows for reset; a cleared hidden field keeps the stored value.
        resetAfterSeconds: action === "reset" ? seconds(resetAfter) : timer.atZero.resetAfterSeconds,
        restart,
      },
      // The chime sounds when the time turns amber; a timer saved before keeps its chime until the warning changes.
      sound: {
        places,
        warningSeconds: chime
          ? warning === String(graphic.warningSeconds) && timer.sound.warningSeconds !== null
            ? timer.sound.warningSeconds
            : warnAt
          : null,
        zero,
      },
    },
    graphic: { ...look, warningSeconds: warnAt, overrunSeconds: seconds(overrun) },
  };
  const form = useContractForm(timerDialogSchema, body);
  const actions = LIVE_TIMER_ZERO_ACTIONS.filter((option) => option !== "reset" || liveTimerResetsAtZero(timer.kind));

  const save = () => {
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage);
    const next = checked.data;
    if (next.edit.targetAt && Date.parse(next.edit.targetAt) <= now())
      return setError("Choose a time that is still ahead.");
    const patch: LiveTimerEdit = {
      ...(next.edit.name !== timer.name ? { name: next.edit.name } : {}),
      ...(next.edit.durationSeconds !== undefined && next.edit.durationSeconds !== timer.durationSeconds
        ? { durationSeconds: next.edit.durationSeconds }
        : {}),
      ...(next.edit.targetAt !== undefined ? { targetAt: next.edit.targetAt } : {}),
    };
    if (Object.keys(patch).length && !send({ type: "timer.edit", timerId: timer.id, edit: patch }))
      return setError(RECONNECTING);
    const settingsChanged =
      JSON.stringify(next.settings) !== JSON.stringify({ atZero: timer.atZero, sound: timer.sound });
    if (settable && settingsChanged && !send({ type: "timer.configure", timerId: timer.id, settings: next.settings }))
      return setError(RECONNECTING);
    if (JSON.stringify(next.graphic) !== JSON.stringify(graphic) && !saveGraphic(next.graphic))
      return setError(RECONNECTING);
    onClose();
  };

  return (
    <Dialog open title={`${timer.name} settings`} confirmLabel="Save" onCancel={onClose} onConfirm={save}>
      <form noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => event.preventDefault()}>
        <FormSection title="Timer">
          <Field label="Name" {...form.of("edit.name")}>
            {(control) => (
              <TextInput
                {...control}
                name="edit.name"
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            )}
          </Field>
          {timer.kind === "duration" ? (
            <Field
              label="Minutes"
              help="Once it has begun, the time left moves by the difference."
              {...form.of("edit.durationSeconds")}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="edit.durationSeconds"
                  type="number"
                  min="1"
                  max={String(LIVE_TIMER_MAX_MS / 60000)}
                  inputMode="numeric"
                  value={minutes}
                  onInput={(event) => setMinutes(event.currentTarget.value)}
                />
              )}
            </Field>
          ) : null}
          {timer.kind === "until" ? (
            <Field label={`Ends at (${formatClockName(clock)})`} {...form.of("edit.targetAt")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="edit.targetAt"
                  type="time"
                  value={time}
                  onInput={(event) => setTime(event.currentTarget.value)}
                />
              )}
            </Field>
          ) : null}
        </FormSection>
        {counts ? (
          <FormSection
            title="Warning and sounds"
            description="The time turns amber at the warning and red once it runs over."
          >
            <div class="pk-cluster">
              <Field label="Warn at (seconds left)" {...form.of("graphic.warningSeconds")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="graphic.warningSeconds"
                    type="number"
                    min="0"
                    max="3600"
                    inputMode="numeric"
                    value={warning}
                    onInput={(event) => setWarning(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field label="Red after (seconds over)" {...form.of("graphic.overrunSeconds")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="graphic.overrunSeconds"
                    type="number"
                    min="0"
                    max="3600"
                    inputMode="numeric"
                    value={overrun}
                    onInput={(event) => setOverrun(event.currentTarget.value)}
                  />
                )}
              </Field>
            </div>
            {settable ? (
              <>
                <Checkbox
                  name="settings.sound.chime"
                  label="Chime at the warning"
                  checked={chime}
                  onChange={(event) => setChime(event.currentTarget.checked)}
                />
                <Checkbox
                  name="settings.sound.zero"
                  label="Buzzer at zero"
                  checked={zero}
                  onChange={(event) => setZero(event.currentTarget.checked)}
                />
                <Field
                  label="Play the sounds"
                  help="Silent until you choose where."
                  group
                  {...form.of("settings.sound.places")}
                >
                  {() => (
                    <div class="pk-stack pk-stack--snug">
                      {LIVE_TIMER_SOUND_PLACES.map((place) => (
                        <Checkbox
                          key={place}
                          name="settings.sound.places"
                          value={place}
                          label={PLACE_LABELS[place].label}
                          hint={PLACE_LABELS[place].hint}
                          checked={places.includes(place)}
                          onChange={(event) => {
                            const on = event.currentTarget.checked;
                            setPlaces((current) =>
                              LIVE_TIMER_SOUND_PLACES.filter((entry) =>
                                entry === place ? on : current.includes(entry),
                              ),
                            );
                          }}
                        />
                      ))}
                    </div>
                  )}
                </Field>
              </>
            ) : null}
          </FormSection>
        ) : null}
        {settable ? (
          <FormSection title="At zero">
            <Field label="When it reaches zero" {...form.of("settings.atZero.action")}>
              {(control) => (
                <Select
                  {...control}
                  name="settings.atZero.action"
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
                  {...form.of("settings.atZero.resetAfterSeconds")}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      name="settings.atZero.resetAfterSeconds"
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
                  name="settings.atZero.restart"
                  label="Start again right away"
                  hint="Otherwise it waits at its full length for Start."
                  checked={restart}
                  onChange={(event) => setRestart(event.currentTarget.checked)}
                />
              </>
            ) : null}
          </FormSection>
        ) : null}
        <FormSection title="Look" description="How the timer shows on Program, the stage display and the screens.">
          <LiveTimerLookFields
            draft={look}
            timerName={name || timer.name}
            counts={counts}
            of={(field) => form.of(`graphic.${field}`)}
            update={(key, value) => setLook((previous) => ({ ...previous, [key]: value }))}
          />
        </FormSection>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </Dialog>
  );
}
