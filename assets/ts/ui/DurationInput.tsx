/**
 * DurationInput — a length of time as hours, minutes and seconds, the way a
 * timer is set: three short number boxes in one row, `h : mm : ss`.
 *
 * Place it in a `Field` with `group`, so the field's name is the legend over
 * the three boxes and each box says which part it is. The value is whole
 * seconds; it is null while every box is empty or a part is out of range,
 * which the form's contract then names. A form on `useContractForm` passes
 * `durationFieldOf` as its `fieldOf`, so typing in any box marks that field.
 */
import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { FieldControlProps } from "./Field";
import { TextInput } from "./TextControl";
import "./DurationInput.css";

type Parts = { hours: string; minutes: string; seconds: string };

const split = (total: number | null): Parts =>
  total === null
    ? { hours: "", minutes: "", seconds: "" }
    : {
        hours: String(Math.floor(total / 3600)),
        minutes: String(Math.floor(total / 60) % 60).padStart(2, "0"),
        seconds: String(total % 60).padStart(2, "0"),
      };

function joined(parts: Parts, maxHours: number): number | null {
  if (!parts.hours.trim() && !parts.minutes.trim() && !parts.seconds.trim()) return null;
  const [hours = 0, minutes = 0, seconds = 0] = [parts.hours, parts.minutes, parts.seconds].map((part) =>
    part.trim() ? Number(part) : 0,
  );
  if (![parts.hours, parts.minutes, parts.seconds].every((part) => DIGITS.test(part.trim()))) return null;
  if (hours > maxHours || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/** For `useContractForm`'s `fieldOf`: every box answers the duration field it is named for. */
export const durationFieldOf = (name: string, control: HTMLElement): string => control.dataset.durationOf ?? name;

const PARTS = [
  { key: "hours", label: "Hours", max: null },
  { key: "minutes", label: "Minutes", max: 59 },
  { key: "seconds", label: "Seconds", max: 59 },
] as const;
const DIGITS = /^\d*$/u;

export function DurationInput({
  control,
  name,
  value,
  onChange,
  maxHours = 99,
  disabled,
}: {
  /** What the surrounding Field passes: its id goes to the hours box, its description to every box. */
  control: FieldControlProps;
  /** The contract path; the hours box carries it, so a refusal marks this field. */
  name: string;
  /** Whole seconds, or null for none. */
  value: number | null;
  onChange: (seconds: number | null) => void;
  maxHours?: number;
  disabled?: boolean;
}) {
  const [parts, setParts] = useState<Parts>(() => split(value));
  const reported = useRef(value);
  // A value set from outside (a reset, another operator) shows; the operator's own typing stays as typed.
  useEffect(() => {
    if (value !== reported.current) setParts(split(value));
    reported.current = value;
  }, [value]);
  const change = (key: keyof Parts, text: string) => {
    const next = { ...parts, [key]: text };
    setParts(next);
    reported.current = joined(next, maxHours);
    onChange(reported.current);
  };
  return (
    <span class="pk-duration-input">
      {PARTS.map((part, index) => (
        <Fragment key={part.key}>
          {index ? (
            <span class="pk-duration-input__separator" aria-hidden="true">
              :
            </span>
          ) : null}
          <TextInput
            {...(index === 0 ? { id: control.id, name } : { name: `${name}.${part.key}` })}
            data-duration-of={name}
            aria-label={part.label}
            aria-describedby={control["aria-describedby"]}
            aria-invalid={control["aria-invalid"]}
            class="pk-duration-input__part"
            inputMode="numeric"
            maxLength={part.max === null ? String(maxHours).length : 2}
            placeholder={index ? "00" : "0"}
            value={parts[part.key]}
            disabled={disabled}
            onInput={(event) => change(part.key, event.currentTarget.value)}
          />
        </Fragment>
      ))}
    </span>
  );
}
