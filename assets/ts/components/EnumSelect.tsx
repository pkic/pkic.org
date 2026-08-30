export interface EnumSelectOption<Value extends string> {
  value: Value;
  label: string;
}

/**
 * Labeled `<select>` driven by a fixed set of machine values paired with
 * human-readable labels — typically the options of a shared Zod enum. Use
 * this instead of a free-text input whenever a field's value must be one of
 * a closed, contract-defined vocabulary.
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
  size = "sm",
}: {
  id: string;
  label: string;
  value: Value;
  onChange: (value: Value) => void;
  options: ReadonlyArray<EnumSelectOption<Value>>;
  disabled?: boolean;
  required?: boolean;
  help?: string;
  size?: "sm" | "md";
}) {
  const helpId = help ? `${id}-help` : undefined;
  return (
    <div>
      <label class="form-label small fw-semibold" for={id}>
        {label}
      </label>
      <select
        id={id}
        class={size === "sm" ? "form-select form-select-sm" : "form-select"}
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
      </select>
      {help && (
        <div id={helpId} class="form-text">
          {help}
        </div>
      )}
    </div>
  );
}
