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
    <div>
      <label class="form-label small fw-semibold" for={id}>
        {label}
      </label>
      <input
        id={id}
        class="form-control"
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
        <div id={helpId} class="form-text">
          {help}
        </div>
      )}
    </div>
  );
}
