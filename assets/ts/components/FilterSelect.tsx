import { useId } from "preact/hooks";

import { Select } from "../ui/TextControl";

export interface FilterOption<Value extends string = string> {
  value: Value;
  label: string;
}

/**
 * Accessible, reusable select control for server-side collection filters.
 *
 * A filter that shows its name now gets a real `for`/`id` pair rather than a
 * floating word beside a control: the version this replaces rendered a bare
 * `<label>` that pointed at nothing and put the name in `aria-label` as well,
 * which is two competing names for one control. One that has no room for a
 * visible name still falls back to `ariaLabel` — and, because a toolbar of
 * anonymous filters is the same defect in a different shape, to a generic
 * name rather than to none at all.
 */
export function FilterSelect<Value extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  className,
}: {
  label?: string;
  ariaLabel?: string;
  value: Value;
  options: ReadonlyArray<FilterOption<Value>>;
  onChange: (value: Value) => void;
  className?: string;
}) {
  const selectId = useId();

  const select = (
    <Select
      id={label ? selectId : undefined}
      aria-label={label ? undefined : (ariaLabel ?? "Filter")}
      class={className}
      value={value}
      onChange={(event) => onChange((event.target as HTMLSelectElement).value as Value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );

  return label ? (
    <div class="pk-stack pk-stack--tight">
      <label class="pk-field__label" for={selectId}>
        {label}
      </label>
      {select}
    </div>
  ) : (
    select
  );
}
