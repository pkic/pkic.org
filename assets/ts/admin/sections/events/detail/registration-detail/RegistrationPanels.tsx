import { useState } from "preact/hooks";
import { Spinner } from "../../../../../components/Spinner";
import { api } from "../../../../api";
import { toast } from "../../../../ui";
import type { BadgeRoleInfo } from "../../../../types";
import { useData } from "../../../../../hooks/useData";
import {
  ADMIN_EVENT_REGISTRATION_STATUSES,
  adminEventRegistrationStatusLabel,
} from "../../../../../../shared/schemas/admin-events";
import { AuditLogTable } from "../../../../components/AuditLogTable";

const ROLE_BADGE_COLOR: Record<string, string> = {
  attendee: "primary",
  speaker: "success",
  moderator: "warning",
  panelist: "warning",
  organizer: "info",
  staff: "secondary",
};

export function BadgeRolePanel({ slug, regId }: { slug: string; regId: string }) {
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

  const color = ROLE_BADGE_COLOR[info.effective_role] ?? "secondary";
  return (
    <div>
      <div class="d-flex align-items-center gap-2 flex-wrap mb-2">
        <span class="small text-muted">Effective:</span>
        <span class={`badge text-bg-${color}`}>{info.effective_role}</span>
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

export function RegistrationAuditLogSection({ slug, regId }: { slug: string; regId: string }) {
  return (
    <AuditLogTable
      endpoint={`/api/v1/admin/events/${slug}/registrations/${regId}/audit-log`}
      actionCell={(entry) => <code class="small">{entry.action}</code>}
      detailsCell={(entry) =>
        entry.details ? (
          <pre class="mb-0 small text-body-secondary">{JSON.stringify(entry.details, null, 2)}</pre>
        ) : null
      }
    />
  );
}

// ─── Force status panel ───────────────────────────────────────────────────────

export function RegistrationForceStatusPanel({
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
        Override the registration lifecycle status. Restoring an active status re-evaluates day capacity and waitlist
        placement.
      </p>
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <select
          class="form-select form-select-sm adm-filter-select"
          value={selected}
          onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}
        >
          {ADMIN_EVENT_REGISTRATION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {adminEventRegistrationStatusLabel(status)}
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
