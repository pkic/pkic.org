import type { FieldControlProps } from "../ui/Field";
import { Select } from "../ui/TextControl";

export interface EnumSelectOption<Value extends string> {
  value: Value;
  label: string;
}

export interface EnumSelectProps<Value extends string> extends FieldControlProps {
  value: Value;
  onChange: (value: Value) => void;
  options: ReadonlyArray<EnumSelectOption<Value>>;
  disabled?: boolean;
}

/**
 * A `<select>` driven by a fixed set of machine values paired with
 * human-readable labels — typically the options of a shared Zod enum. Use it
 * instead of a free-text input whenever a field's value must be one of a
 * closed, contract-defined vocabulary.
 *
 * It is a control, not a field: it renders inside the caller's `Field`, which
 * owns the label, the help text and any validation state, and hands down the
 * id and ARIA the control must carry. A control that rendered its own label
 * could not be composed where the label has to be elsewhere, and two
 * labelling paths is how forms end up with orphaned `for` attributes.
 */
export function EnumSelect<Value extends string>({
  value,
  onChange,
  options,
  disabled = false,
  ...control
}: EnumSelectProps<Value>) {
  return (
    <Select
      {...control}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange((event.target as HTMLSelectElement).value as Value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
