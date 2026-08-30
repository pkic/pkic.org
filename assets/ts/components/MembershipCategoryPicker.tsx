import { MEMBERSHIP_CATEGORIES, type MembershipCategory } from "../../shared/schemas/membership-categories";

/**
 * Checkbox picker over the fixed membership-category vocabulary
 * (`MEMBERSHIP_CATEGORIES`). Replaces free-text comma-separated category
 * fields so a caller cannot type a code outside the shared vocabulary.
 *
 * An empty selection is a meaningful value — "every category" — for
 * consumers such as mailing-list auto-sync filters. Keep that semantic
 * visible via the `help` copy rather than defaulting to an implicit
 * all-categories selection.
 */
export function MembershipCategoryPicker({
  idPrefix,
  label,
  selected,
  onChange,
  disabled = false,
  help = "Leave every box unchecked to include all membership categories.",
}: {
  idPrefix: string;
  label: string;
  selected: readonly MembershipCategory[];
  onChange: (next: MembershipCategory[]) => void;
  disabled?: boolean;
  help?: string;
}) {
  const selectedSet = new Set(selected);
  const helpId = `${idPrefix}-help`;

  function toggle(category: MembershipCategory, checked: boolean): void {
    if (checked === selectedSet.has(category)) return;
    const next = checked
      ? MEMBERSHIP_CATEGORIES.filter((candidate) => selectedSet.has(candidate) || candidate === category)
      : MEMBERSHIP_CATEGORIES.filter((candidate) => selectedSet.has(candidate) && candidate !== category);
    onChange(next);
  }

  return (
    <fieldset class="border-0 p-0 m-0" disabled={disabled} aria-describedby={helpId}>
      <legend class="small fw-semibold mb-1">{label}</legend>
      <div class="d-flex flex-wrap gap-2">
        {MEMBERSHIP_CATEGORIES.map((category) => {
          const id = `${idPrefix}-${category}`;
          return (
            <div class="form-check form-check-inline m-0" key={category}>
              <input
                id={id}
                class="form-check-input"
                type="checkbox"
                checked={selectedSet.has(category)}
                disabled={disabled}
                onChange={(event) => toggle(category, (event.target as HTMLInputElement).checked)}
              />
              <label class="form-check-label small" for={id}>
                {category}
              </label>
            </div>
          );
        })}
      </div>
      <div id={helpId} class="form-text">
        {help}
      </div>
    </fieldset>
  );
}
