import { FORM_FIELD_TYPES, type FormFieldType } from "../../../shared/schemas/forms";
import type { FieldPresentation } from "../../hooks/useContractForm";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Checkbox, Radio } from "../../ui/Checkbox";
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
  problem,
  onOpen,
}: {
  field: FieldDraft;
  position: string;
  /** Why the form's contract refuses this question, said on the closed card so it is not missed. */
  problem?: string;
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
        <span class="pk-small pk-muted">{problem ?? fieldSummary(field)}</span>
      </span>
      {problem ? (
        <Badge tone="danger">Needs a fix</Badge>
      ) : (
        <span class="pk-formq__type pk-small pk-muted pk-nowrap">{profile.label}</span>
      )}
    </button>
  );
}

/**
 * What a question asks and the type of answer it takes: the first two things
 * an author sets on any question, whichever editor holds it. `types` narrows
 * the answer types where only some apply.
 */
export function QuestionBasics({
  field,
  update,
  types = FORM_FIELD_TYPES,
  typeLabel = (type) => fieldTypeProfile(type).label,
  answerTypeControl = "select",
  presentationOf,
}: {
  field: Pick<FieldDraft, "label" | "fieldType">;
  update: (patch: Partial<FieldDraft>) => void;
  types?: readonly FormFieldType[];
  /** Compact editors can expose their bounded answer types directly. Normal forms retain the select. */
  answerTypeControl?: "select" | "radio";
  /** What an author calls a type where a narrower editor names it more precisely. */
  typeLabel?: (type: FormFieldType) => string;
  /** The state of `label` and `fieldType` in the contract of the form that holds the question. */
  presentationOf?: (path: string) => FieldPresentation;
}) {
  return (
    <div class="pk-formq__split">
      <Field label="Question" {...presentationOf?.("label")}>
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
      <Field label="Answer type" group={answerTypeControl === "radio"} {...presentationOf?.("fieldType")}>
        {(control) =>
          answerTypeControl === "radio" ? (
            <div class="pk-cluster">
              {types.map((type) => (
                <Radio
                  key={type}
                  name={control.id}
                  value={type}
                  checked={field.fieldType === type}
                  label={typeLabel(type)}
                  aria-describedby={control["aria-describedby"]}
                  aria-invalid={control["aria-invalid"]}
                  onChange={() => update({ fieldType: type })}
                />
              ))}
            </div>
          ) : (
            <Select
              {...control}
              value={field.fieldType}
              onChange={(e) => update({ fieldType: e.currentTarget.value as FormFieldType })}
            >
              {types.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(type)}
                </option>
              ))}
            </Select>
          )
        }
      </Field>
    </div>
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
  presentationOf,
}: {
  presentationOf?: (path: string) => FieldPresentation;
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
          <span class="pk-cluster" data-density="compact">
            <Button icon aria-label={`Move question ${position} up`} onClick={() => onMove(-1)} disabled={index === 0}>
              <span aria-hidden="true">↑</span>
            </Button>
            <Button icon aria-label={`Move question ${position} down`} onClick={() => onMove(1)} disabled={last}>
              <span aria-hidden="true">↓</span>
            </Button>
            <Button icon aria-label={`Collapse question ${position}`} onClick={onClose}>
              <span aria-hidden="true">⌃</span>
            </Button>
          </span>
        </div>

        <QuestionBasics field={field} update={update} presentationOf={presentationOf} />

        <FieldConfigEditor
          field={field}
          index={index}
          updateField={(_, patch) => update(patch)}
          presentationOf={presentationOf}
        />

        <div class="pk-cluster pk-cluster--between pk-formq-open__foot">
          <Checkbox
            label="Required"
            checked={field.required}
            onChange={(e) => update({ required: (e.target as HTMLInputElement).checked })}
          />
          <span class="pk-cluster" data-density="compact">
            <Button variant="ghost" onClick={onDuplicate}>
              Duplicate
            </Button>
            <Button variant="danger-quiet" onClick={onRemove} disabled={onlyField}>
              Delete
            </Button>
          </span>
        </div>
      </div>
    </section>
  );
}
