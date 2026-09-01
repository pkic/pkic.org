import { MEMBERSHIP_CATEGORIES, type MembershipCategory } from "../../shared/schemas/membership-categories";
// `pk-field__label`, `pk-field__help` and the `pk-check` trio are written here
// as class names rather than reached through a component, so this module has to
// pull their stylesheet into its own chunk.
import "../ui/Field.css";

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
    // `pk-fieldset` carries the reset the element needs — no groove border, no
    // user-agent padding, and `min-inline-size: 0` so it can shrink inside a
    // flex or grid parent. The spacing between the legend, the boxes and the
    // help text is the stack's gap rather than a margin on each of them.
    <fieldset class="pk-fieldset pk-stack pk-stack--tight" disabled={disabled} aria-describedby={helpId}>
      <legend class="pk-field__label">{label}</legend>
      <div class="pk-cluster">
        {MEMBERSHIP_CATEGORIES.map((category) => {
          const id = `${idPrefix}-${category}`;
          return (
            // All three parts of the block: without `pk-check__input` on the
            // input the browser draws its own control, in the operating
            // system's accent rather than ours, and no gate can see it.
            <label class="pk-check" key={category} for={id}>
              <input
                id={id}
                class="pk-check__input"
                type="checkbox"
                checked={selectedSet.has(category)}
                disabled={disabled}
                onChange={(event) => toggle(category, (event.target as HTMLInputElement).checked)}
              />
              <span class="pk-check__label">{category}</span>
            </label>
          );
        })}
      </div>
      <p id={helpId} class="pk-field__help">
        {help}
      </p>
    </fieldset>
  );
}
