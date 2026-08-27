import { useEffect, useId, useRef, useState } from "preact/hooks";
import {
  FORM_FIELD_TYPES,
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
  FieldConfigEditor,
  type FieldDraft,
  type FieldType,
  type VisualizationConfig,
} from "./FormFieldConfigEditor";

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
  const fieldIdPrefix = useId();
  const [draft, setDraft] = useState<FormDraft>(() => detailToDraft(detail, purposes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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

  function removeField(index: number) {
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

  return (
    <form onSubmit={(e) => void save(e)}>
      <div class="row g-2 mb-3">
        <div class="col-md-3">
          <label class="form-label small fw-semibold" for={`${fieldIdPrefix}-key`}>
            Key
          </label>
          <input
            id={`${fieldIdPrefix}-key`}
            class="form-control form-control-sm mono"
            value={draft.key}
            disabled={mode === "edit"}
            required
            pattern="[a-z][a-z0-9-]*"
            onInput={(e) => {
              const value = e.currentTarget.value;
              setDraft((current) => ({ ...current, key: value }));
            }}
          />
        </div>
        <div class="col-md-3">
          <label class="form-label small fw-semibold" for={`${fieldIdPrefix}-purpose`}>
            Purpose
          </label>
          <select
            id={`${fieldIdPrefix}-purpose`}
            class="form-select form-select-sm"
            value={draft.purpose}
            onChange={(e) => {
              const value = e.currentTarget.value as FormPurpose;
              setDraft((current) => ({ ...current, purpose: value }));
            }}
            disabled={mode === "edit"}
          >
            {purposes.map((purpose) => (
              <option key={purpose} value={purpose}>
                {purpose.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold" for={`${fieldIdPrefix}-title`}>
            Title
          </label>
          <input
            id={`${fieldIdPrefix}-title`}
            class="form-control form-control-sm"
            value={draft.title}
            required
            onInput={(e) => {
              const value = e.currentTarget.value;
              setDraft((current) => ({ ...current, title: value }));
            }}
          />
        </div>
        <div class="col-md-2">
          <label class="form-label small fw-semibold" for={`${fieldIdPrefix}-status`}>
            Status
          </label>
          <select
            id={`${fieldIdPrefix}-status`}
            class="form-select form-select-sm"
            value={draft.status}
            onChange={(e) => {
              const value = e.currentTarget.value as FormStatus;
              setDraft((current) => ({ ...current, status: value }));
            }}
          >
            {FORM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status[0].toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div class="mb-3">
        <label class="form-label small fw-semibold" for={`${fieldIdPrefix}-description`}>
          Description
        </label>
        <textarea
          id={`${fieldIdPrefix}-description`}
          class="form-control form-control-sm"
          rows={2}
          value={draft.description}
          onInput={(e) => {
            const value = e.currentTarget.value;
            setDraft((current) => ({ ...current, description: value }));
          }}
        />
      </div>

      <div class="d-flex align-items-center gap-2 mb-2">
        <h6 class="mb-0">Fields</h6>
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary ms-auto"
          onClick={() =>
            setDraft((current) => ({ ...current, fields: [...current.fields, emptyField(current.fields.length)] }))
          }
        >
          Add field
        </button>
      </div>

      <div class="d-flex flex-column gap-2 mb-3">
        {draft.fields.map((field, index) => (
          <div class="card adm-field-card" key={index}>
            <div class="adm-field-card-head">
              <span class="adm-field-num">{index + 1}</span>
              <input
                class="form-control form-control-sm mono adm-fkey-input"
                value={field.key}
                pattern="[a-z][a-z0-9_]*"
                required
                placeholder="field_key"
                title="Field key (lowercase, letters, digits, underscores)"
                onInput={(e) => updateField(index, { key: (e.target as HTMLInputElement).value })}
              />
              <input
                class="form-control form-control-sm adm-flabel-input"
                value={field.label}
                required
                placeholder="Field label"
                onInput={(e) => updateField(index, { label: (e.target as HTMLInputElement).value })}
              />
              <select
                class="form-select form-select-sm adm-ftype-select"
                value={field.fieldType}
                onChange={(e) => updateField(index, { fieldType: (e.target as HTMLSelectElement).value as FieldType })}
              >
                {FORM_FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <div class="form-check mb-0">
                <input
                  id={`ffr-${index}`}
                  type="checkbox"
                  class="form-check-input"
                  checked={field.required}
                  onChange={(e) => updateField(index, { required: (e.target as HTMLInputElement).checked })}
                />
                <label class="form-check-label small" for={`ffr-${index}`}>
                  Required
                </label>
              </div>
              <div class="d-flex gap-1 ms-auto">
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary adm-field-move-btn"
                  onClick={() => moveField(index, -1)}
                  disabled={index === 0}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary adm-field-move-btn"
                  onClick={() => moveField(index, 1)}
                  disabled={index === draft.fields.length - 1}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger adm-field-move-btn"
                  onClick={() => removeField(index)}
                  disabled={draft.fields.length === 1}
                  title="Remove field"
                >
                  ✕
                </button>
              </div>
            </div>
            <div class="card-body p-3">
              <FieldConfigEditor field={field} index={index} updateField={updateField} />
            </div>
          </div>
        ))}
      </div>

      <div class="d-flex gap-2 align-items-center">
        <button type="submit" class="btn btn-sm btn-success" disabled={saving}>
          {saving ? "Saving..." : mode === "create" ? "Create form" : "Save form"}
        </button>
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        {error && <span class="small text-danger">{error}</span>}
      </div>
    </form>
  );
}
