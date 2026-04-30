import { useState } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../../../components/Badge";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { DataTable } from "../../../../components/Table";
import { api } from "../../../api";
import { fmt, toast } from "../../../ui";
import type { Registration, AdminEventDay, BadgeRoleInfo } from "../../../types";
import { useData } from "../../../../hooks/useData";

const ROLE_BADGE_COLOUR: Record<string, string> = {
  attendee: "primary",
  speaker: "success",
  moderator: "warning",
  panelist: "warning",
  organizer: "info",
  staff: "secondary",
};

function attendanceTypeLabel(t: string): string {
  return { in_person: "In-person", virtual: "Virtual", on_demand: "On-demand" }[t] ?? t;
}

// ─── Day attendance table ─────────────────────────────────────────────────────

type DayOption = "none" | "in_person" | "virtual" | "on_demand";

const DAY_OPTIONS: { value: DayOption; label: string }[] = [
  { value: "none", label: "Not attending" },
  { value: "in_person", label: "In-person" },
  { value: "virtual", label: "Virtual" },
  { value: "on_demand", label: "On-demand" },
];

function DayAttendancePanel({
  dayAttendance,
  eventDays,
  registrationStatus,
  slug,
  regId,
  onReload,
}: {
  dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
  eventDays: AdminEventDay[];
  registrationStatus: string;
  slug: string;
  regId: string;
  onReload: () => void;
}) {
  const [pending, setPending] = useState<Record<string, DayOption>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  if (!eventDays.length) return <p class="small text-muted fst-italic mb-0">No event days configured.</p>;

  const attendanceByDate = new Map(dayAttendance.map((d) => [d.dayDate, d.attendanceType as DayOption]));
  const rows = eventDays.map((d) => ({
    dayDate: d.date,
    label: d.label,
    current: attendanceByDate.get(d.date) ?? ("none" as DayOption),
  }));

  async function applyChange(dayDate: string, action: DayOption) {
    setSaving((s) => ({ ...s, [dayDate]: true }));
    try {
      if (action === "in_person") {
        await api(`/api/v1/admin/events/${slug}/registrations/${regId}/admit`, {
          method: "POST",
          body: JSON.stringify({
            mode: "capacity_exempt",
            reason: "Admin approved in-person admission",
            dayDates: [dayDate],
          }),
        });
      } else {
        await api(`/api/v1/admin/events/${slug}/registrations/${regId}/day-attendance`, {
          method: "PATCH",
          body: JSON.stringify({ action: action === "none" ? "remove" : action, dayDates: [dayDate] }),
        });
      }
      toast(`Day ${dayDate} updated`, "success");
      setPending((p) => {
        const n = { ...p };
        delete n[dayDate];
        return n;
      });
      onReload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving((s) => ({ ...s, [dayDate]: false }));
    }
  }

  return (
    <>
      {registrationStatus === "waitlisted" && (
        <div class="alert alert-info small py-2 mb-3">
          This registration is <strong>waitlisted</strong>. Setting a day to in-person will promote them to registered
          (capacity-exempt) and send a confirmation email.
        </div>
      )}
      <DataTable
        columns={[
          { header: "Date", cell: (d) => d.dayDate, className: "mono small" },
          { header: "Day", cell: (d) => d.label ?? "—", className: "small" },
          {
            header: "Attendance",
            cell: (d) => {
              const selected = pending[d.dayDate] ?? d.current;
              const isSaving = saving[d.dayDate] ?? false;
              const changed = selected !== d.current;
              return (
                <div class="d-flex gap-1 align-items-center">
                  <select
                    class="form-select form-select-sm adm-filter-select"
                    value={selected}
                    disabled={isSaving}
                    onChange={(e) => {
                      const v = (e.target as HTMLSelectElement).value as DayOption;
                      setPending((p) => ({ ...p, [d.dayDate]: v }));
                    }}
                  >
                    {DAY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {changed && (
                    <button
                      class="btn btn-sm btn-primary text-nowrap"
                      disabled={isSaving}
                      onClick={() => void applyChange(d.dayDate, selected)}
                    >
                      {isSaving ? "…" : "Apply"}
                    </button>
                  )}
                </div>
              );
            },
          },
        ]}
        data={rows}
        className="align-middle"
        rowKey={(d) => d.dayDate}
      />
    </>
  );
}

// ─── Day waitlist table ───────────────────────────────────────────────────────

function DayWaitlistTable({
  dayWaitlist,
}: {
  dayWaitlist: Array<{ dayDate: string; status: string; priorityLane: string; offerExpiresAt: string | null }>;
}) {
  if (!dayWaitlist.length) return <p class="small text-muted fst-italic mb-0">No waitlist entries.</p>;
  const statusColour: Record<string, string> = {
    waiting: "warning",
    offered: "info",
    accepted: "success",
    expired: "secondary",
  };
  return (
    <DataTable
      columns={[
        { header: "Date", cell: (w) => w.dayDate, className: "mono small" },
        {
          header: "Status",
          cell: (w) => <span class={`badge text-bg-${statusColour[w.status] ?? "secondary"}`}>{w.status}</span>,
        },
        { header: "Priority", cell: (w) => w.priorityLane, className: "small" },
        {
          header: "Offer expires",
          cell: (w) => (w.offerExpiresAt ? fmt(w.offerExpiresAt) : "—"),
          className: "mono small",
        },
      ]}
      data={dayWaitlist}
      className="align-middle"
      rowKey={(w) => w.dayDate}
    />
  );
}

// ─── Badge role panel ─────────────────────────────────────────────────────────

function BadgeRolePanel({ slug, regId }: { slug: string; regId: string }) {
  const [info, setInfo] = useState<BadgeRoleInfo | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  const { loading } = useData(
    () =>
      api<BadgeRoleInfo>(`/api/v1/admin/events/${slug}/registrations/${regId}/badge-role`).then((d) => {
        setInfo(d);
        setSelectedRole(d.admin_override ?? "");
        return d;
      }),
    [slug, regId],
  );

  async function handleSave() {
    setSaving(true);
    setSaveStatus("");
    try {
      const res = await api<BadgeRoleInfo>(`/api/v1/admin/events/${slug}/registrations/${regId}/badge-role`, {
        method: "PATCH",
        body: JSON.stringify({ role: selectedRole || null }),
      });
      setInfo(res);
      setSelectedRole(res.admin_override ?? "");
      toast("Badge role updated", "success");
    } catch (e) {
      setSaveStatus((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!info) return loading ? <Spinner /> : null;

  const colour = ROLE_BADGE_COLOUR[info.effective_role] ?? "secondary";
  return (
    <div>
      <div class="d-flex align-items-center gap-2 flex-wrap mb-2">
        <span class="small text-muted">Effective:</span>
        <span class={`badge text-bg-${colour}`}>{info.effective_role}</span>
        {info.admin_override ? (
          <span class="small text-muted ms-1">(forced; auto would be {info.auto_detected})</span>
        ) : (
          <span class="small text-muted fst-italic ms-1">(auto-detected)</span>
        )}
      </div>
      <div class="d-flex align-items-center gap-2">
        <select
          class="form-select form-select-sm adm-filter-select"
          value={selectedRole}
          onChange={(e) => setSelectedRole((e.target as HTMLSelectElement).value)}
        >
          <option value="">Auto ({info.auto_detected})</option>
          {info.available_roles.map((r) => (
            <option key={r} value={r}>
              {r.charAt(0).toUpperCase() + r.slice(1).replace("_", "-")}
            </option>
          ))}
        </select>
        <button class="btn btn-sm btn-primary" onClick={() => void handleSave()} disabled={saving}>
          Save
        </button>
        {saveStatus && <span class="small text-danger">{saveStatus}</span>}
      </div>
    </div>
  );
}

// ─── Audit log ────────────────────────────────────────────────────────────────

function AuditLogSection({ slug, regId }: { slug: string; regId: string }) {
  const { data: entries, loading } = useData(
    () =>
      api<{
        auditLog: Array<{
          created_at: string;
          actor_type: string;
          actor_display?: string;
          actor_id?: string;
          action: string;
          details?: Record<string, unknown>;
        }>;
      }>(`/api/v1/admin/events/${slug}/registrations/${regId}/audit-log`).then((d) => d.auditLog ?? []),
    [slug, regId],
  );

  if (loading) return <Spinner />;
  if (!entries?.length) return <p class="small text-body-secondary mb-0">No audit log entries.</p>;

  return (
    <DataTable
      columns={[
        {
          header: "When",
          cell: (entry) =>
            new Date(entry.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium" }),
          className: "text-nowrap small text-muted",
        },
        {
          header: "Actor",
          cell: (entry) => {
            const actor =
              entry.actor_type === "system" ? (
                <span class="text-muted">System</span>
              ) : entry.actor_display ? (
                <>{entry.actor_display}</>
              ) : entry.actor_id ? (
                <span class="text-muted small">{entry.actor_id}</span>
              ) : (
                <span class="text-muted">{entry.actor_type}</span>
              );
            return actor;
          },
          className: "small",
        },
        { header: "Action", cell: (entry) => <code class="small">{entry.action}</code> },
        {
          header: "Details",
          cell: (entry) =>
            entry.details ? (
              <pre class="mb-0 small text-body-secondary">{JSON.stringify(entry.details, null, 2)}</pre>
            ) : null,
        },
      ]}
      data={entries}
      className="align-middle"
    />
  );
}

// ─── Inline email editor ──────────────────────────────────────────────────────

function EmailEditor({
  email,
  slug,
  regId,
  isCancelled,
  attendanceType,
  onSaved,
}: {
  email: string;
  slug: string;
  regId: string;
  isCancelled: boolean;
  attendanceType?: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(email);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!editing) {
    return (
      <div class="d-flex align-items-center gap-1">
        <span>{email}</span>
        <button
          class="btn btn-link btn-sm p-0 ms-1"
          title="Change email"
          onClick={() => {
            setValue(email);
            setEditing(true);
            setError("");
          }}
        >
          ✏️
        </button>
      </div>
    );
  }

  async function handleSave() {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed === email.toLowerCase()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/admin/events/${slug}/registrations/${regId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "update", email: trimmed, attendanceType }),
      });
      toast("Email updated — confirmation sent to new address", "success");
      setEditing(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div class="input-group input-group-sm">
        <input
          type="email"
          class="form-control form-control-sm"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          disabled={saving}
          autoFocus
        />
        <button class="btn btn-sm btn-success" onClick={() => void handleSave()} disabled={saving}>
          {saving ? "…" : "Save"}
        </button>
        <button class="btn btn-sm btn-outline-secondary" onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </button>
      </div>
      <div class="form-text text-warning mt-1">
        {isCancelled
          ? "Changing the email will restore this cancelled registration and send a confirmation email to the new address."
          : "Changing the email will require re-confirmation."}
      </div>
      {error && <div class="small text-danger mt-1">{error}</div>}
    </div>
  );
}

// ─── Force status panel ───────────────────────────────────────────────────────

const FORCE_STATUS_OPTIONS = [
  { value: "pending_email_confirmation", label: "Pending confirmation" },
  { value: "registered", label: "Registered" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "cancelled", label: "Cancelled" },
] as const;

function ForceStatusPanel({
  currentStatus,
  slug,
  regId,
  onSaved,
}: {
  currentStatus: string;
  slug: string;
  regId: string;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState(currentStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (selected === currentStatus) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/admin/events/${slug}/registrations/${regId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "force_status", status: selected }),
      });
      toast(`Status changed to ${selected}`, "success");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p class="small text-muted mb-2">
        Directly override the registration status. Use with care — this bypasses capacity and waitlist logic.
      </p>
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <select
          class="form-select form-select-sm adm-filter-select"
          value={selected}
          onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}
        >
          {FORCE_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          class="btn btn-sm btn-warning"
          onClick={() => void handleSave()}
          disabled={saving || selected === currentStatus}
        >
          {saving ? "Saving…" : "Apply"}
        </button>
      </div>
      {error && <div class="small text-danger mt-1">{error}</div>}
    </div>
  );
}

// ─── Main detail page ─────────────────────────────────────────────────────────

interface DetailResponse {
  registration: Registration;
  dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
  dayWaitlist: Array<{ dayDate: string; status: string; priorityLane: string; offerExpiresAt: string | null }>;
}

export function RegistrationDetailPage({ slug, regId }: { slug: string; regId: string }) {
  const [, navigate] = useHashLocation();
  const [resendStatus, setResendStatus] = useState("");
  const [openingManage, setOpeningManage] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const { data, loading, error, reload } = useData<DetailResponse>(
    () => api<DetailResponse>(`/api/v1/admin/events/${slug}/registrations/${regId}`),
    [slug, regId],
  );

  const { data: daysData } = useData<{ days: AdminEventDay[] }>(
    () => api<{ days: AdminEventDay[] }>(`/api/v1/admin/events/${slug}/days`),
    [slug],
  );

  const reg = data?.registration;
  const dayAttendance = data?.dayAttendance ?? [];
  const dayWaitlist = data?.dayWaitlist ?? [];
  const eventDays = daysData?.days ?? [];

  async function handleResend() {
    setResendStatus("Sending…");
    try {
      await api(`/api/v1/admin/events/${slug}/registrations/${regId}/resend-confirmation`, {
        method: "POST",
        body: "{}",
      });
      toast("Confirmation email queued", "success");
      setResendStatus("✓ Queued");
    } catch (e) {
      const msg = (e as Error).message;
      setResendStatus(msg);
      toast(msg, "error");
    }
  }

  async function handleOpenManage() {
    setOpeningManage(true);
    try {
      const { manageUrl } = await api<{ manageUrl: string }>(
        `/api/v1/admin/events/${slug}/registrations/${regId}/open-manage`,
        { method: "POST", body: "{}" },
      );
      window.open(manageUrl, "_blank", "noopener");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setOpeningManage(false);
    }
  }

  async function handleRegenerateBadge() {
    setRegenerating(true);
    try {
      await api(`/api/v1/admin/events/${slug}/registrations/${regId}/regenerate-badge`, { method: "POST", body: "{}" });
      toast("Badge regenerated", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!reg) return null;

  const shareUrl = reg.referral_code ? `${window.location.origin}/r/${reg.referral_code}` : null;
  const ogBadgeUrl = reg.referral_code ? `${window.location.origin}/api/v1/og/${reg.referral_code}` : null;
  const name = reg.display_name ?? reg.user_email ?? "—";

  return (
    <div>
      {/* Back + header */}
      <div class="d-flex align-items-center gap-2 mb-3">
        <button class="btn btn-sm btn-outline-secondary" onClick={() => navigate(`/events/${slug}/registrations`)}>
          ← Back
        </button>
        <h5 class="mb-0">{name}</h5>
        <Badge status={reg.status} />
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void reload()}>
          ↺ Refresh
        </button>
      </div>

      {/* Summary row */}
      <div class="row g-3 mb-3">
        <div class="col-md-3">
          <div class="card card-body p-3">
            <div class="small text-muted mb-1">Email</div>
            <EmailEditor
              email={reg.user_email ?? "—"}
              slug={slug}
              regId={regId}
              isCancelled={reg.status === "cancelled" || reg.status === "cancelled_unauthorized"}
              attendanceType={reg.attendance_type}
              onSaved={() => void reload()}
            />
          </div>
        </div>
        <div class="col-md-3">
          <div class="card card-body p-3">
            <div class="small text-muted mb-1">Attendance</div>
            <div>{reg.attendance_type ? attendanceTypeLabel(reg.attendance_type) : "—"}</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card card-body p-3">
            <div class="small text-muted mb-1">Source</div>
            <div>{reg.source_type ?? "—"}</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card card-body p-3">
            <div class="small text-muted mb-1">Registered</div>
            <div class="mono small">{fmt(reg.created_at)}</div>
          </div>
        </div>
      </div>

      {/* Day attendance */}
      <div class="card mb-3">
        <div class="card-header">
          <h6 class="mb-0">Day Attendance</h6>
        </div>
        <div class="card-body">
          <DayAttendancePanel
            dayAttendance={dayAttendance}
            eventDays={eventDays}
            registrationStatus={reg.status}
            slug={slug}
            regId={regId}
            onReload={() => void reload()}
          />
        </div>
      </div>

      {/* Day waitlist (only if entries exist) */}
      {dayWaitlist.length > 0 && (
        <div class="card mb-3">
          <div class="card-header">
            <h6 class="mb-0">Day Waitlist</h6>
          </div>
          <div class="card-body">
            <DayWaitlistTable dayWaitlist={dayWaitlist} />
          </div>
        </div>
      )}

      {/* Actions row */}
      <div class="row g-3 mb-3">
        {/* Manage */}
        <div class="col-md-4">
          <div class="card h-100">
            <div class="card-header">
              <h6 class="mb-0">Manage</h6>
            </div>
            <div class="card-body">
              <p class="small text-muted mb-2">Opens the registrant-facing manage page in a new tab.</p>
              <button class="btn btn-sm btn-primary" onClick={() => void handleOpenManage()} disabled={openingManage}>
                {openingManage ? "Opening…" : "Open Manage Page ↗"}
              </button>
              {reg.status === "waitlisted" && (
                <div class="alert alert-warning mb-0 mt-2 small">
                  <strong>Waitlisted:</strong> does not yet have a confirmed in-person seat.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Resend */}
        <div class="col-md-4">
          <div class="card h-100">
            <div class="card-header">
              <h6 class="mb-0">Confirmation Email</h6>
            </div>
            <div class="card-body">
              <p class="small text-muted mb-2">Rotates the token and re-queues the email.</p>
              <button class="btn btn-sm btn-outline-primary" onClick={() => void handleResend()}>
                Resend Email
              </button>
              {resendStatus && (
                <div class={`mt-2 small ${resendStatus.startsWith("✓") ? "text-success" : "text-danger"}`}>
                  {resendStatus}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Social promo */}
        <div class="col-md-4">
          <div class="card h-100">
            <div class="card-header">
              <h6 class="mb-0">Social Promo Kit</h6>
            </div>
            <div class="card-body">
              {shareUrl ? (
                <>
                  <div class="mb-2">
                    <label class="form-label small fw-semibold mb-1">Referral Link</label>
                    <div class="input-group input-group-sm">
                      <input type="text" class="form-control form-control-sm mono" value={shareUrl} readOnly />
                      <button
                        class="btn btn-outline-secondary"
                        onClick={() => void navigator.clipboard.writeText(shareUrl)}
                        title="Copy link"
                      >
                        📋
                      </button>
                    </div>
                  </div>
                  <div class="d-flex flex-wrap gap-1">
                    <a href={ogBadgeUrl!} target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary">
                      View Badge 📷
                    </a>
                    <button
                      class="btn btn-sm btn-outline-secondary"
                      onClick={() => void handleRegenerateBadge()}
                      disabled={regenerating}
                    >
                      {regenerating ? "Regenerating…" : "Regenerate Badge 🔄"}
                    </button>
                  </div>
                </>
              ) : (
                <p class="small text-muted fst-italic mb-0">No referral code.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Badge role */}
      <div class="card mb-3">
        <div class="card-header">
          <h6 class="mb-0">Badge Role</h6>
        </div>
        <div class="card-body">
          <p class="small text-muted mb-2">Set the role shown on the attendee's promotional badge.</p>
          <BadgeRolePanel slug={slug} regId={regId} />
        </div>
      </div>

      {/* Audit log */}
      <div class="card mb-3">
        <div class="card-header">
          <h6 class="mb-0">Audit Log</h6>
        </div>
        <div class="card-body">
          <AuditLogSection slug={slug} regId={regId} />
        </div>
      </div>

      {/* Force status */}
      <div class="card mb-3">
        <div class="card-header">
          <h6 class="mb-0">Override Status</h6>
        </div>
        <div class="card-body">
          <ForceStatusPanel currentStatus={reg.status} slug={slug} regId={regId} onSaved={() => void reload()} />
        </div>
      </div>
    </div>
  );
}
