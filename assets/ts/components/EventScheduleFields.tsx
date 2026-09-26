/**
 * The start/end/timezone triple, as one row.
 *
 * Each control is a design-system `Field`, which owns the label, the required
 * marker and the control's id, so a caller reaches these controls through the
 * label that names them rather than through an id it had to choose.
 */
import type { FieldPresentation } from "../hooks/useContractForm";
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
  fields = () => ({}),
}: {
  startsAt: string;
  endsAt: string;
  timezone: string;
  onStartsAtChange: (value: string) => void;
  onEndsAtChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  timezonePlaceholder?: string;
  fields?: (name: string) => FieldPresentation;
}) {
  return (
    // Three columns where they fit, one where they do not — no breakpoint
    // classes, so the same markup serves a phone and a wide settings pane.
    <div class="pk-grid pk-grid--tight">
      <Field {...fields("startsAt")} label="Start date">
        {(control) => (
          <TextInput
            {...control}
            name="startsAt"
            type="datetime-local"
            value={startsAt}
            onInput={(event) => onStartsAtChange((event.target as HTMLInputElement).value)}
          />
        )}
      </Field>
      <Field {...fields("endsAt")} label="End date">
        {(control) => (
          <TextInput
            {...control}
            name="endsAt"
            type="datetime-local"
            value={endsAt}
            onInput={(event) => onEndsAtChange((event.target as HTMLInputElement).value)}
          />
        )}
      </Field>
      <Field {...fields("timezone")} label="Timezone" required>
        {(control) => (
          <TextInput
            {...control}
            name="timezone"
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
