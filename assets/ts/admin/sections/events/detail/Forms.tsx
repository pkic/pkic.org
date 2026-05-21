import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { DataTable } from "../../../../components/Table";
import { Tabs } from "../../../../components/Tabs";
import { api } from "../../../api";
import { fmt, toast } from "../../../ui";
import type {
  AdminAttendanceOption,
  AdminEventFormSummary,
  AdminFormDetailField,
  AdminFormSubmission,
} from "../../../types";
import {
  buildFieldValidation,
  FieldConfigEditor,
  type FieldDraft,
  type FieldType,
  type VisualizationConfig,
} from "./FormFieldConfigEditor";
import { FormResponseStats, FormSubmissionsTable, type ServerFieldStat } from "./FormResponses";
import { loadEventAttendanceOptions } from "./eventAttendance";

type FormTab = "responses" | "statistics" | "edit";

const PURPOSES = ["event_registration", "proposal_submission", "survey", "feedback", "application"];
const FIELD_TYPES = ["text", "textarea", "select", "multi_select", "boolean", "number", "date", "email", "url"];

interface AdminFormDetail {
  form: AdminEventFormSummary;
  fields: AdminFormDetailField[];
}

interface FormSubmissionsResponse {
  total: number;
  stats: ServerFieldStat[];
  submissions: AdminFormSubmission[];
}

interface FormResponseFilters {
  status?: string;
  attendanceType?: string;
}

function responseQueryParams(
  slug?: string,
  filters?: FormResponseFilters,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    ...(slug ? { eventSlug: slug } : {}),
    ...(filters?.status ? { status: filters.status } : {}),
    ...(filters?.attendanceType ? { attendanceType: filters.attendanceType } : {}),
    ...(extra ?? {}),
  };
}

interface FormDraft {
  key: string;
  purpose: string;
  title: string;
  description: string;
  status: string;
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

function FormEditor({
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
        await api<{ key: string }>(endpoint, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast(slug ? "Form created" : "Global form created", "success");
        onSaved(draft.key.trim());
      } else if (detail) {
        await api(`/api/v1/admin/forms/${detail.form.key}`, {
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
            onChange={(e) => setDraft({ ...draft, purpose: (e.target as HTMLSelectElement).value })}
            disabled={mode === "edit"}
          >
            {PURPOSES.map((purpose) => (
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
            onChange={(e) => setDraft({ ...draft, status: (e.target as HTMLSelectElement).value })}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
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
                {FIELD_TYPES.map((type) => (
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

function scopeLabel(form: AdminEventFormSummary): string {
  if (form.scope_type === "event") return form.event_name ?? form.scope_ref ?? "Event";
  return form.scope_type;
}

function FormDetailPanel({
  formKey,
  slug,
  summary,
  filters,
  onChanged,
  showManagement = true,
}: {
  formKey: string;
  slug?: string;
  summary?: AdminEventFormSummary;
  filters?: FormResponseFilters;
  onChanged?: () => void;
  showManagement?: boolean;
}) {
  const [tab, setTab] = useState<FormTab>("statistics");
  const [detail, setDetail] = useState<AdminFormDetail | null>(null);
  const [stats, setStats] = useState<ServerFieldStat[]>([]);
  const [totalResponses, setTotalResponses] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const submissionEndpoint = `/api/v1/admin/forms/${formKey}/submissions`;
  const submissionParams = responseQueryParams(slug, filters);
  const statsParams = responseQueryParams(slug, filters, { limit: "0" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statsQuery = new URLSearchParams(statsParams).toString();
      const [detailRes, submissionRes] = await Promise.all([
        api<AdminFormDetail>(`/api/v1/admin/forms/${formKey}`),
        api<FormSubmissionsResponse>(`${submissionEndpoint}${statsQuery ? `?${statsQuery}` : ""}`),
      ]);
      setDetail(detailRes);
      setStats(submissionRes.stats ?? []);
      setTotalResponses(submissionRes.total ?? 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [formKey, submissionEndpoint, JSON.stringify(statsParams)]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeForm() {
    if (!window.confirm(`Archive or delete form ${formKey}?`)) return;
    try {
      const result = await api<{ action: string; message?: string }>(`/api/v1/admin/forms/${formKey}`, {
        method: "DELETE",
      });
      toast(result.message ?? `Form ${result.action}`, "success");
      onChanged?.();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!detail) return null;

  return (
    <div class="card mt-3">
      <div class="card-header d-flex align-items-center gap-2 flex-wrap">
        <div>
          <h6 class="mb-0">{detail.form.title}</h6>
          <div class="small text-muted">
            <span class="mono">{detail.form.key}</span> · {detail.form.purpose.replace(/_/g, " ")} · updated{" "}
            {fmt(detail.form.updated_at)}
            {!slug && (
              <>
                {" · "}
                {summary ? scopeLabel(summary) : detail.form.scope_type}
              </>
            )}
          </div>
        </div>
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void load()}>
          Refresh
        </button>
        {showManagement && (
          <button class="btn btn-sm btn-outline-danger" onClick={() => void removeForm()}>
            Archive/Delete
          </button>
        )}
      </div>
      <div class="card-body">
        <Tabs
          items={[
            { key: "statistics", label: `Statistics (${totalResponses})` },
            { key: "responses", label: "Responses" },
            ...(showManagement ? [{ key: "edit", label: "Edit" }] : []),
          ]}
          active={tab}
          onChange={(key) => setTab(key as FormTab)}
          className="mb-3"
        />
        {tab === "statistics" && <FormResponseStats fields={detail.fields} stats={stats} total={totalResponses} />}
        {tab === "responses" && (
          <FormSubmissionsTable
            fields={detail.fields}
            endpoint={submissionEndpoint}
            params={submissionParams}
            deps={[formKey, slug, filters?.status, filters?.attendanceType]}
          />
        )}
        {tab === "edit" && (
          <FormEditor
            mode="edit"
            detail={detail}
            slug={slug}
            onSaved={() => {
              void load();
              onChanged?.();
            }}
            onCancel={() => setTab("statistics")}
          />
        )}
      </div>
    </div>
  );
}

export function Forms({ slug }: { slug?: string }) {
  const [, navigate] = useHashLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forms, setForms] = useState<AdminEventFormSummary[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = slug ? `/api/v1/admin/events/${slug}/forms` : "/api/v1/admin/forms";
      const data = await api<{ forms: AdminEventFormSummary[] }>(endpoint);
      setForms(data.forms ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <button class="btn btn-sm btn-success" onClick={() => setCreating(true)}>
          {slug ? "New event form" : "New global form"}
        </button>
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {creating && (
        <div class="card mb-3">
          <div class="card-header">
            <h6 class="mb-0">New form</h6>
          </div>
          <div class="card-body">
            <FormEditor
              mode="create"
              detail={null}
              slug={slug}
              onSaved={(key) => {
                setCreating(false);
                void load();
                if (!slug) navigate(`/forms/${key}`);
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        </div>
      )}

      <DataTable
        columns={[
          { header: "Key", cell: (form) => <span class="mono small">{form.key}</span> },
          ...(!slug
            ? [
                {
                  header: "Scope",
                  cell: (form: AdminEventFormSummary) =>
                    form.event_slug ? (
                      <Link
                        href={`/events/${form.event_slug}/registrations`}
                        onClick={(event: MouseEvent) => event.stopPropagation()}
                      >
                        {scopeLabel(form)}
                      </Link>
                    ) : (
                      scopeLabel(form)
                    ),
                  className: "small",
                },
              ]
            : []),
          { header: "Purpose", cell: (form) => form.purpose.replace(/_/g, " "), className: "small" },
          { header: "Status", cell: (form) => <span class="badge text-bg-secondary">{form.status}</span> },
          {
            header: { label: "Fields", className: "text-end" },
            cell: (form) => form.field_count,
            className: "mono text-end",
          },
          {
            header: { label: "Responses", className: "text-end" },
            cell: (form) => form.submission_count,
            className: "mono text-end",
          },
          { header: "Title", cell: (form) => form.title, className: "small" },
        ]}
        data={forms}
        empty="No forms configured"
        rowKey={(form) => form.id}
        onRowClick={(form) => {
          setCreating(false);
          navigate(`/forms/${form.key}`);
        }}
      />
    </div>
  );
}

export function FormDetailPage({ formKey }: { formKey: string }) {
  const [, navigate] = useHashLocation();

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button class="btn btn-sm btn-outline-secondary" onClick={() => navigate("/forms")}>
          ← Back
        </button>
      </div>
      <FormDetailPanel formKey={formKey} onChanged={() => navigate("/forms")} />
    </div>
  );
}

export function EventFormResponses({
  slug,
  purpose,
}: {
  slug: string;
  purpose: "event_registration" | "proposal_submission";
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forms, setForms] = useState<AdminEventFormSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [attendanceTypeFilter, setAttendanceTypeFilter] = useState("");
  const [attendanceOptions, setAttendanceOptions] = useState<AdminAttendanceOption[]>([]);

  const selected = useMemo(
    () => forms.find((form) => form.key === selectedKey) ?? forms[0] ?? null,
    [forms, selectedKey],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [formsData, attendance] = await Promise.all([
        api<{ forms: AdminEventFormSummary[] }>(`/api/v1/admin/events/${slug}/forms`),
        loadEventAttendanceOptions(slug, purpose),
      ]);
      setForms((formsData.forms ?? []).filter((form) => form.purpose === purpose));
      setAttendanceOptions(attendance);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [purpose, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedKey && forms.length > 0) setSelectedKey(forms[0].key);
  }, [forms, selectedKey]);

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!selected) return <p class="small text-body-secondary fst-italic mb-0">No linked forms found.</p>;

  const filters: FormResponseFilters = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(purpose === "event_registration" && attendanceTypeFilter ? { attendanceType: attendanceTypeFilter } : {}),
  };

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
        {forms.length > 1 && (
          <>
            <label class="form-label small fw-semibold mb-0">Form</label>
            <select
              class="form-select form-select-sm adm-filter-select"
              value={selected.key}
              onChange={(event) => setSelectedKey((event.target as HTMLSelectElement).value)}
            >
              {forms.map((form) => (
                <option key={form.key} value={form.key}>
                  {form.title}
                </option>
              ))}
            </select>
          </>
        )}
        <select
          class="form-select form-select-sm adm-filter-select"
          value={statusFilter}
          onChange={(event) => setStatusFilter((event.target as HTMLSelectElement).value)}
        >
          <option value="">All statuses</option>
          {purpose === "event_registration" ? (
            <>
              <option value="registered">Confirmed</option>
              <option value="pending_email_confirmation">Pending confirmation</option>
              <option value="waitlisted">Waitlisted</option>
              <option value="cancelled">Cancelled</option>
            </>
          ) : (
            <>
              <option value="submitted">Submitted</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="withdrawn">Withdrawn</option>
            </>
          )}
        </select>
        {purpose === "event_registration" && attendanceOptions.length > 0 && (
          <select
            class="form-select form-select-sm adm-filter-select"
            value={attendanceTypeFilter}
            onChange={(event) => setAttendanceTypeFilter((event.target as HTMLSelectElement).value)}
          >
            <option value="">All attendance</option>
            {attendanceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <FormDetailPanel formKey={selected.key} slug={slug} summary={selected} filters={filters} showManagement={false} />
    </div>
  );
}
