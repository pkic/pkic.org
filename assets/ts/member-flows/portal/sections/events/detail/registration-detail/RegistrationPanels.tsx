import { useState } from "preact/hooks";
import { Spinner } from "../../../../../../components/Spinner";
import { Badge } from "../../../../../../components/Badge";
import { getJson, patchJson } from "../../../../../../shared/api-client";
import { toast } from "../../../../ui";
import type { BadgeRoleInfo } from "../../types";
import { useData } from "../../../../../../hooks/useData";
import { AuditLogTable } from "../../../../../../components/AuditLogTable";
import { DetailsSummary } from "../../../../../../components/DetailsSummary";
import { Button } from "../../../../../../ui/Button";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { registrationBadgeResponseSchema } from "../../../../../../../shared/schemas/participant-roles";
import { eventRegistrationManagementUpdateResponseSchema } from "../../../../../../../shared/schemas/route-contracts-event-registration-management";
import { eventRegistrationPath, eventRegistrationResourcePath } from "../registration-paths";

/** "co_speaker" → "Co-speaker". */
function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).replace("_", "-");
}

export function BadgeRolePanel({ slug, regId }: { slug: string; regId: string }) {
  const [info, setInfo] = useState<BadgeRoleInfo | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  const { loading } = useData(
    () =>
      getJson(eventRegistrationResourcePath(slug, regId, "badge"), registrationBadgeResponseSchema).then((d) => {
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
      const res = await patchJson(
        eventRegistrationResourcePath(slug, regId, "badge"),
        { role: selectedRole || null },
        registrationBadgeResponseSchema,
      );
      setInfo(res);
      setSelectedRole(res.admin_override ?? "");
      toast("Badge role updated", "success");
    } catch (e) {
      setSaveStatus((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!info) return loading ? <Spinner label="Loading the badge role…" /> : null;

  return (
    <div class="pk pk-stack pk-stack--snug">
      {/* Whether the role was forced or worked out from the registration is
          said in words beside the badge, not carried by the badge's tone. */}
      <div class="pk-cluster pk-small">
        <span class="pk-muted">Effective:</span>
        <Badge status={info.effective_role} />
        <span class="pk-muted">
          {info.admin_override
            ? `Forced by an organizer; auto-detection would give ${roleLabel(info.auto_detected)}.`
            : "Auto-detected from this registration."}
        </span>
      </div>

      <Field
        label="Role override"
        help="Leave on Auto to keep following the registration."
        state={saveStatus ? "invalid" : undefined}
        message={saveStatus || undefined}
      >
        {(control) => (
          <Select
            {...control}
            value={selectedRole}
            disabled={saving}
            onChange={(e) => setSelectedRole((e.target as HTMLSelectElement).value)}
          >
            <option value="">Auto ({roleLabel(info.auto_detected)})</option>
            {info.available_roles.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div class="pk-cluster">
        <Button variant="primary" size="sm" loading={saving} onClick={() => void handleSave()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export function RegistrationAuditLogSection({ slug, regId }: { slug: string; regId: string }) {
  return (
    <AuditLogTable
      // A registration page carries several tables; this one says whose
      // history it is rather than being a fourth table called "Audit history".
      caption="Registration history"
      endpoint={eventRegistrationResourcePath(slug, regId, "audit")}
      actionCell={(entry) => <code class="pk-small">{entry.action}</code>}
      detailsCell={(entry) => <DetailsSummary value={entry.details} />}
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
      <div class="pk pk-cluster">
        <span>{email}</span>
        {/* The pencil is decoration; the button's name is what a screen reader
            and a voice-control user actually get. */}
        <Button
          variant="link"
          size="sm"
          aria-label={`Change the registration email address, currently ${email}`}
          onClick={() => {
            setValue(email);
            setEditing(true);
            setError("");
          }}
        >
          <span aria-hidden="true">✏️</span>
        </Button>
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
      await patchJson(
        eventRegistrationPath(slug, regId),
        { action: "update", email: trimmed },
        eventRegistrationManagementUpdateResponseSchema,
      );
      toast("Email updated — confirmation sent to new address", "success");
      setEditing(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /*
   * The consequence of the edit is the field's own advisory message rather
   * than a colored note beside it: an advisory is announced and described by
   * the control without claiming the value is invalid, and a real failure
   * replaces it with a blocking message on the same field.
   */
  return (
    <div class="pk pk-stack pk-stack--tight">
      <Field
        label="Email address"
        state={error ? "invalid" : "advisory"}
        message={
          error ||
          (isCancelled
            ? "Changing the email will restore this cancelled registration and send a confirmation email to the new address."
            : "Changing the email will require re-confirmation.")
        }
      >
        {(control) => (
          <TextInput
            {...control}
            type="email"
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
        )}
      </Field>
      <div class="pk-cluster">
        <Button variant="primary" size="sm" loading={saving} onClick={() => void handleSave()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" disabled={saving} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
