import { type MembershipCategory } from "../../shared/schemas/membership-categories";
import { Checkbox } from "../ui/Checkbox";
import { useMembershipCategoryCatalog } from "../hooks/useMembershipCategoryCatalog";
// `pk-field__label` and `pk-field__help` are written here as class names
// rather than reached through a component, so this module has to pull their
// stylesheet into its own chunk.
import "../ui/Field.css";

/**
 * Checkbox picker over the configured membership category catalog.
 * Choices follow the catalog order and labels used by application forms.
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
  /*
   * The codes carry no meaning on their own. "A" is not a thing a reader
   * choosing categories can weigh, and a row of thirteen bare letters is what
   * #50 and #53 both objected to. The words come from the configured
   * catalog, so a category renamed there is renamed here, and a code the
   * catalog has not answered for yet keeps its letter rather than waiting.
   */
  const catalog = useMembershipCategoryCatalog();
  const categoryCodes = catalog.map((category) => category.code);
  const labelFor = (category: MembershipCategory): string => {
    const entry = catalog.find((candidate) => candidate.code === category);
    return entry ? `${entry.label} (${category})` : category;
  };

  function toggle(category: MembershipCategory, checked: boolean): void {
    if (checked === selectedSet.has(category)) return;
    const next = checked
      ? categoryCodes.filter((candidate) => selectedSet.has(candidate) || candidate === category)
      : categoryCodes.filter((candidate) => selectedSet.has(candidate) && candidate !== category);
    onChange(next);
  }

  return (
    // `pk-fieldset` carries the reset the element needs — no groove border, no
    // user-agent padding, and `min-inline-size: 0` so it can shrink inside a
    // flex or grid parent. `pk-field` is what makes the legend and the help
    // text parts of a whole rather than two loose paragraphs: it is the group
    // the state modifiers are set on, and its gap spaces the three rows. The
    // legend is why this cannot be a `ui/Field`, which renders a `<label>`.
    <fieldset class="pk-fieldset pk-field" disabled={disabled} aria-describedby={helpId}>
      <legend class="pk-field__label">{label}</legend>
      {/* A column once the words are on them: thirteen named choices wrapped
          across a wide screen are a paragraph of checkboxes nobody can scan.
          The grid keeps them in aligned columns at whatever width there is. */}
      <div class="pk-grid pk-grid--tight">
        {categoryCodes.map((category) => {
          const id = `${idPrefix}-${category}`;
          return (
            <Checkbox
              key={category}
              id={id}
              checked={selectedSet.has(category)}
              disabled={disabled}
              onChange={(event) => toggle(category, (event.target as HTMLInputElement).checked)}
              label={labelFor(category)}
            />
          );
        })}
      </div>
      <p id={helpId} class="pk-field__help">
        {help}
      </p>
    </fieldset>
  );
}
