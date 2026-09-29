/**
 * When a form accepts responses — the two controls, wherever the window is set.
 *
 * The window is two optional instants stored in UTC. The controls are
 * `datetime-local`, which speaks a wall clock with no zone attached, so both
 * directions go through the shared timezone codec against the reader's own
 * zone: the browser shows and takes local time, the wire carries UTC, and the
 * conversion happens here and nowhere deeper. That is what #38 asks for in its
 * closing line.
 *
 * Written once because two surfaces set the same window — a group's own form
 * and the form an event has placed (#38) — and a window that converted
 * differently in the two would be a form that opened at the wrong hour
 * depending on where it was configured from.
 */
import type { JSX } from "preact";
import type { FieldPresentation } from "../../hooks/useContractForm";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";
import { isoDateTimeValue, localDateTimeValue } from "../../shared/ui";

/**
 * An empty control means "no bound", which the contract expresses as null. A
 * wall clock the codec refuses — a time that does not exist in this zone on
 * that day — is passed through unconverted so the contract, not a thrown
 * conversion, is what tells the reader the value is wrong.
 */
export function instantFromLocal(value: string, timeZone: string): string | null {
  if (!value) return null;
  try {
    return isoDateTimeValue(value, timeZone);
  } catch {
    return value;
  }
}

/** The stored instant as a wall clock the control can show, or empty for no bound. */
export function localFromInstant(value: string | null): string {
  return value ? localDateTimeValue(value) : "";
}

export function SubmissionWindowFields({
  timeZone,
  opensAt,
  closesAt,
  onChange,
  fieldProps,
}: {
  timeZone: string;
  opensAt: string;
  closesAt: string;
  onChange: (patch: { opensAt?: string; closesAt?: string }) => void;
  /**
   * The contract state for each control, from the caller's own form. Both
   * surfaces validate through the schema their route parses, and neither
   * decides here what a bad window looks like.
   */
  fieldProps: { opensAt: FieldPresentation; closesAt: FieldPresentation };
}): JSX.Element {
  return (
    <>
      <Field
        label="Opens"
        help={`Your time (${timeZone}). Leave empty to accept responses from now.`}
        {...fieldProps.opensAt}
      >
        {(control) => (
          <TextInput
            {...control}
            name="opensAt"
            type="datetime-local"
            value={opensAt}
            onInput={(event) => onChange({ opensAt: event.currentTarget.value })}
          />
        )}
      </Field>
      <Field
        label="Closes"
        help={`Your time (${timeZone}). Leave empty to keep the form open indefinitely.`}
        {...fieldProps.closesAt}
      >
        {(control) => (
          <TextInput
            {...control}
            name="closesAt"
            type="datetime-local"
            value={closesAt}
            onInput={(event) => onChange({ closesAt: event.currentTarget.value })}
          />
        )}
      </Field>
    </>
  );
}
