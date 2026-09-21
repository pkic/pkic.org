import { useCallback, useEffect, useId, useState } from "preact/hooks";
import { useHashQueryParam } from "../../../hooks/useHashQueryParam";
import {
  FORM_SUBMISSION_STATUS_LABELS,
  FORM_SUBMISSION_STATUSES,
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
  FORM_PURPOSES,
  FORM_STATUSES,
  type EventFormsPurpose,
  type FormDefinitionCreateInput,
  type FormDefinitionUpdateInput,
} from "../../../../shared/schemas/forms";
import {
  EVENT_REGISTRATION_STATUSES,
  eventRegistrationStatusLabel,
} from "../../../../shared/schemas/event-registrations";
import { deleteJson, getJson, patchJson, postJson } from "../../../shared/api-client";
import { formatDateTime } from "../../../shared/ui";
import { ApiDataTable } from "../../ApiDataTable";
import { confirmAction } from "../../ConfirmDialog";
import { EmptyState } from "../../EmptyState";
import { ErrorAlert } from "../../ErrorAlert";
import { FilterSelect, type FilterOption } from "../../FilterSelect";
import { Spinner } from "../../Spinner";
import { Tabs } from "../../Tabs";
import { Badge } from "../../Badge";
import { Button } from "../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { Toolbar } from "../../../ui/Toolbar";
import { FormDefinitionEditor, type EditableFormDetail } from "../FormDefinitionEditor";
import { FormResponseStats, type ServerFieldStat } from "../FormResponseStats";
import { FormSubmissionRecord, FormSubmissionsTable } from "../FormResponseViews";
// `pk-mono` lives in the design system's Content.css, which ships in a lazy
// chunk: a surface that writes the class name has to import the stylesheet
// itself, or the identifier renders in the body face once Bootstrap is gone.
import "../../../ui/Content.css";

type FormTab = "responses" | "statistics" | "edit";

function formScopeLabel(form: FormSummary): string {
  if (form.scope_type === "event") return form.event_name ?? form.scope_ref ?? "Event";
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

/**
 * The status vocabulary a submission filter offers. A registration form is
 * filtered by the canonical registration lifecycle; every other purpose by the
 * submission lifecycle, so the two sets stay named where they are defined
 * rather than restated as markup.
 *
 * The second branch used to be markup, and said the wrong thing: it offered
 * "Accepted" and "Rejected", which `form_submissions.status` cannot hold and
 * which therefore matched nothing, and never offered `draft`, which it can.
 */
function statusOptions(purpose: EventFormsPurpose): ReadonlyArray<FilterOption> {
  const all: FilterOption = { value: "", label: "All statuses" };
  if (purpose === "event_registration") {
    return [
      all,
      ...EVENT_REGISTRATION_STATUSES.map((entry) => ({ value: entry, label: eventRegistrationStatusLabel(entry) })),
    ];
  }
  return [
    all,
    ...FORM_SUBMISSION_STATUSES.map((status) => ({ value: status, label: FORM_SUBMISSION_STATUS_LABELS[status] })),
  ];
}

function formatTimestamp(value: string): string {
  // A non-instant stays visible as raw text instead of collapsing to the
  // formatter's em dash.
  const formatted = formatDateTime(value);
  return formatted === "—" ? value : formatted;
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
  showBack = true,
  responseTabLabel = "Responses",
}: {
  formKey: string;
  canWrite: boolean;
  onBack: () => void;
  onChanged?: () => void;
  notify?: (message: string, kind: "success" | "error") => void;
  submissionParams?: Record<string, string>;
  formEndpoint?: string;
  showBack?: boolean;
  responseTabLabel?: string;
}) {
  const [rawTab, setTab] = useHashQueryParam("formTab", "statistics");
  const [responseId, setResponseId] = useHashQueryParam("response", "");
  const tab: FormTab = rawTab === "responses" || rawTab === "edit" ? rawTab : "statistics";
  // The tab strip is the WAI-ARIA pattern, so each tab has to point at the
  // panel it controls and each panel back at its tab. The ids are generated
  // rather than derived from the form key, which can repeat across mounts.
  const tabPrefix = `${useId()}-form-tab`;
  const statisticsPanelId = `${tabPrefix}-statistics-panel`;
  const responsesPanelId = `${tabPrefix}-responses-panel`;
  const editPanelId = `${tabPrefix}-edit-panel`;
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
    const confirmed = await confirmAction({
      title: `Archive or delete "${detail?.form.title ?? formKey}"?`,
      consequences: [
        "A form with existing responses is archived and kept for records",
        "A form with no responses is deleted permanently",
      ],
      confirmLabel: "Archive or delete form",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      const result = await deleteJson(base, formDeleteResponseSchema);
      notify?.(result.message ?? `Form ${result.action}`, "success");
      onChanged?.();
      onBack();
    } catch (cause) {
      notify?.((cause as Error).message, "error");
    }
  }

  // The waiting and failed views carry the `pk` root too: without it the
  // design system's base layer never applies and the region falls back to
  // whatever the surrounding page happens to define.
  if (loading) return <Spinner label="Loading form…" />;
  if (error)
    return (
      <div class="pk">
        <ErrorAlert error={error} />
      </div>
    );
  if (!detail) return null;
  const canManageForm = canWrite && detail.form.scope_type !== "community";
  const effectiveTab: FormTab = responseId ? "responses" : tab === "edit" && !canManageForm ? "statistics" : tab;

  return (
    <div class="pk pk-stack">
      {showBack && (
        <div class="pk-cluster">
          <Button size="sm" onClick={onBack}>
            ← All forms
          </Button>
        </div>
      )}
      <Panel>
        <PanelHeader title={detail.form.title}>
          <Button size="sm" onClick={() => void load()}>
            Refresh
          </Button>
          {canManageForm && (
            <Button size="sm" variant="danger-quiet" onClick={() => void remove()}>
              Archive/Delete
            </Button>
          )}
        </PanelHeader>
        {/* The body's `gap` is the only spacing between the identity line, the
            tab strip and the active panel — no child carries a margin. */}
        <PanelBody class="pk-stack">
          <p class="pk-muted pk-small">
            <span class="pk-mono">{detail.form.key}</span> · {detail.form.purpose.replace(/_/g, " ")} · updated{" "}
            {formatTimestamp(detail.form.updated_at)}
          </p>
          <Tabs
            label={`${detail.form.title} sections`}
            items={[
              { key: "statistics", label: `Analytics (${totalResponses})`, panelId: statisticsPanelId },
              { key: "responses", label: responseTabLabel, panelId: responsesPanelId },
              ...(canManageForm ? [{ key: "edit", label: "Edit", panelId: editPanelId }] : []),
            ]}
            active={effectiveTab}
            onChange={(key) => setTab(key)}
            idPrefix={tabPrefix}
          />
          {effectiveTab === "statistics" && (
            <div id={statisticsPanelId} role="tabpanel" aria-labelledby={`${tabPrefix}-statistics`}>
              <FormResponseStats fields={detail.fields} stats={stats} total={totalResponses} />
            </div>
          )}
          {effectiveTab === "responses" && (
            <div id={responsesPanelId} role="tabpanel" aria-labelledby={`${tabPrefix}-responses`}>
              {responseId ? (
                <FormSubmissionRecord
                  fields={detail.fields}
                  endpoint={`${base}/submissions`}
                  responseSchema={formSubmissionsResponseSchema}
                  responseId={responseId}
                  onBack={() => setResponseId("")}
                />
              ) : (
                <FormSubmissionsTable
                  fields={detail.fields}
                  endpoint={`${base}/submissions`}
                  responseSchema={formSubmissionsResponseSchema}
                  params={submissionParams}
                  onOpen={(submission) => setResponseId(submission.id)}
                />
              )}
            </div>
          )}
          {effectiveTab === "edit" && canManageForm && (
            <div id={editPanelId} role="tabpanel" aria-labelledby={`${tabPrefix}-edit`}>
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
            </div>
          )}
        </PanelBody>
      </Panel>
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
    <div class="pk pk-stack">
      <div class="pk-cluster">
        <Button size="sm" onClick={onCancel}>
          ← All forms
        </Button>
      </div>
      <Panel>
        <PanelHeader title="New form" />
        <PanelBody>
          <FormDefinitionManagementEditor
            mode="create"
            detail={null}
            createEndpoint="/api/v1/forms"
            onSaved={onCreated}
            onCancel={onCancel}
            notify={notify}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}

export function FormManagementList() {
  return (
    <div class="pk">
      <ApiDataTable
        caption="Configured forms"
        urlState="forms"
        endpoint="/api/v1/forms"
        responseSchema={formsListResponseSchema}
        resolve={(response) => response.forms}
        resolvePage={(response) => response.page}
        paginate
        initialPageSize={25}
        initialSort="title"
        searchPlaceholder="Search forms…"
        columns={[
          // The presentational vocabulary is the column's, not a wrapper
          // span's: `Table` translates these onto the design system's cell
          // utilities and alignment in one place.
          { header: "Key", cell: (form: FormSummary) => form.key, className: "pk-mono pk-small" },
          // Both filters already exist on the list contract; each lives in
          // the column that shows the value it narrows, instead of leaving
          // purpose and status concepts the reader must express through
          // search syntax.
          {
            header: "Purpose",
            cell: (form: FormSummary) => form.purpose.replace(/_/g, " "),
            width: "fit",
            filter: {
              param: "purpose",
              options: [
                { value: "", label: "All purposes" },
                ...FORM_PURPOSES.map((purpose) => ({ value: purpose as string, label: purpose.replace(/_/g, " ") })),
              ],
            },
          },
          {
            header: "Status",
            cell: (form: FormSummary) => <Badge status={form.status} />,
            width: "fit",
            filter: {
              param: "status",
              options: [
                { value: "", label: "All statuses" },
                ...FORM_STATUSES.map((status) => ({ value: status as string, label: status })),
              ],
            },
          },
          { header: "Scope", cell: (form: FormSummary) => formScopeLabel(form), className: "pk-small" },
          {
            header: { label: "Fields", className: "pk-end" },
            cell: (form: FormSummary) => form.field_count,
            className: "pk-mono pk-end",
            width: "fit",
          },
          {
            header: { label: "Responses", className: "pk-end" },
            cell: (form: FormSummary) => form.submission_count,
            className: "pk-mono pk-end",
            width: "fit",
          },
          { header: "Title", cell: (form: FormSummary) => form.title, className: "pk-small" },
        ]}
        // Row activation is the design system's stretched control rather than
        // an "Open" button repeated down a column: every row gets a name that
        // says which form it opens, and the whole row is the target.
        rowAction={(form: FormSummary) => ({
          label: `Open ${form.title}`,
          href: `#/forms/${encodeURIComponent(form.key)}`,
        })}
        empty="No forms configured"
        rowKey={(form: FormSummary) => form.id}
      />
    </div>
  );
}

/** The one configured response set for an event flow. */
export function EventFormResponses({ eventSlug, purpose }: { eventSlug: string; purpose: EventFormsPurpose }) {
  const [formKey, setFormKey] = useState<string | null>(null);
  const [placementLoading, setPlacementLoading] = useState(true);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [attendanceType, setAttendanceType] = useState("");
  const [attendanceOptions, setAttendanceOptions] = useState<Array<{ value: string; label: string }>>([]);
  const submissionParams = {
    eventSlug,
    ...(status ? { status } : {}),
    ...(purpose === "event_registration" && attendanceType ? { attendanceType } : {}),
  };

  useEffect(() => {
    setPlacementLoading(true);
    setPlacementError(null);
    void getJson(
      `/api/v1/events/${encodeURIComponent(eventSlug)}/forms/placements/${encodeURIComponent(purpose)}`,
      eventFormsResponseSchema,
    )
      .then((response) => {
        setFormKey(response.form?.key ?? null);
        setAttendanceOptions(purpose === "event_registration" ? collectAttendanceOptions(response.eventDays) : []);
      })
      .catch((cause) => setPlacementError((cause as Error).message))
      .finally(() => setPlacementLoading(false));
  }, [eventSlug, purpose]);

  if (placementLoading) return <Spinner label="Loading responses…" />;
  if (placementError) return <ErrorAlert error={placementError} />;
  if (!formKey) {
    return <EmptyState title="No form is configured" body="This event flow has no active form to report on." />;
  }

  return (
    <div class="pk pk-stack pk-stack--snug">
      <Toolbar label="Response filters" class="pk-toolbar--single-row">
        <FilterSelect
          ariaLabel="Submission status"
          value={status}
          options={statusOptions(purpose)}
          onChange={setStatus}
        />
        {purpose === "event_registration" && attendanceOptions.length > 0 && (
          <FilterSelect
            ariaLabel="Attendance type"
            value={attendanceType}
            options={[{ value: "", label: "All attendance" }, ...attendanceOptions]}
            onChange={setAttendanceType}
          />
        )}
      </Toolbar>
      <FormManagementDetail
        formKey={formKey}
        canWrite={false}
        showBack={false}
        responseTabLabel="Individual responses"
        onBack={() => undefined}
        submissionParams={submissionParams}
        formEndpoint={`/api/v1/events/${encodeURIComponent(eventSlug)}/forms/${encodeURIComponent(formKey)}`}
      />
    </div>
  );
}
