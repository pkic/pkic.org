import { useCallback, useEffect, useState } from "preact/hooks";
import {
  formCreateResponseSchema,
  formDeleteResponseSchema,
  formDetailResponseSchema,
  formsListResponseSchema,
  formSubmissionStatsResponseSchema,
  formSubmissionsResponseSchema,
  formUpdateResponseSchema,
  type FormDetailResponse,
  type FormSummary,
} from "../../../../shared/schemas/form-management";
import {
  eventFormsResponseSchema,
  type EventFormsPurpose,
  type FormDefinitionCreateInput,
  type FormDefinitionUpdateInput,
} from "../../../../shared/schemas/forms";
import {
  EVENT_REGISTRATION_STATUSES,
  eventRegistrationStatusLabel,
} from "../../../../shared/schemas/event-registrations";
import { deleteJson, getJson, patchJson, postJson } from "../../../shared/api-client";
import { ApiDataTable } from "../../ApiDataTable";
import { ErrorAlert } from "../../ErrorAlert";
import { Spinner } from "../../Spinner";
import { Tabs } from "../../Tabs";
import { FormDefinitionEditor, type EditableFormDetail } from "../FormDefinitionEditor";
import { FormResponseStats, FormSubmissionsTable, type ServerFieldStat } from "../FormResponseViews";

type FormTab = "responses" | "statistics" | "edit";

function formScopeLabel(form: FormSummary): string {
  if (form.scope_type === "event") return form.event_name ?? form.scope_ref ?? "Event";
  if (form.scope_type === "community") return "Community";
  if (form.scope_type === "global") return "Global";
  if (form.scope_type === "community") return "Community";
  if (form.scope_type === "global") return "Global";
  return form.scope_type.replace(/_/g, " ");
}

function collectAttendanceOptions(
  days: Array<{ attendanceOptions?: Array<{ value: string; label: string }> }>,
): Array<{ value: string; label: string }> {
  const options = new Map<string, { value: string; label: string }>();
  for (const day of days) {
    for (const option of day.attendanceOptions ?? []) {
      options.set(option.value, option);
    }
  }
  return [...options.values()];
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function FormDefinitionManagementEditor({
  mode,
  detail,
  createEndpoint,
  updateEndpoint,
  onSaved,
  onCancel,
  notify,
}: {
  mode: "create" | "edit";
  detail: FormDetailResponse | null;
  createEndpoint: string;
  updateEndpoint?: string;
  onSaved: (key: string) => void;
  onCancel: () => void;
  notify?: (message: string, kind: "success" | "error") => void;
}) {
  async function save(payload: FormDefinitionCreateInput | FormDefinitionUpdateInput): Promise<string> {
    if (mode === "create") {
      const created = await postJson(createEndpoint, payload, formCreateResponseSchema);
      notify?.("Form created", "success");
      return created.key;
    }
    if (!detail) throw new Error("The form definition is unavailable.");
    const updated = await patchJson(
      updateEndpoint ?? `/api/v1/forms/${encodeURIComponent(detail.form.key)}`,
      payload,
      formUpdateResponseSchema,
    );
    notify?.("Form updated", "success");
    return updated.form.key;
  }

  return (
    <FormDefinitionEditor
      mode={mode}
      detail={detail as EditableFormDetail | null}
      onSave={save}
      onSaved={onSaved}
      onCancel={onCancel}
      onError={(message) => notify?.(message, "error")}
    />
  );
}

export function FormManagementDetail({
  formKey,
  canWrite,
  onBack,
  onChanged,
  notify,
  submissionParams,
  formEndpoint,
}: {
  formKey: string;
  canWrite: boolean;
  onBack: () => void;
  onChanged?: () => void;
  notify?: (message: string, kind: "success" | "error") => void;
  submissionParams?: Record<string, string>;
  formEndpoint?: string;
}) {
  const [tab, setTab] = useState<FormTab>("statistics");
  const [detail, setDetail] = useState<FormDetailResponse | null>(null);
  const [stats, setStats] = useState<ServerFieldStat[]>([]);
  const [totalResponses, setTotalResponses] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const encodedKey = encodeURIComponent(formKey);
  const base = formEndpoint ?? `/api/v1/forms/${encodedKey}`;
  const submissionQuery = new URLSearchParams(submissionParams).toString();
  const statsEndpoint = `${base}/submissions/stats${submissionQuery ? `?${submissionQuery}` : ""}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextDetail, nextStats] = await Promise.all([
        getJson(base, formDetailResponseSchema),
        getJson(statsEndpoint, formSubmissionStatsResponseSchema),
      ]);
      setDetail(nextDetail);
      setStats(nextStats.stats);
      setTotalResponses(nextStats.total);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base, statsEndpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(): Promise<void> {
    if (!window.confirm(`Archive or delete form ${formKey}?`)) return;
    try {
      const result = await deleteJson(base, formDeleteResponseSchema);
      notify?.(result.message ?? `Form ${result.action}`, "success");
      onChanged?.();
      onBack();
    } catch (cause) {
      notify?.((cause as Error).message, "error");
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!detail) return null;
  const canManageForm = canWrite && detail.form.scope_type !== "community";

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onBack}>
          ← All forms
        </button>
      </div>
      <div class="card">
        <div class="card-header d-flex align-items-center gap-2 flex-wrap">
          <div>
            <h6 class="mb-0">{detail.form.title}</h6>
            <div class="small text-muted">
              <span class="mono">{detail.form.key}</span> · {detail.form.purpose.replace(/_/g, " ")} · updated{" "}
              {formatTimestamp(detail.form.updated_at)}
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void load()}>
            Refresh
          </button>
          {canManageForm && (
            <button type="button" class="btn btn-sm btn-outline-danger" onClick={() => void remove()}>
              Archive/Delete
            </button>
          )}
        </div>
        <div class="card-body">
          <Tabs
            items={[
              { key: "statistics", label: `Statistics (${totalResponses})` },
              { key: "responses", label: "Responses" },
              ...(canManageForm ? [{ key: "edit", label: "Edit" }] : []),
            ]}
            active={tab}
            onChange={(key) => setTab(key as FormTab)}
            className="mb-3"
          />
          {tab === "statistics" && <FormResponseStats fields={detail.fields} stats={stats} total={totalResponses} />}
          {tab === "responses" && (
            <FormSubmissionsTable
              fields={detail.fields}
              endpoint={`${base}/submissions`}
              responseSchema={formSubmissionsResponseSchema}
              params={submissionParams}
            />
          )}
          {tab === "edit" && canManageForm && (
            <FormDefinitionManagementEditor
              mode="edit"
              detail={detail}
              createEndpoint="/api/v1/forms"
              updateEndpoint={base}
              onSaved={() => {
                void load();
                onChanged?.();
              }}
              onCancel={() => setTab("statistics")}
              notify={notify}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Distinct create-form view: replaces the forms list rather than layering above it. */
export function FormManagementCreate({
  onCreated,
  onCancel,
  notify,
}: {
  onCreated: (formKey: string) => void;
  onCancel: () => void;
  notify?: (message: string, kind: "success" | "error") => void;
}) {
  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onCancel}>
          ← All forms
        </button>
      </div>
      <div class="card">
        <div class="card-header">
          <h6 class="mb-0">New form</h6>
        </div>
        <div class="card-body">
          <FormDefinitionManagementEditor
            mode="create"
            detail={null}
            createEndpoint="/api/v1/forms"
            onSaved={onCreated}
            onCancel={onCancel}
            notify={notify}
          />
        </div>
      </div>
    </div>
  );
}

export function FormManagementList({
  canWrite,
  onOpenForm,
  onCreateNew,
}: {
  canWrite: boolean;
  onOpenForm: (formKey: string) => void;
  onCreateNew?: () => void;
}) {
  return (
    <div>
      {canWrite && onCreateNew && (
        <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
          <button type="button" class="btn btn-sm btn-success" onClick={onCreateNew}>
            New form
          </button>
        </div>
      )}
      <ApiDataTable
        endpoint="/api/v1/forms"
        responseSchema={formsListResponseSchema}
        resolve={(response) => response.forms}
        resolvePage={(response) => response.page}
        paginate
        initialPageSize={25}
        initialSort="title"
        searchPlaceholder="Search forms…"
        columns={[
          { header: "Key", cell: (form: FormSummary) => <span class="mono small">{form.key}</span> },
          {
            header: "Purpose",
            cell: (form: FormSummary) => form.purpose.replace(/_/g, " "),
            className: "small",
          },
          { header: "Status", cell: (form: FormSummary) => <span class="badge text-bg-secondary">{form.status}</span> },
          { header: "Scope", cell: (form: FormSummary) => formScopeLabel(form), className: "small" },
          {
            header: { label: "Fields", className: "text-end" },
            cell: (form: FormSummary) => form.field_count,
            className: "mono text-end",
          },
          {
            header: { label: "Responses", className: "text-end" },
            cell: (form: FormSummary) => form.submission_count,
            className: "mono text-end",
          },
          { header: "Title", cell: (form: FormSummary) => form.title, className: "small" },
          {
            header: "",
            cell: (form: FormSummary) => (
              <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => onOpenForm(form.key)}>
                Open
              </button>
            ),
          },
        ]}
        empty="No forms configured"
        rowKey={(form: FormSummary) => form.id}
      />
    </div>
  );
}

/** Shared read-only event response view used while legacy event tabs remain. */
export function EventFormResponses({ eventSlug, purpose }: { eventSlug: string; purpose: EventFormsPurpose }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [attendanceType, setAttendanceType] = useState("");
  const [attendanceOptions, setAttendanceOptions] = useState<Array<{ value: string; label: string }>>([]);
  const formsEndpoint = `/api/v1/events/${encodeURIComponent(eventSlug)}/forms`;
  const submissionParams = {
    eventSlug,
    ...(status ? { status } : {}),
    ...(purpose === "event_registration" && attendanceType ? { attendanceType } : {}),
  };

  useEffect(() => {
    if (purpose !== "event_registration") {
      setAttendanceOptions([]);
      return;
    }
    void getJson(
      `/api/v1/events/${encodeURIComponent(eventSlug)}/forms/placements/${encodeURIComponent(purpose)}`,
      eventFormsResponseSchema,
    )
      .then((response) => setAttendanceOptions(collectAttendanceOptions(response.eventDays)))
      .catch(() => setAttendanceOptions([]));
  }, [eventSlug, purpose]);

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <label class="visually-hidden" for={`form-response-status-${purpose}`}>
          Submission status
        </label>
        <select
          id={`form-response-status-${purpose}`}
          class="form-select form-select-sm adm-filter-select"
          value={status}
          onChange={(event) => setStatus((event.target as HTMLSelectElement).value)}
        >
          <option value="">All statuses</option>
          {purpose === "event_registration" ? (
            EVENT_REGISTRATION_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {eventRegistrationStatusLabel(entry)}
              </option>
            ))
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
          <>
            <label class="visually-hidden" for={`form-response-attendance-${purpose}`}>
              Attendance type
            </label>
            <select
              id={`form-response-attendance-${purpose}`}
              class="form-select form-select-sm adm-filter-select"
              value={attendanceType}
              onChange={(event) => setAttendanceType((event.target as HTMLSelectElement).value)}
            >
              <option value="">All attendance</option>
              {attendanceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      {!selectedKey ? (
        <ApiDataTable
          endpoint={formsEndpoint}
          responseSchema={formsListResponseSchema}
          resolve={(response) => response.forms}
          resolvePage={(response) => response.page}
          params={{ purpose, linkedOnly: "1" }}
          paginate
          initialPageSize={25}
          initialSort="title"
          searchPlaceholder="Search event forms…"
          columns={[
            { header: "Title", cell: (form: FormSummary) => form.title },
            { header: "Key", cell: (form: FormSummary) => <span class="mono small">{form.key}</span> },
            { header: "Responses", cell: (form: FormSummary) => form.submission_count, className: "text-end mono" },
            {
              header: "",
              cell: (form: FormSummary) => (
                <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => setSelectedKey(form.key)}>
                  Open
                </button>
              ),
            },
          ]}
          empty="No linked forms found"
          rowKey={(form: FormSummary) => form.id}
        />
      ) : (
        <FormManagementDetail
          formKey={selectedKey}
          canWrite={false}
          onBack={() => setSelectedKey(null)}
          submissionParams={submissionParams}
          formEndpoint={`/api/v1/events/${encodeURIComponent(eventSlug)}/forms/${encodeURIComponent(selectedKey)}`}
        />
      )}
    </div>
  );
}
