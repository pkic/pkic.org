import { useState } from "preact/hooks";
import { Spinner } from "../../../../../components/Spinner";
import { api } from "../../../../api";
import { toast } from "../../../../ui";
import type { BadgeRoleInfo } from "../../../../types";
import { useData } from "../../../../../hooks/useData";
import { AuditLogTable } from "../../../../components/AuditLogTable";
import { registrationBadgeResponseSchema } from "../../../../../../shared/schemas/participant-roles";
import { eventRegistrationManagementUpdateResponseSchema } from "../../../../../../shared/schemas/route-contracts-event-registration-management";
import { eventRegistrationPath, eventRegistrationResourcePath } from "../registration-paths";

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
      api(eventRegistrationResourcePath(slug, regId, "badge"), registrationBadgeResponseSchema).then((d) => {
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
      const res = await api(eventRegistrationResourcePath(slug, regId, "badge"), registrationBadgeResponseSchema, {
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
      endpoint={eventRegistrationResourcePath(slug, regId, "audit")}
      actionCell={(entry) => <code class="small">{entry.action}</code>}
      detailsCell={(entry) =>
        entry.details ? (
          <pre class="mb-0 small text-body-secondary">{JSON.stringify(entry.details, null, 2)}</pre>
        ) : null
      }
    />
  );
}

// ─── Inline email editor ──────────────────────────────────────────────────────

export function RegistrationEmailEditor({
  email,
  slug,
  regId,
  isCancelled,
  onSaved,
}: {
  email: string;
  slug: string;
  regId: string;
  isCancelled: boolean;
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
      await api(eventRegistrationPath(slug, regId), eventRegistrationManagementUpdateResponseSchema, {
        method: "PATCH",
        body: JSON.stringify({ action: "update", email: trimmed }),
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
