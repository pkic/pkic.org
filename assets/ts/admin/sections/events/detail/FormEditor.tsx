import { useEffect, useState } from "preact/hooks";
import { api, apiCommand } from "../../../api";
import { adminFormCreateResponseSchema } from "../../../../../shared/schemas/admin-forms";
import { toast } from "../../../ui";
import type { AdminEventFormSummary, AdminFormDetailField } from "../../../types";
import {
  FORM_FIELD_TYPES,
  FORM_PURPOSES,
  FORM_STATUSES,
  type FormPurpose,
  type FormStatus,
} from "../../../../../shared/schemas/forms";
import {
  buildFieldValidation,
  FieldConfigEditor,
  type FieldDraft,
  type FieldType,
  type VisualizationConfig,
} from "./FormFieldConfigEditor";

export interface AdminFormDetail {
  form: AdminEventFormSummary;
  fields: AdminFormDetailField[];
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

function fieldToDraft(field: AdminFormDetailField): FieldDraft {
  const validation = isRecord(field.validation) ? field.validation : {};
  const allowedDomains = validation.allowedDomains;
  return {
    key: field.key,
    label: field.label,
    fieldType: field.fieldType,
    required: field.required,
    sortOrder: field.sortOrder,
    optionsText: Array.isArray(field.options)
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

function detailToDraft(detail: AdminFormDetail | null): FormDraft {
  if (!detail) {
    return {
      key: "",
      purpose: "event_registration",
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

function draftToPayload(draft: FormDraft, includeKey: boolean) {
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
      validation: buildFieldValidation(field),
    }))
    .map((field) => ({ ...field, options: field.options.length > 0 ? field.options : undefined }));

  return {
    ...(includeKey ? { key: draft.key.trim() } : {}),
    purpose: draft.purpose,
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    status: draft.status,
    fields,
  };
}

export function FormEditor({
  mode,
  detail,
  slug,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  detail: AdminFormDetail | null;
  slug?: string;
  onSaved: (key: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<FormDraft>(() => detailToDraft(detail));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(detailToDraft(detail));
    setError("");
  }, [detail?.form.key, mode]);

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
      const payload = draftToPayload(draft, mode === "create");
      if (mode === "create") {
        const endpoint = slug ? `/api/v1/admin/events/${slug}/forms` : "/api/v1/admin/forms";
        await api(endpoint, adminFormCreateResponseSchema, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast(slug ? "Form created" : "Global form created", "success");
        onSaved(draft.key.trim());
      } else if (detail) {
        await apiCommand(`/api/v1/admin/forms/${detail.form.key}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        toast("Form updated", "success");
        onSaved(detail.form.key);
      }
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)}>
      <div class="row g-2 mb-3">
        <div class="col-md-3">
          <label class="form-label small fw-semibold">Key</label>
          <input
            class="form-control form-control-sm mono"
            value={draft.key}
            disabled={mode === "edit"}
            required
            pattern="[a-z][a-z0-9-]*"
            onInput={(e) => setDraft({ ...draft, key: (e.target as HTMLInputElement).value })}
          />
        </div>
        <div class="col-md-3">
          <label class="form-label small fw-semibold">Purpose</label>
          <select
            class="form-select form-select-sm"
            value={draft.purpose}
            onChange={(e) => setDraft({ ...draft, purpose: (e.target as HTMLSelectElement).value as FormPurpose })}
            disabled={mode === "edit"}
          >
            {FORM_PURPOSES.map((purpose) => (
              <option key={purpose} value={purpose}>
                {purpose.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Title</label>
          <input
            class="form-control form-control-sm"
            value={draft.title}
            required
            onInput={(e) => setDraft({ ...draft, title: (e.target as HTMLInputElement).value })}
          />
        </div>
        <div class="col-md-2">
          <label class="form-label small fw-semibold">Status</label>
          <select
            class="form-select form-select-sm"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: (e.target as HTMLSelectElement).value as FormStatus })}
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
        <label class="form-label small fw-semibold">Description</label>
        <textarea
          class="form-control form-control-sm"
          rows={2}
          value={draft.description}
          onInput={(e) => setDraft({ ...draft, description: (e.target as HTMLTextAreaElement).value })}
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
