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
  LIVE_TIMER_ZERO_ACTIONS,
  liveTimerAtZeroSchema,
  liveTimerEditSchema,
  liveTimerGraphicSchema,
  liveTimerResetsAtZero,
  liveTimerSettingsSchema,
  type LiveTimerEdit,
  type LiveTimerGraphic,
  type LiveTimerZeroAction,
} from "../../../../../../../../shared/schemas/live-session-timer";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { LiveClockContext } from "../../../../../../../live-session/useLiveCountdown";
import { Alert } from "../../../../../../../ui/Alert";
import { Checkbox } from "../../../../../../../ui/Checkbox";
import { Dialog } from "../../../../../../../ui/Dialog";
import { DurationInput } from "../../../../../../../ui/DurationInput";
import { Field } from "../../../../../../../ui/Field";
import { FormSection } from "../../../../../../../ui/FormSection";
import { Select, TextInput } from "../../../../../../../ui/TextControl";
import { LiveTimerLookFields } from "../LiveTimerGraphicControls";
import "./LiveTimerDialog.css";
import { liveTimerTargetInstant } from "./LiveTimerAddForm";

const ZERO_LABELS: Record<LiveTimerZeroAction, string> = {
  overtime: "Keep counting as overtime",
  stop: "Stop at zero",
  reset: "Reset to its full length",
};

/** Everything the dialog saves, checked as one: the timer itself, what it does at zero and its sounds, its look. */
const timerDialogSchema = z.object({
  edit: liveTimerEditSchema,
  settings: liveTimerSettingsSchema,
  graphic: liveTimerGraphicSchema,
});

const seconds = (value: string) => (value.trim() ? Number(value) : null);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
/** The current value with only the fields this operator changed since opening laid over it. */
function mineOver<Value extends object>(opened: Value, mine: Value, current: Value): Value {
  const changed = Object.entries(mine).filter(([key, value]) => !same(value, opened[key as keyof Value]));
  return { ...current, ...Object.fromEntries(changed) };
}
const RECONNECTING = "The control room is reconnecting or busy. Try again when it is connected.";

/**
 * One timer's settings in one place, in two columns on a wide screen: its
 * name and length (or the time it counts to), when it warns and whether a
 * chime and a buzzer sound on the feeds that show it, what it does at zero,
 * and how it looks. Saving sends only what changed.
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
  // What the timer was when the dialog opened: only what this operator changed from it is sent, so a change
  // another operator makes meanwhile is kept.
  const [opened] = useState(() => ({ timer, graphic }));
  const shownTime = opened.timer.targetAt ? format24HourClockInZone(Date.parse(opened.timer.targetAt), clock) : "";
  const [name, setName] = useState(timer.name);
  const [length, setLength] = useState<number | null>(timer.durationSeconds);
  const [time, setTime] = useState(shownTime);
  const [warning, setWarning] = useState(String(graphic.warningSeconds));
  const [overrun, setOverrun] = useState(String(graphic.overrunSeconds));
  const [chime, setChime] = useState(timer.sound.warningSeconds !== null);
  const [zero, setZero] = useState(timer.sound.zero);
  const [action, setAction] = useState(timer.atZero.action);
  const [resetAfter, setResetAfter] = useState(String(timer.atZero.resetAfterSeconds));
  const [restart, setRestart] = useState(timer.atZero.restart);
  const [look, setLook] = useState(graphic);
  const [error, setError] = useState<string | null>(null);
  const warnAt = seconds(warning);
  const edit: Record<string, unknown> = { name };
  if (timer.kind === "duration") edit.durationSeconds = length;
  // An unchanged time keeps the stored instant; a new one keeps the date the timer counts to.
  if (timer.kind === "until" && time !== shownTime)
    edit.targetAt = liveTimerTargetInstant(time, { startAt: opened.timer.targetAt ?? session.startAt }, zone);
  const body = {
    edit,
    settings: {
      atZero: {
        action,
        // The delay only shows for reset; a cleared hidden field keeps the stored value.
        resetAfterSeconds: action === "reset" ? seconds(resetAfter) : timer.atZero.resetAfterSeconds,
        restart,
      },
      // The chime sounds when the time turns amber.
      sound: { warningSeconds: chime ? warnAt : null, zero },
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
      ...(next.edit.name !== opened.timer.name ? { name: next.edit.name } : {}),
      ...(next.edit.durationSeconds !== undefined && next.edit.durationSeconds !== opened.timer.durationSeconds
        ? { durationSeconds: next.edit.durationSeconds }
        : {}),
      ...(next.edit.targetAt !== undefined ? { targetAt: next.edit.targetAt } : {}),
    };
    if (Object.keys(patch).length && !send({ type: "timer.edit", timerId: timer.id, edit: patch }))
      return setError(RECONNECTING);
    const settings = {
      atZero: mineOver(opened.timer.atZero, next.settings.atZero, timer.atZero),
      sound: mineOver(opened.timer.sound, next.settings.sound, timer.sound),
    };
    if (
      settable &&
      !same(settings, { atZero: timer.atZero, sound: timer.sound }) &&
      !send({ type: "timer.configure", timerId: timer.id, settings })
    )
      return setError(RECONNECTING);
    const shown = mineOver(opened.graphic, next.graphic, graphic);
    if (!same(shown, graphic) && !saveGraphic(shown)) return setError(RECONNECTING);
    onClose();
  };

  return (
    <Dialog open size="wide" title="Timer settings" confirmLabel="Save" onCancel={onClose} onConfirm={save}>
      <form noValidate {...form.handlers} class="pk-timer-settings" onSubmit={(event) => event.preventDefault()}>
        <div class="pk-stack">
          <FormSection>
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
                label="Length"
                help="Once it has begun, the time left moves by the difference."
                group
                {...form.of("edit.durationSeconds")}
              >
                {(control) => (
                  <DurationInput control={control} name="edit.durationSeconds" value={length} onChange={setLength} />
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
        </div>
        <div class="pk-stack">
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
        </div>
      </form>
    </Dialog>
  );
}
