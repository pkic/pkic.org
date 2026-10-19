import { useId } from "preact/hooks";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import { formatClockName, formatDateRange } from "../../../../../../../shared/format-date";
import { contractClock } from "../../../../../../../shared/event-clock";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { SessionLocationFields } from "./SessionLocationFields";
import { wallClockReadback } from "./wall-clock-readback";

/**
 * Time and place are usually set by dragging on the agenda; this tab is the precise fallback.
 * The pickers offer only the event's own dates, which the agenda service also enforces.
 */
export function SessionScheduleFields({
  snapshot,
  start,
  end,
  onStart,
  onEnd,
  roomId,
  additionalRoomIds,
  globalAll,
  onLocations,
  of,
  disabled,
}: {
  snapshot: Pick<AgendaSnapshot, "timeZone" | "eventStartsAt" | "eventEndsAt" | "rooms">;
  start: string;
  end: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  roomId: string;
  additionalRoomIds: string[];
  globalAll: boolean;
  onLocations: (selected: string[]) => void;
  of: (name: string) => FieldPresentation;
  disabled: boolean;
}) {
  const helpId = `${useId()}-times`;
  const clock = contractClock(snapshot);
  const min = snapshot.eventStartsAt ? instantToDateTimeLocal(snapshot.eventStartsAt, snapshot.timeZone) : undefined;
  const max = snapshot.eventEndsAt ? instantToDateTimeLocal(snapshot.eventEndsAt, snapshot.timeZone) : undefined;
  const eventDates = snapshot.eventStartsAt
    ? `The event runs ${formatDateRange(snapshot.eventStartsAt, snapshot.eventEndsAt, snapshot.timeZone)}, on ${formatClockName(clock)}. `
    : `Times are ${formatClockName(clock)}. `;
  const readback = (value: string) => wallClockReadback(value, clock);
  const describedBy = (control: { "aria-describedby"?: string }) =>
    [control["aria-describedby"], helpId].filter(Boolean).join(" ");
  return (
    <fieldset disabled={disabled} class="pk-fieldset pk-agenda-editor__form">
      <Field label="Starts" help={readback(start)} {...of("startAt")}>
        {(control) => (
          <TextInput
            {...control}
            aria-describedby={describedBy(control)}
            name="startAt"
            type="datetime-local"
            min={min}
            max={max}
            value={start}
            onInput={(event) => onStart(event.currentTarget.value)}
          />
        )}
      </Field>
      <Field label="Ends" help={readback(end)} {...of("endAt")}>
        {(control) => (
          <TextInput
            {...control}
            aria-describedby={describedBy(control)}
            name="endAt"
            type="datetime-local"
            min={start || min}
            max={max}
            value={end}
            onInput={(event) => onEnd(event.currentTarget.value)}
          />
        )}
      </Field>
      <p id={helpId} class="pk-agenda-editor__notice pk-agenda-editor__form-wide">
        {eventDates}Leave the times empty to keep this session unscheduled.
      </p>
      <SessionLocationFields
        rooms={snapshot.rooms}
        roomId={roomId}
        additionalRoomIds={additionalRoomIds}
        globalAll={globalAll}
        of={of}
        onChange={onLocations}
      />
    </fieldset>
  );
}
