import { Field } from "../ui/Field";
import { Select } from "../ui/TextControl";

export interface FilterOption<Value extends string = string> {
  value: Value;
  label: string;
}

/**
 * Accessible, reusable select control for server-side collection filters.
 *
 * A filter that shows its name is a `Field` rather than a hand-copied
 * imitation of one: the label, the control box and the state the group can
 * carry are a single unit, and the id this component used to generate is the
 * one `Field` now hands down. The version before that rendered a bare
 * `<label>` that pointed at nothing and put the name in `aria-label` as well,
 * which is two competing names for one control. A filter with no room for a
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
  const choices = options.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));

  function handleChange(event: Event): void {
    onChange((event.target as HTMLSelectElement).value as Value);
  }

  if (!label) {
    return (
      <Select aria-label={ariaLabel ?? "Filter"} class={className} value={value} onChange={handleChange}>
        {choices}
      </Select>
    );
  }

  return (
    <Field label={label}>
      {(control) => (
        <Select {...control} class={className} value={value} onChange={handleChange}>
          {choices}
        </Select>
      )}
    </Field>
  );
}
