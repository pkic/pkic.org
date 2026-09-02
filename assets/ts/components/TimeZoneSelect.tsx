import { useId } from "preact/hooks";

import type { FieldControlProps } from "../ui/Field";
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

export interface TimeZoneSelectProps extends FieldControlProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Searchable IANA time-zone input. Built on a native `<input>` plus
 * `<datalist>` instead of a long `<select>` so it stays keyboard- and
 * screen-reader-friendly while remaining filterable as the caller types.
 * The submitted value is always the raw IANA identifier the caller typed or
 * picked, per the repository's timezone rules — never an offset or label.
 *
 * It is a control, not a field: it renders inside the caller's `Field`, which
 * owns the label, the help text and the required marker, and hands down the
 * id and ARIA the control must carry.
 */
export function TimeZoneSelect({ value, onChange, disabled = false, ...control }: TimeZoneSelectProps) {
  const listId = `${useId()}-options`;
  return (
    <>
      <TextInput
        {...control}
        type="text"
        list={listId}
        value={value}
        disabled={disabled}
        placeholder="Europe/Amsterdam"
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
      />
      {/* The list renders nothing itself; it stays beside the input it
          belongs to rather than floating at the end of the field. */}
      <datalist id={listId}>
        {supportedTimeZones().map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
    </>
  );
}
