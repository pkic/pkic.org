import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Checkbox, Radio } from "../../ui/Checkbox";
import { Field } from "../../ui/Field";
import { Panel, PanelBody } from "../../ui/Panel";
import { Select, Textarea, TextInput } from "../../ui/TextControl";
import { fieldTypeProfile } from "./form-field-types";
import type { FieldDraft } from "./form-field-draft";

/** The control a respondent actually meets for one question. */
function PreviewControl({ field, name }: { field: FieldDraft; name: string }) {
  const choices = field.optionsText
    .split(/\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (field.fieldType === "boolean") {
    return <Checkbox label={field.label.trim() || "Untitled question"} name={name} />;
  }

  if (field.fieldType === "multi_select") {
    return (
      <div class="pk-stack pk-stack--tight">
        {choices.map((choice) => (
          <Checkbox key={choice} label={choice} name={name} />
        ))}
        {field.allowCustom && <Checkbox label="Other" name={name} />}
      </div>
    );
  }

  if (field.fieldType === "select") {
    // A short list reads better as radios than as a dropdown a respondent has
    // to open to discover how few choices there are.
    if (choices.length > 0 && choices.length <= 5) {
      return (
        <div class="pk-stack pk-stack--tight">
          {choices.map((choice) => (
            <Radio key={choice} label={choice} name={name} />
          ))}
          {field.allowCustom && <Radio label="Other" name={name} />}
        </div>
      );
    }
    return (
      <Field label={field.label.trim() || "Untitled question"} help={field.helpText.trim() || undefined}>
        {(control) => (
          <Select {...control} name={name}>
            <option>Select…</option>
            {choices.map((choice) => (
              <option key={choice}>{choice}</option>
            ))}
          </Select>
        )}
      </Field>
    );
  }

  const label = field.label.trim() || "Untitled question";
  const help = field.helpText.trim() || undefined;

  if (field.fieldType === "textarea") {
    return (
      <Field label={label} help={help}>
        {(control) => <Textarea {...control} name={name} rows={3} placeholder={field.placeholder} />}
      </Field>
    );
  }

  const inputType =
    field.fieldType === "email"
      ? "email"
      : field.fieldType === "url"
        ? "url"
        : field.fieldType === "number"
          ? "number"
          : field.fieldType === "date"
            ? "date"
            : "text";

  return (
    <Field label={label} help={help}>
      {(control) => <TextInput {...control} name={name} type={inputType} placeholder={field.placeholder} />}
    </Field>
  );
}

/**
 * One question in the respondent's view.
 *
 * A control that carries its own label — a text box, a dropdown — is a Field
 * and names itself. A set of choices has no single control to name, so the
 * question becomes a group: a fieldset whose legend is the question.
 */
function PreviewQuestion({ field, index }: { field: FieldDraft; index: number }) {
  const name = field.key || `question-${String(index)}`;
  const grouped = fieldTypeProfile(field.fieldType).options;

  if (!grouped) return <PreviewControl field={field} name={name} />;

  return (
    <fieldset class="pk-choices pk-stack pk-stack--tight">
      <legend class="pk-choices__legend">
        {field.label.trim() || "Untitled question"}
        {field.required && (
          <span class="pk-required" aria-hidden="true">
            *
          </span>
        )}
      </legend>
      {field.helpText.trim() && <p class="pk-choices__help">{field.helpText}</p>}
      <PreviewControl field={field} name={name} />
    </fieldset>
  );
}

/**
 * The form as a respondent meets it.
 *
 * Authoring a form and answering one are different jobs, so the preview is a
 * tab rather than a panel beside the editor: an author reads the whole thing
 * in the respondent's order, without the editing chrome competing for it.
 */
export function FormRespondentPreview({
  title,
  description,
  fields,
}: {
  title: string;
  description: string;
  fields: readonly FieldDraft[];
}) {
  const answerable = fields.filter((field) => field.label.trim() || field.key.trim());

  return (
    <div class="pk-stack">
      <Alert tone="info" title="Preview">
        This is what a respondent sees. Nothing entered here is recorded.
      </Alert>
      <Panel aria-label="Respondent preview">
        <div class="pk-formcard__rule" aria-hidden="true" />
        <PanelBody class="pk-stack">
          <div class="pk-stack pk-stack--tight">
            <h2>{title.trim() || "Untitled form"}</h2>
            {description.trim() && <p class="pk-muted">{description}</p>}
          </div>

          {answerable.length === 0 ? (
            <p class="pk-muted">No questions yet. Add one in the Build tab.</p>
          ) : (
            answerable.map((field, index) => <PreviewQuestion key={field.key || index} field={field} index={index} />)
          )}

          <div>
            <Button variant="primary" disabled>
              Submit
            </Button>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
