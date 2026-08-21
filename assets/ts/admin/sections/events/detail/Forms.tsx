import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { z } from "zod";
import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { DataTable } from "../../../../components/Table";
import { Tabs } from "../../../../components/Tabs";
import { api } from "../../../api";
import { getAdminEventFormCatalogue } from "../../../services/catalogues";
import { fmt, toast } from "../../../ui";
import type { AdminAttendanceOption, AdminEventFormSummary } from "../../../types";
import { FormEditor, type AdminFormDetail } from "./FormEditor";
import { FormResponseStats, FormSubmissionsTable, type ServerFieldStat } from "./FormResponses";
import { adminFormSubmissionStatsResponseSchema } from "../../../../../shared/schemas/api";
import { loadEventAttendanceOptions } from "./eventAttendance";

type FormTab = "responses" | "statistics" | "edit";

type FormSubmissionStatsResponse = z.infer<typeof adminFormSubmissionStatsResponseSchema>;

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
  const statsParams = responseQueryParams(slug, filters);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statsQuery = new URLSearchParams(statsParams).toString();
      const [detailRes, submissionRes] = await Promise.all([
        api<AdminFormDetail>(`/api/v1/admin/forms/${formKey}`),
        api<unknown>(`${submissionEndpoint}/stats${statsQuery ? `?${statsQuery}` : ""}`),
      ]);
      const parsedStats = adminFormSubmissionStatsResponseSchema.parse(submissionRes) as FormSubmissionStatsResponse;
      setDetail(detailRes);
      setStats(parsedStats.stats);
      setTotalResponses(parsedStats.total);
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
        getAdminEventFormCatalogue(slug, purpose),
        loadEventAttendanceOptions(slug, purpose),
      ]);
      setForms(formsData);
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
