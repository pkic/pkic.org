/**
 * The start/end/timezone triple, as one row.
 *
 * The label is written here rather than delegated to `ui/Field` because the
 * caller owns the control's `id` — every consumer passes an `idPrefix` and
 * addresses these controls by it — and `Field` generates its own with
 * `useId`. Two sources for one id is how a `for` attribute ends up pointing
 * at nothing, so this follows `EnumSelect`: the system's `pk-field` parts
 * around a control whose id the surface owns.
 */
import type { ComponentChildren } from "preact";

import { TextInput } from "../ui/TextControl";

function ScheduleField({
  id,
  label,
  required = false,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: ComponentChildren;
}) {
  return (
    <div class="pk-field">
      <label class="pk-field__label" for={id}>
        {label}
        {required && (
          // The asterisk is decorative; the word behind it is what a screen
          // reader announces. Same split as `ui/Field`'s required marker.
          <span class="pk-field__required">
            <span aria-hidden="true">*</span>
            <span class="pk-field__sr">(required)</span>
          </span>
        )}
      </label>
      {/* The box the state mark is positioned against. Without it a date that
          fails validation colours its border and has nowhere to draw the ✕. */}
      <div class="pk-field__control">{children}</div>
    </div>
  );
}

export function EventScheduleFields({
  startsAt,
  endsAt,
  timezone,
  onStartsAtChange,
  onEndsAtChange,
  onTimezoneChange,
  timezonePlaceholder,
  idPrefix = "event-schedule",
}: {
  startsAt: string;
  endsAt: string;
  timezone: string;
  onStartsAtChange: (value: string) => void;
  onEndsAtChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  timezonePlaceholder?: string;
  idPrefix?: string;
}) {
  const startId = `${idPrefix}-starts-at`;
  const endId = `${idPrefix}-ends-at`;
  const timezoneId = `${idPrefix}-timezone`;
  return (
    // Three columns where they fit, one where they do not — no breakpoint
    // classes, so the same markup serves a phone and a wide settings pane.
    <div class="pk-grid pk-grid--tight">
      <ScheduleField id={startId} label="Start date">
        <TextInput
          id={startId}
          type="datetime-local"
          value={startsAt}
          onInput={(event) => onStartsAtChange((event.target as HTMLInputElement).value)}
        />
      </ScheduleField>
      <ScheduleField id={endId} label="End date">
        <TextInput
          id={endId}
          type="datetime-local"
          value={endsAt}
          onInput={(event) => onEndsAtChange((event.target as HTMLInputElement).value)}
        />
      </ScheduleField>
      <ScheduleField id={timezoneId} label="Timezone" required>
        <TextInput
          id={timezoneId}
          type="text"
          value={timezone}
          onInput={(event) => onTimezoneChange((event.target as HTMLInputElement).value)}
          placeholder={timezonePlaceholder}
          required
        />
      </ScheduleField>
    </div>
  );
}
