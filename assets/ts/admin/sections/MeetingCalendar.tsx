/**
 * Admin → Meeting Calendar.
 * it. Two tabs mirror the two admin surfaces names — "Consortium"
 * (`/api/v1/admin/consortium/meetings`) and "Working Groups" (a WG picker
 * over `/api/v1/admin/working-groups/:id/meetings`) — both rendered by the
 * same MeetingSeriesManager, which is the only part that actually talks to
 * the API.
 */
import { useEffect, useState } from "preact/hooks";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { Tabs } from "../../components/Tabs";
import { api } from "../api";
import { toast } from "../ui";
import type { AdminIcsFile, AdminMeetingSeries, MeetingResendResult } from "../types";
import { adminWorkingGroupCatalog } from "../services/catalogs";
import { performAdminAction } from "../actions";
import { ServerSearchSelect } from "../components/ServerSearchSelect";

const CURRENT_YEAR = new Date().getFullYear();

function IcsFileRow({
  file,
  baseUrl,
  seriesId,
  onChanged,
}: {
  file: AdminIcsFile;
  baseUrl: string;
  seriesId: string;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(file.label);
  const [busy, setBusy] = useState(false);

  async function saveLabel() {
    if (!label.trim() || label.trim() === file.label) {
      setEditing(false);
      return;
    }
    await performAdminAction({
      setBusy,
      request: () =>
        api(`${baseUrl}/${seriesId}/ics-files/${file.id}`, {
          method: "PATCH",
          body: JSON.stringify({ label: label.trim() }),
        }),
      successMessage: "Label updated",
      afterSuccess: async () => {
        setEditing(false);
        await onChanged();
      },
    });
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await api(`${baseUrl}/${seriesId}/ics-files/${file.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !file.active }),
      });
      toast(
        file.active
          ? "File deactivated — members with this preference will get all active variants"
          : "File reactivated",
        "success",
      );
      await onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete "${file.label}" outright? This removes the file (unlike Deactivate, which just hides it) and can't be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`${baseUrl}/${seriesId}/ics-files/${file.id}`, { method: "DELETE" });
      toast("ICS file deleted", "success");
      await onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        {editing ? (
          <div class="d-flex gap-1">
            <input
              class="form-control form-control-sm"
              value={label}
              onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
              disabled={busy}
            />
            <button class="btn btn-sm btn-success" disabled={busy} onClick={saveLabel}>
              Save
            </button>
            <button
              class="btn btn-sm btn-outline-secondary"
              disabled={busy}
              onClick={() => {
                setLabel(file.label);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <span class="link-primary" role="button" onClick={() => setEditing(true)}>
            {file.label}
          </span>
        )}
      </td>
      <td class="text-muted small">{file.year}</td>
      <td>
        {file.active ? (
          <span class="badge text-bg-success">Active</span>
        ) : (
          <span class="badge text-bg-secondary">Inactive</span>
        )}
      </td>
      <td class="text-end">
        <div class="d-flex gap-1 justify-content-end">
          <button
            class={`btn btn-sm ${file.active ? "btn-outline-danger" : "btn-outline-success"}`}
            disabled={busy}
            onClick={toggleActive}
          >
            {file.active ? "Deactivate" : "Reactivate"}
          </button>
          <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={remove}>
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

function IcsUploadForm({
  baseUrl,
  seriesId,
  onUploaded,
}: {
  baseUrl: string;
  seriesId: string;
  onUploaded: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (!file || !label.trim() || !year.trim()) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("label", label.trim());
      body.append("year", year.trim());
      const res = await fetch(`${baseUrl}/${seriesId}/ics-files`, {
        method: "POST",
        credentials: "same-origin",
        body,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      toast("ICS file uploaded", "success");
      setLabel("");
      setYear(String(CURRENT_YEAR));
      setFile(null);
      (e.target as HTMLFormElement).reset();
      await onUploaded();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={submit} class="row g-2 align-items-end">
      <div class="col-sm-3">
        <label class="form-label small">ICS file</label>
        <input
          type="file"
          accept=".ics,text/calendar"
          class="form-control form-control-sm"
          disabled={uploading}
          onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)}
        />
      </div>
      <div class="col-sm-3">
        <label class="form-label small">Label</label>
        <input
          class="form-control form-control-sm"
          placeholder="09:00 CET"
          value={label}
          onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
          disabled={uploading}
        />
      </div>
      <div class="col-sm-2">
        <label class="form-label small">Year</label>
        <input
          type="number"
          class="form-control form-control-sm"
          value={year}
          onInput={(e) => setYear((e.target as HTMLInputElement).value)}
          disabled={uploading}
        />
      </div>
      <div class="col-sm-2">
        <button type="submit" class="btn btn-sm btn-success" disabled={uploading || !file || !label.trim()}>
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
}

function MeetingSeriesCard({
  series,
  baseUrl,
  onChanged,
}: {
  series: AdminMeetingSeries;
  baseUrl: string;
  onChanged: () => Promise<void>;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(series.name);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function saveName() {
    if (!name.trim() || name.trim() === series.name) {
      setEditingName(false);
      return;
    }
    await performAdminAction({
      setBusy,
      request: () => api(`${baseUrl}/${series.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) }),
      successMessage: "Series renamed",
      afterSuccess: async () => {
        setEditingName(false);
        await onChanged();
      },
    });
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await api(`${baseUrl}/${series.id}`, { method: "PATCH", body: JSON.stringify({ active: !series.active }) });
      toast(series.active ? "Series deactivated" : "Series reactivated", "success");
      await onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (
      !confirm(
        `Trigger the annual resend for "${series.name}"? Members with a saved preference get their chosen file; everyone else gets every active variant.`,
      )
    ) {
      return;
    }
    setResending(true);
    try {
      const result = await api<MeetingResendResult>(`${baseUrl}/${series.id}/resend`, { method: "POST" });
      toast(`Resend queued for ${result.queuedRecipients} recipient(s)`, "success");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setResending(false);
    }
  }

  async function remove() {
    const fileCount = series.icsFiles.length;
    const warning =
      fileCount > 0
        ? ` It has ${fileCount} ICS file variant${fileCount === 1 ? "" : "s"}, which will be deleted too.`
        : "";
    if (!confirm(`Delete the meeting series "${series.name}"?${warning} This can't be undone.`)) return;
    setDeleting(true);
    try {
      await api(`${baseUrl}/${series.id}`, { method: "DELETE" });
      toast("Meeting series deleted", "success");
      await onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
      setDeleting(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white d-flex align-items-center gap-2">
        {editingName ? (
          <div class="d-flex gap-1 flex-grow-1">
            <input
              class="form-control form-control-sm"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              disabled={busy}
            />
            <button class="btn btn-sm btn-success" disabled={busy} onClick={saveName}>
              Save
            </button>
            <button
              class="btn btn-sm btn-outline-secondary"
              disabled={busy}
              onClick={() => {
                setName(series.name);
                setEditingName(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <span class="fw-semibold flex-grow-1 link-primary" role="button" onClick={() => setEditingName(true)}>
              {series.name}
            </span>
            {series.active ? (
              <span class="badge text-bg-success">Active</span>
            ) : (
              <span class="badge text-bg-secondary">Inactive</span>
            )}
            <button
              class={`btn btn-sm ${series.active ? "btn-outline-danger" : "btn-outline-success"}`}
              disabled={busy}
              onClick={toggleActive}
            >
              {series.active ? "Deactivate" : "Reactivate"}
            </button>
            <button class="btn btn-sm btn-outline-primary" disabled={resending} onClick={resend}>
              {resending ? "Sending…" : "Trigger annual resend"}
            </button>
            <button class="btn btn-sm btn-outline-danger" disabled={deleting} onClick={remove}>
              {deleting ? "Deleting…" : "Delete series"}
            </button>
          </>
        )}
      </div>
      <div class="card-body">
        {series.icsFiles.length === 0 ? (
          <p class="text-muted small">No ICS file variants uploaded yet.</p>
        ) : (
          <table class="table table-sm align-middle mb-3">
            <thead>
              <tr>
                <th>Label</th>
                <th>Year</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {series.icsFiles.map((file) => (
                <IcsFileRow key={file.id} file={file} baseUrl={baseUrl} seriesId={series.id} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        )}
        <IcsUploadForm baseUrl={baseUrl} seriesId={series.id} onUploaded={onChanged} />
      </div>
    </div>
  );
}

function CreateSeriesForm({ baseUrl, onCreated }: { baseUrl: string; onCreated: () => Promise<void> }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    await performAdminAction({
      setBusy: setSaving,
      request: () => api(baseUrl, { method: "POST", body: JSON.stringify({ name: name.trim() }) }),
      successMessage: "Meeting series created",
      afterSuccess: async () => {
        setName("");
        setShow(false);
        await onCreated();
      },
    });
  }

  if (!show) {
    return (
      <button class="btn btn-sm btn-outline-success mb-3" onClick={() => setShow(true)}>
        + New meeting series
      </button>
    );
  }

  return (
    <form onSubmit={submit} class="d-flex gap-2 align-items-end mb-3">
      <div>
        <label class="form-label small fw-semibold">Series name</label>
        <input
          class="form-control form-control-sm"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          disabled={saving}
          required
        />
      </div>
      <button type="submit" class="btn btn-sm btn-success" disabled={saving || !name.trim()}>
        {saving ? "Creating…" : "Create"}
      </button>
      <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => setShow(false)} disabled={saving}>
        Cancel
      </button>
    </form>
  );
}

/** Manages meeting series for either the consortium or a single working group, keyed by `baseUrl`. */
function MeetingSeriesManager({ baseUrl }: { baseUrl: string }) {
  const [series, setSeries] = useState<AdminMeetingSeries[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<{ meetingSeries: AdminMeetingSeries[] }>(baseUrl);
      setSeries(data.meetingSeries);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    setSeries(null);
    void load();
  }, [baseUrl]);

  if (error) return <ErrorAlert error={error} />;
  if (!series) return <Spinner />;

  return (
    <div>
      <CreateSeriesForm baseUrl={baseUrl} onCreated={load} />
      {series.length === 0 ? (
        <p class="text-muted fst-italic">No meeting series yet.</p>
      ) : (
        series.map((s) => <MeetingSeriesCard key={s.id} series={s} baseUrl={baseUrl} onChanged={load} />)
      )}
    </div>
  );
}

function WorkingGroupMeetingsTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string>();

  return (
    <div>
      <div class="mb-3 adm-filter-control">
        <ServerSearchSelect
          catalog={adminWorkingGroupCatalog}
          label="Working group"
          value={selectedId}
          selectedLabel={selectedLabel}
          allowEmpty={false}
          autoSelectFirst
          onChange={(group) => {
            setSelectedId(group?.id ?? null);
            setSelectedLabel(group ? adminWorkingGroupCatalog.itemLabel(group) : undefined);
          }}
        />
      </div>
      {selectedId ? (
        <MeetingSeriesManager key={selectedId} baseUrl={`/api/v1/admin/working-groups/${selectedId}/meetings`} />
      ) : (
        <p class="text-muted fst-italic">No working groups exist yet.</p>
      )}
    </div>
  );
}

const TABS = [
  { key: "consortium", label: "Consortium" },
  { key: "working-groups", label: "Working Groups" },
];

export function MeetingCalendar() {
  const [tab, setTab] = useState("consortium");

  return (
    <div>
      <p class="text-muted small">
        Manage meeting series and their ICS file variants. Deactivating a file automatically switches any member whose
        saved preference pointed at it to receiving all active variants on the next resend.
      </p>
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === "consortium" && <MeetingSeriesManager baseUrl="/api/v1/admin/consortium/meetings" />}
      {tab === "working-groups" && <WorkingGroupMeetingsTab />}
    </div>
  );
}
