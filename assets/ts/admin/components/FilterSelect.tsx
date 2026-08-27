import { FilterSelect as SharedFilterSelect, type FilterOption } from "../../components/FilterSelect";

export type { FilterOption };

/** @deprecated Import from the shared components directory. */
export function FilterSelect<Value extends string>({
  className = "form-select form-select-sm adm-filter-select",
  ...props
}: {
  label?: string;
  ariaLabel?: string;
  value: Value;
  options: ReadonlyArray<FilterOption<Value>>;
  onChange: (value: Value) => void;
  className?: string;
}) {
  return <SharedFilterSelect {...props} className={className} />;
}
