import { useEffect, useRef, useState } from "preact/hooks";
import {
  FORM_PURPOSES,
  FORM_STATUSES,
  formDefinitionCreateSchema,
  formDefinitionUpdateSchema,
  type FormDefinitionCreateInput,
  type FormDefinitionUpdateInput,
  type FormFieldDefinition,
  type FormPurpose,
  type FormStatus,
} from "../../../shared/schemas/forms";
import {
  buildFieldValidation,
  type FieldDraft,
  type FieldType,
  type VisualizationConfig,
} from "./FormFieldConfigEditor";
import { ClosedQuestion, OpenQuestion } from "./FormQuestionCard";
import { FormQuestionPalette } from "./FormQuestionPalette";
import { FormRespondentPreview } from "./FormRespondentPreview";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { TabList } from "../../ui/TabList";
import { Select, TextInput } from "../../ui/TextControl";
// `pk-mono` is a Content.css class, and component CSS ships in lazy chunks —
// without this import the key inputs render in the body face.
import "../../ui/Content.css";
import "./FormBuilder.css";

export interface EditableFormDetail {
  form: {
    key: string;
    purpose: FormPurpose;
    title: string;
    description: string | null;
    status: FormStatus;
  };
  fields: FormFieldDefinition[];
}

interface FormDraft {
  key: string;
  purpose: FormPurpose;
  title: string;
  description: string;
  status: FormStatus;
  fields: FieldDraft[];
}

/**
 * The key a title implies.
 *
 * A form's key is the stable name it carries in URLs and the API, and an
 * author who has just typed a title has already said what it should be. It is
 * derived until they change it, at which point their own value stands.
 */
function keyFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** What each status means for a respondent, rather than its bare name. */
const STATUS_LABELS: Record<FormStatus, string> = {
  active: "Active — accepting responses",
  inactive: "Inactive — not accepting responses",
  archived: "Archived",
};

function emptyField(index: number): FieldDraft {
  return {
    key: "",
    label: "",
    fieldType: "text",
    required: false,
    sortOrder: (index + 1) * 10,
    optionsText: "",
    optionSource: undefined,
    adminVisualization: "auto",
    placeholder: "",
    helpText: "",
    uiWidget: "",
    format: "",
    pattern: "",
    patternMessage: "",
    minLength: "",
    maxLength: "",
    min: "",
    max: "",
    step: "",
    minItems: "",
    maxItems: "",
    allowCustom: false,
    allowedDomainsText: "",
    advancedValidationText: "{}",
    rawMode: false,
    rawValidationText: "{}",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringConfig(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

function numberConfig(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function visualizationConfig(value: unknown): VisualizationConfig {
  return value === "bar" || value === "pie" || value === "wordcloud" || value === "list" ? value : "auto";
}

const KNOWN_VALIDATION_KEYS = new Set([
  "adminVisualization",
  "visualization",
  "placeholder",
  "helpText",
  "uiWidget",
  "format",
  "pattern",
  "patternMessage",
  "minLength",
  "maxLength",
  "min",
  "max",
  "step",
  "minItems",
  "maxItems",
  "allowCustom",
  "allowedDomains",
]);

function advancedConfigText(config: Record<string, unknown>): string {
  const advanced = Object.fromEntries(Object.entries(config).filter(([key]) => !KNOWN_VALIDATION_KEYS.has(key)));
  return Object.keys(advanced).length ? JSON.stringify(advanced, null, 2) : "{}";
}

function fieldToDraft(field: FormFieldDefinition): FieldDraft {
  const validation = isRecord(field.validation) ? field.validation : {};
  const allowedDomains = validation.allowedDomains;
  return {
    key: field.key,
    label: field.label,
    fieldType: field.fieldType,
    required: field.required,
    sortOrder: field.sortOrder,
    optionSource: field.optionSource ?? undefined,
    optionsText: field.optionSource
      ? ""
      : Array.isArray(field.options)
        ? field.options.map((entry) => (typeof entry === "string" ? entry : String(entry.value ?? ""))).join("\n")
        : "",
    adminVisualization: visualizationConfig(validation.adminVisualization ?? validation.visualization),
    placeholder: stringConfig(validation, "placeholder"),
    helpText: stringConfig(validation, "helpText"),
    uiWidget: stringConfig(validation, "uiWidget"),
    format: stringConfig(validation, "format"),
    pattern: stringConfig(validation, "pattern"),
    patternMessage: stringConfig(validation, "patternMessage"),
    minLength: numberConfig(validation, "minLength"),
    maxLength: numberConfig(validation, "maxLength"),
    min: numberConfig(validation, "min"),
    max: numberConfig(validation, "max"),
    step: numberConfig(validation, "step"),
    minItems: numberConfig(validation, "minItems"),
    maxItems: numberConfig(validation, "maxItems"),
    allowCustom: validation.allowCustom === true,
    allowedDomainsText: Array.isArray(allowedDomains)
      ? allowedDomains.filter((entry): entry is string => typeof entry === "string").join("\n")
      : "",
    advancedValidationText: advancedConfigText(validation),
    rawMode: false,
    rawValidationText: "{}",
  };
}

function detailToDraft(detail: EditableFormDetail | null, purposes: readonly FormPurpose[]): FormDraft {
  if (!detail) {
    return {
      key: "",
      purpose: purposes[0] ?? "survey",
      title: "",
      description: "",
      status: "active",
      fields: [emptyField(0)],
    };
  }

  return {
    key: detail.form.key,
    purpose: detail.form.purpose,
    title: detail.form.title,
    description: detail.form.description ?? "",
    status: detail.form.status,
    fields: detail.fields.length ? detail.fields.map(fieldToDraft) : [emptyField(0)],
  };
}

function draftToPayload(
  draft: FormDraft,
  mode: "create" | "edit",
): FormDefinitionCreateInput | FormDefinitionUpdateInput {
  const fields = draft.fields
    .filter((field) => field.key.trim() || field.label.trim())
    .map((field, position) => ({
      key: field.key.trim(),
      label: field.label.trim(),
      fieldType: field.fieldType,
      required: field.required,
      sortOrder: (position + 1) * 10,
      options: field.optionsText
        .split(/\n/)
        .map((entry) => entry.trim())
        .filter(Boolean),
      optionSource: field.optionSource,
      validation: buildFieldValidation(field),
    }))
    .map((field) => ({ ...field, options: field.options.length > 0 ? field.options : undefined }));

  const payload = {
    ...(mode === "create" ? { key: draft.key.trim(), purpose: draft.purpose } : {}),
    title: draft.title.trim(),
    description: draft.description.trim() || (mode === "create" ? undefined : null),
    status: draft.status,
    fields,
  };
  return mode === "create" ? formDefinitionCreateSchema.parse(payload) : formDefinitionUpdateSchema.parse(payload);
}

export function FormDefinitionEditor({
  mode,
  detail,
  purposes = FORM_PURPOSES,
  onSave,
  onSaved,
  onCancel,
  onError,
}: {
  mode: "create" | "edit";
  detail: EditableFormDetail | null;
  purposes?: readonly FormPurpose[];
  onSave: (payload: FormDefinitionCreateInput | FormDefinitionUpdateInput) => Promise<string>;
  onSaved: (key: string) => void;
  onCancel: () => void;
  onError?: (message: string) => void;
}) {
  const [draft, setDraft] = useState<FormDraft>(() => detailToDraft(detail, purposes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // A new form opens on its first question; an existing one opens closed, so
  // the author sees the whole form before editing any one part of it.
  const [openIndex, setOpenIndex] = useState(mode === "create" ? 0 : -1);
  const [tab, setTab] = useState<"build" | "preview">("build");
  // Until an author opens the key, the title is what names the form.
  const [keyOpen, setKeyOpen] = useState(false);
  const draftSource = `${mode}:${detail?.form.key ?? ""}`;
  const previousDraftSource = useRef(draftSource);

  useEffect(() => {
    // The initial state already reflects the initial props. Avoid a redundant
    // post-paint reset that can erase input typed immediately after mounting.
    if (previousDraftSource.current === draftSource) return;
    previousDraftSource.current = draftSource;
    setDraft(detailToDraft(detail, purposes));
    setError("");
  }, [detail, draftSource, purposes]);

  function updateField(index: number, patch: Partial<FieldDraft>) {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    }));
  }

  function moveField(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const fields = [...current.fields];
      const target = index + direction;
      if (target < 0 || target >= fields.length) return current;
      [fields[index], fields[target]] = [fields[target], fields[index]];
      return { ...current, fields };
    });
  }

  function addField(fieldType: FieldType) {
    setDraft((current) => {
      const fields = [...current.fields, { ...emptyField(current.fields.length), fieldType }];
      setOpenIndex(fields.length - 1);
      return { ...current, fields };
    });
  }

  function duplicateField(index: number) {
    setDraft((current) => {
      const source = current.fields[index];
      const fields = [...current.fields];
      // A duplicate cannot carry the original's key: two fields sharing one key
      // is exactly what the contract refuses.
      fields.splice(index + 1, 0, { ...source, key: "" });
      setOpenIndex(index + 1);
      return { ...current, fields };
    });
  }

  function removeField(index: number) {
    setOpenIndex(-1);
    setDraft((current) => ({ ...current, fields: current.fields.filter((_, i) => i !== index) }));
  }

  async function save(e: Event) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const key = await onSave(draftToPayload(draft, mode));
      onSaved(key);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  }

  const questions = draft.fields;
  const preview = tab === "preview";

  return (
    <form class="pk pk-stack" onSubmit={(e) => void save(e)} noValidate>
      <div class="pk-tabs-rule">
        <TabList
          label="Form editor"
          idPrefix="form-editor"
          activeId={tab}
          onSelect={(id) => setTab(id as "build" | "preview")}
          items={[
            { id: "build", label: "Build" },
            { id: "preview", label: "Preview" },
          ]}
        />
      </div>

      {preview ? (
        <FormRespondentPreview title={draft.title} description={draft.description} fields={questions} />
      ) : (
        <div class="pk-formbuild">
          <div class="pk-stack">
            {/*
             * The form's own card. Title and description are edited where they
             * are read rather than in labelled boxes above the questions, which
             * is what makes the column read as the form it is building.
             */}
            <Panel aria-label="Form details">
              <div class="pk-formcard__rule" aria-hidden="true" />
              <PanelBody class="pk-stack pk-stack--tight">
                <input
                  class="pk-formtitle pk-formtitle--name"
                  value={draft.title}
                  aria-label="Form title"
                  placeholder="Untitled form"
                  required
                  onInput={(e) => {
                    const value = e.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      title: value,
                      // An untouched key follows the title; an author's own key
                      // is never overwritten by what they type above it.
                      key: mode === "create" && !keyOpen ? keyFromTitle(value) : current.key,
                    }));
                  }}
                />
                <textarea
                  class="pk-formtitle pk-formtitle--desc"
                  rows={2}
                  value={draft.description}
                  aria-label="Form description"
                  placeholder="Add a short description respondents read before they start…"
                  onInput={(e) => {
                    const value = e.currentTarget.value;
                    setDraft((current) => ({ ...current, description: value }));
                  }}
                />
                <div class="pk-cluster">
                  <span class="pk-small pk-muted">Key</span>
                  {mode === "edit" || !keyOpen ? (
                    <>
                      <code class="pk-mono pk-small">{draft.key.trim() || "untitled-form"}</code>
                      {mode === "create" && (
                        <>
                          <span class="pk-small pk-muted">generated from the title</span>
                          <button type="button" class="pk-linkish pk-small" onClick={() => setKeyOpen(true)}>
                            Change
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <TextInput
                      class="pk-mono"
                      value={draft.key}
                      required
                      pattern="[a-z][a-z0-9-]*"
                      aria-label="Form key"
                      onInput={(e) => {
                        const value = e.currentTarget.value;
                        setDraft((current) => ({ ...current, key: value }));
                      }}
                    />
                  )}
                </div>
              </PanelBody>
            </Panel>

            {questions.map((field, index) => {
              const position = String(index + 1);
              return index === openIndex ? (
                <OpenQuestion
                  key={index}
                  field={field}
                  index={index}
                  position={position}
                  last={index === questions.length - 1}
                  onlyField={questions.length === 1}
                  update={(patch) => updateField(index, patch)}
                  onClose={() => setOpenIndex(-1)}
                  onMove={(direction) => moveField(index, direction)}
                  onDuplicate={() => duplicateField(index)}
                  onRemove={() => removeField(index)}
                />
              ) : (
                <ClosedQuestion key={index} field={field} position={position} onOpen={() => setOpenIndex(index)} />
              );
            })}

            <FormQuestionPalette onAdd={addField} />
          </div>

          <aside class="pk-formbuild__rail pk-stack">
            <Panel aria-label="Form settings">
              <PanelHeader title="Form settings" />
              <PanelBody class="pk-stack pk-stack--tight">
                <Field label="Purpose">
                  {(control) => (
                    <Select
                      {...control}
                      value={draft.purpose}
                      disabled={mode === "edit"}
                      onChange={(e) => {
                        const value = e.currentTarget.value as FormPurpose;
                        setDraft((current) => ({ ...current, purpose: value }));
                      }}
                    >
                      {purposes.map((purpose) => (
                        <option key={purpose} value={purpose}>
                          {purpose.replace(/_/g, " ")}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Status">
                  {(control) => (
                    <Select
                      {...control}
                      value={draft.status}
                      onChange={(e) => {
                        const value = e.currentTarget.value as FormStatus;
                        setDraft((current) => ({ ...current, status: value }));
                      }}
                    >
                      {FORM_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </PanelBody>
            </Panel>
          </aside>
        </div>
      )}

      {/* The save failure is announced where it happened rather than left as
          quiet red text beside the button. */}
      {error && <Alert tone="danger">{error}</Alert>}

      <div class="pk-cluster">
        <Button type="submit" variant="primary" size="sm" loading={saving}>
          {saving ? "Saving..." : mode === "create" ? "Create form" : "Save form"}
        </Button>
        <Button size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
