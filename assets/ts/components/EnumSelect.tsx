import { Select } from "../ui/TextControl";

export interface EnumSelectOption<Value extends string> {
  value: Value;
  label: string;
}

/**
 * Labeled `<select>` driven by a fixed set of machine values paired with
 * human-readable labels — typically the options of a shared Zod enum. Use
 * this instead of a free-text input whenever a field's value must be one of
 * a closed, contract-defined vocabulary.
 *
 * The caller supplies the control's `id`, which is why the label is written
 * here rather than delegated to `ui/Field`: `Field` generates the id itself,
 * and two sources for one id is how a `for` attribute ends up pointing at
 * nothing. It is the same pattern the migrated email-template and campaign
 * editors use — the system's `pk-field` parts around a control whose id the
 * surface owns.
 */
export function EnumSelect<Value extends string>({
  id,
  label,
  value,
  onChange,
  options,
  disabled = false,
  required = false,
  help,
}: {
  id: string;
  label: string;
  value: Value;
  onChange: (value: Value) => void;
  options: ReadonlyArray<EnumSelectOption<Value>>;
  disabled?: boolean;
  required?: boolean;
  help?: string;
}) {
  const helpId = help ? `${id}-help` : undefined;
  return (
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
      <Select
        id={id}
        value={value}
        disabled={disabled}
        required={required}
        aria-describedby={helpId}
        onChange={(event) => onChange((event.target as HTMLSelectElement).value as Value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {help && (
        <p id={helpId} class="pk-field__help">
          {help}
        </p>
      )}
    </div>
  );
}
