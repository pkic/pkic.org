import type { FieldPresentation } from "../../hooks/useContractForm";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";
import type { FieldDraft } from "./form-field-draft";

/**
 * A question's choices, one box per choice. The draft still stores the lines;
 * only the way an author edits them changes, so adding and removing a choice
 * never means editing whitespace. The set is one field: a refusal of the
 * choices — too few, a repeat — is shown on it.
 */
export function FormChoicesEditor({
  field,
  update,
  presentation,
  onRemove,
}: {
  field: Pick<FieldDraft, "fieldType" | "optionsText">;
  update: (patch: Partial<FieldDraft>) => void;
  presentation?: FieldPresentation;
  /** Told which choice was removed, for an editor that keeps something per choice, such as its stored value. */
  onRemove?: (index: number) => void;
}) {
  const options = field.optionsText.split(/\n/);
  const mark = field.fieldType === "multi_select" ? "pk-formq__option-mark--many" : "pk-formq__option-mark--one";
  return (
    <Field label="Choices" group {...presentation}>
      {(control) => (
        <div class="pk-stack pk-stack--tight">
          {options.map((option, at) => (
            <div class="pk-formq__option" key={at}>
              <span aria-hidden="true" class={`pk-formq__option-mark ${mark}`} />
              <TextInput
                aria-label={`Choice ${String(at + 1)}`}
                aria-describedby={control["aria-describedby"]}
                aria-invalid={control["aria-invalid"]}
                value={option}
                onInput={(e) =>
                  update({
                    optionsText: options
                      .map((entry, i) => (i === at ? (e.target as HTMLInputElement).value : entry))
                      .join("\n"),
                  })
                }
              />
              <button
                type="button"
                class="pk-formq__option-remove"
                aria-label={`Remove choice ${String(at + 1)}`}
                onClick={() => {
                  update({ optionsText: options.filter((_, i) => i !== at).join("\n") });
                  onRemove?.(at);
                }}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          ))}
          <div>
            <Button onClick={() => update({ optionsText: `${field.optionsText}\n` })}>Add choice</Button>
          </div>
        </div>
      )}
    </Field>
  );
}
