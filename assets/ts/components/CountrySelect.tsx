import { useEffect, useId, useMemo, useState } from "preact/hooks";

import { countryName, countryOptions, isCountryCode } from "../../shared/countries";
import type { FieldControlProps } from "../ui/Field";
import { TextInput } from "../ui/TextControl";

export interface CountrySelectProps extends FieldControlProps {
  name?: string;
  /** The chosen ISO 3166-1 alpha-2 code, or whatever the reader typed that names no country yet. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Searchable country input: the reader types or picks a country's name, in
 * their own language, and the caller receives its ISO 3166-1 alpha-2 code.
 * Text that names no country is handed on unchanged, so the caller's shared
 * contract, not this control, says it is not a country.
 *
 * Built like `TimeZoneSelect`: a native `<input>` with a `<datalist>`, which
 * filters as the reader types and stays keyboard- and screen-reader-friendly.
 * It is a control, not a field: the caller's `Field` owns the label and the
 * message, and hands down the id and ARIA this input carries.
 */
export function CountrySelect({ value, onChange, disabled = false, ...control }: CountrySelectProps) {
  const listId = `${useId()}-options`;
  const options = useMemo(() => countryOptions(), []);
  const labelFor = (code: string) => (isCountryCode(code) ? countryName(code) : code);
  const [text, setText] = useState(() => labelFor(value));

  // A reset or a saved event replaces the value from outside; show its name.
  useEffect(() => {
    if (isCountryCode(value) && labelFor(value) !== text) setText(labelFor(value));
    if (!value && text) setText("");
  }, [value]);

  function choose(typed: string) {
    setText(typed);
    const wanted = typed.trim().toLocaleLowerCase();
    const match = options.find((option) => option.label.toLocaleLowerCase() === wanted);
    onChange(match?.value ?? typed.trim());
  }

  return (
    <>
      <TextInput
        {...control}
        type="text"
        list={listId}
        value={text}
        disabled={disabled}
        autoComplete="country-name"
        onInput={(event) => choose((event.target as HTMLInputElement).value)}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.value} value={option.label} />
        ))}
      </datalist>
    </>
  );
}
