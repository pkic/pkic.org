import type { FormFieldType } from "../../../shared/schemas/forms";
import { Menu } from "../../ui/Menu";
import { fieldTypeProfile, MORE_FIELD_TYPES, QUICK_FIELD_TYPES } from "./form-field-types";

/**
 * How a question is added: by picking its answer type.
 *
 * An "add field" button produces an untyped empty row an author then has to
 * configure. Choosing the type first means the card opens already knowing
 * which editors it needs, and the palette doubles as the list of what a form
 * can ask.
 */
export function FormQuestionPalette({ onAdd }: { onAdd: (type: FormFieldType) => void }) {
  return (
    <div class="pk-palette">
      <p class="pk-small pk-muted">Add a question</p>
      <div class="pk-cluster">
        {QUICK_FIELD_TYPES.map((type) => {
          const profile = fieldTypeProfile(type);
          return (
            /* The glyph is decorative, so the name is stated rather than
               assembled from the button's contents. */
            <button
              key={type}
              type="button"
              class="pk-palette__chip"
              aria-label={profile.label}
              onClick={() => onAdd(type)}
            >
              <span class="pk-palette__glyph" aria-hidden="true">
                {profile.glyph}
              </span>
              {profile.label}
            </button>
          );
        })}
        <Menu
          label="More question types"
          heading="All question types"
          align="start"
          variant="plain"
          items={MORE_FIELD_TYPES.map((type) => ({
            id: type,
            label: fieldTypeProfile(type).label,
            onSelect: () => onAdd(type),
          }))}
        >
          <span class="pk-palette__chip">More types…</span>
        </Menu>
      </div>
    </div>
  );
}
