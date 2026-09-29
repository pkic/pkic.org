import { FORM_FIELD_TYPES, type FormFieldType } from "../../../shared/schemas/forms";
import { Button } from "../../ui/Button";
import { Checkbox } from "../../ui/Checkbox";
import { Field } from "../../ui/Field";
import { Select, TextInput } from "../../ui/TextControl";
import { fieldSummary, fieldTypeProfile } from "./form-field-types";
import { FieldConfigEditor } from "./FormFieldConfigEditor";
import type { FieldDraft } from "./form-field-draft";

/**
 * A closed question: the label, one summary line, and the answer type.
 *
 * This is what an author reads when scanning a long form, so it carries no
 * controls of its own — the whole row opens the card.
 */
export function ClosedQuestion({
  field,
  position,
  onOpen,
}: {
  field: FieldDraft;
  position: string;
  onOpen: () => void;
}) {
  const profile = fieldTypeProfile(field.fieldType);
  return (
    <button type="button" class="pk-formq" aria-label={`Edit question ${position}`} onClick={onOpen}>
      <span class="pk-formq__grip" aria-hidden="true" title="Drag to reorder">
        ⠿
      </span>
      <span>
        <span class="pk-strong">{field.label.trim() || "Untitled question"}</span>
        {field.required && (
          <span class="pk-required" aria-hidden="true">
            *
          </span>
        )}
        <br />
        <span class="pk-small pk-muted">{fieldSummary(field)}</span>
      </span>
      <span class="pk-formq__type pk-small pk-muted pk-nowrap">{profile.label}</span>
    </button>
  );
}

/** The open card: everything an author may set on one question. */
export function OpenQuestion({
  field,
  index,
  position,
  last,
  onlyField,
  update,
  onClose,
  onMove,
  onDuplicate,
  onRemove,
}: {
  field: FieldDraft;
  index: number;
  position: string;
  last: boolean;
  onlyField: boolean;
  update: (patch: Partial<FieldDraft>) => void;
  onClose: () => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const profile = fieldTypeProfile(field.fieldType);

  return (
    <section class="pk-formq-open" aria-label={`Question ${position}`}>
      <div class="pk-formq-open__stripe" aria-hidden="true" />
      <div class="pk-formq-open__body pk-stack">
        <div class="pk-cluster pk-cluster--between">
          <span class="pk-formq__type pk-small pk-muted">{profile.label}</span>
          <span class="pk-cluster">
            <Button
              size="sm"
              icon
              aria-label={`Move question ${position} up`}
              onClick={() => onMove(-1)}
              disabled={index === 0}
            >
              <span aria-hidden="true">↑</span>
            </Button>
            <Button
              size="sm"
              icon
              aria-label={`Move question ${position} down`}
              onClick={() => onMove(1)}
              disabled={last}
            >
              <span aria-hidden="true">↓</span>
            </Button>
            <Button size="sm" icon aria-label={`Collapse question ${position}`} onClick={onClose}>
              <span aria-hidden="true">⌃</span>
            </Button>
          </span>
        </div>

        <div class="pk-formq__split">
          <Field label="Question">
            {(control) => (
              <TextInput
                {...control}
                value={field.label}
                required
                placeholder="What are you asking?"
                onInput={(e) => update({ label: e.currentTarget.value })}
              />
            )}
          </Field>
          <Field label="Answer type">
            {(control) => (
              <Select
                {...control}
                value={field.fieldType}
                onChange={(e) => update({ fieldType: e.currentTarget.value as FormFieldType })}
              >
                {FORM_FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {fieldTypeProfile(type).label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <FieldConfigEditor field={field} index={index} updateField={(_, patch) => update(patch)} />

        <div class="pk-cluster pk-cluster--between pk-formq-open__foot">
          <Checkbox
            label="Required"
            checked={field.required}
            onChange={(e) => update({ required: (e.target as HTMLInputElement).checked })}
          />
          <span class="pk-cluster">
            <Button size="sm" variant="ghost" onClick={onDuplicate}>
              Duplicate
            </Button>
            <Button size="sm" variant="danger-quiet" onClick={onRemove} disabled={onlyField}>
              Delete
            </Button>
          </span>
        </div>
      </div>
    </section>
  );
}
