import { TextInput } from "../ui/TextControl";

/** Falls back to a small, always-valid set when the runtime cannot enumerate IANA zones. */
const FALLBACK_TIME_ZONES = ["UTC", "Europe/Amsterdam", "America/New_York", "Asia/Singapore"] as const;

function supportedTimeZones(): readonly string[] {
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      // fall through to the static fallback below
    }
  }
  return FALLBACK_TIME_ZONES;
}

/**
 * Searchable IANA time-zone input. Built on a native `<input>` plus
 * `<datalist>` instead of a long `<select>` so it stays keyboard- and
 * screen-reader-friendly while remaining filterable as the caller types.
 * The submitted value is always the raw IANA identifier the caller typed or
 * picked, per the repository's timezone rules — never an offset or label.
 */
export function TimeZoneSelect({
  id,
  label,
  value,
  onChange,
  disabled = false,
  required = true,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  help?: string;
}) {
  const listId = `${id}-options`;
  const helpId = help ? `${id}-help` : undefined;
  return (
    // The caller supplies the control's `id`, which is why the label is
    // written here rather than delegated to `ui/Field`: `Field` generates the
    // id itself, and two sources for one id is how a `for` attribute ends up
    // pointing at nothing. Same shape as `EnumSelect` and `EventScheduleFields`.
    <div class="pk-stack pk-stack--tight">
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
      <TextInput
        id={id}
        type="text"
        list={listId}
        value={value}
        required={required}
        disabled={disabled}
        aria-describedby={helpId}
        placeholder="Europe/Amsterdam"
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
      />
      <datalist id={listId}>
        {supportedTimeZones().map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      {help && (
        <p id={helpId} class="pk-field__help">
          {help}
        </p>
      )}
    </div>
  );
}
