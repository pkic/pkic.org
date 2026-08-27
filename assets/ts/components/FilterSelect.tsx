export interface FilterOption<Value extends string = string> {
  value: Value;
  label: string;
}

/** Accessible, reusable select control for server-side collection filters. */
export function FilterSelect<Value extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  className = "form-select form-select-sm",
}: {
  label?: string;
  ariaLabel?: string;
  value: Value;
  options: ReadonlyArray<FilterOption<Value>>;
  onChange: (value: Value) => void;
  className?: string;
}) {
  const select = (
    <select
      aria-label={ariaLabel ?? label}
      class={className}
      value={value}
      onChange={(event) => onChange((event.target as HTMLSelectElement).value as Value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  return label ? (
    <div>
      <label class="form-label small mb-1">{label}</label>
      {select}
    </div>
  ) : (
    select
  );
}
