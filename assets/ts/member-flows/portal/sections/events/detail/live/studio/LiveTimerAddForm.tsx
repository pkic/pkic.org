import { useState } from "preact/hooks";
import type { ClockZone } from "../../../../../../../../shared/event-clock";
import { clockTimeZone } from "../../../../../../../../shared/event-clock";
import { formatClockName } from "../../../../../../../../shared/format-date";
import { LIVE_TIMER_KIND_LABELS } from "../../../../../../../../shared/live-timer-policy";
import type { LiveRoomClientMessage, LiveRoomSession } from "../../../../../../../../shared/schemas/live-session-room";
import {
  LIVE_TIMER_KINDS,
  LIVE_TIMER_MAX_MS,
  liveTimerDraftSchema,
  type LiveTimerKind,
} from "../../../../../../../../shared/schemas/live-session-timer";
import { dateTimeLocalToIso, instantToCalendarDate } from "../../../../../../../../shared/timezone";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { Button } from "../../../../../../../ui/Button";
import { Field } from "../../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../../ui/TextControl";

/** A time of day on the event's clock, on the session's own day, as the UTC instant the room keeps. */
function targetInstant(time: string, session: Pick<LiveRoomSession, "startAt">, zone: string): string | null {
  if (!/^\d{2}:\d{2}$/u.test(time)) return null;
  try {
    return dateTimeLocalToIso(`${instantToCalendarDate(session.startAt, zone)}T${time}`, zone);
  } catch {
    // A wall-clock time that does not exist in the zone, such as one skipped at a clock change.
    return null;
  }
}

/** The short form that adds a timer: a name, its kind and the one value that kind needs. */
export function LiveTimerAddForm({
  session,
  clock,
  disabled,
  send,
  onAdded,
}: {
  /** Called once the timer was sent, so a dialog around the form can close. */
  onAdded?: () => void;
  session: Pick<LiveRoomSession, "startAt">;
  clock: ClockZone;
  disabled: boolean;
  send: (message: LiveRoomClientMessage) => boolean;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LiveTimerKind>("duration");
  const [time, setTime] = useState("");
  const [minutes, setMinutes] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const zone = clockTimeZone(clock);
  const draft = {
    name,
    kind,
    targetAt: kind === "until" ? targetInstant(time, session, zone) : null,
    durationSeconds: kind === "duration" && minutes.trim() ? Math.round(Number(minutes) * 60) : null,
  };
  const form = useContractForm(liveTimerDraftSchema, draft);
  const add = () => {
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage);
    if (!send({ type: "timer.add", timer: checked.data }))
      return setError("The control room is reconnecting. Try again when it is connected.");
    setError(null);
    setName("");
    form.reset();
    onAdded?.();
  };
  return (
    <form
      noValidate
      {...form.handlers}
      class="pk-studio-time__add"
      aria-label="Add a timer"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <Field label="Timer name" {...form.of("name")}>
        {(control) => (
          <TextInput
            {...control}
            name="name"
            value={name}
            placeholder="Q&A"
            disabled={disabled}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        )}
      </Field>
      <Field label="Counts" {...form.of("kind")}>
        {(control) => (
          <Select
            {...control}
            name="kind"
            value={kind}
            disabled={disabled}
            onChange={(event) => setKind(liveTimerDraftSchema.shape.kind.parse(event.currentTarget.value))}
          >
            {LIVE_TIMER_KINDS.map((option) => (
              <option key={option} value={option}>
                {LIVE_TIMER_KIND_LABELS[option]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {kind === "until" ? (
        <Field label={`Ends at (${formatClockName(clock)})`} {...form.of("targetAt")}>
          {(control) => (
            <TextInput
              {...control}
              name="targetAt"
              type="time"
              value={time}
              disabled={disabled}
              onInput={(event) => setTime(event.currentTarget.value)}
            />
          )}
        </Field>
      ) : null}
      {kind === "duration" ? (
        <Field label="Minutes" {...form.of("durationSeconds")}>
          {(control) => (
            <TextInput
              {...control}
              name="durationSeconds"
              type="number"
              min="1"
              max={String(LIVE_TIMER_MAX_MS / 60000)}
              inputMode="numeric"
              value={minutes}
              disabled={disabled}
              onInput={(event) => setMinutes(event.currentTarget.value)}
            />
          )}
        </Field>
      ) : null}
      <Button type="submit" disabled={disabled}>
        Add timer
      </Button>
      {error ? (
        <p class="pk-studio-time__error" role="status">
          {error}
        </p>
      ) : null}
    </form>
  );
}
