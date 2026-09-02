/**
 * The start/end/timezone triple, as one row.
 *
 * Each control is a design-system `Field`, which owns the label, the required
 * marker and the control's id, so a caller reaches these controls through the
 * label that names them rather than through an id it had to choose.
 */
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";

export function EventScheduleFields({
  startsAt,
  endsAt,
  timezone,
  onStartsAtChange,
  onEndsAtChange,
  onTimezoneChange,
  timezonePlaceholder,
}: {
  startsAt: string;
  endsAt: string;
  timezone: string;
  onStartsAtChange: (value: string) => void;
  onEndsAtChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  timezonePlaceholder?: string;
}) {
  return (
    // Three columns where they fit, one where they do not — no breakpoint
    // classes, so the same markup serves a phone and a wide settings pane.
    <div class="pk-grid pk-grid--tight">
      <Field label="Start date">
        {(control) => (
          <TextInput
            {...control}
            type="datetime-local"
            value={startsAt}
            onInput={(event) => onStartsAtChange((event.target as HTMLInputElement).value)}
          />
        )}
      </Field>
      <Field label="End date">
        {(control) => (
          <TextInput
            {...control}
            type="datetime-local"
            value={endsAt}
            onInput={(event) => onEndsAtChange((event.target as HTMLInputElement).value)}
          />
        )}
      </Field>
      <Field label="Timezone" required>
        {(control) => (
          <TextInput
            {...control}
            type="text"
            value={timezone}
            onInput={(event) => onTimezoneChange((event.target as HTMLInputElement).value)}
            placeholder={timezonePlaceholder}
          />
        )}
      </Field>
    </div>
  );
}
