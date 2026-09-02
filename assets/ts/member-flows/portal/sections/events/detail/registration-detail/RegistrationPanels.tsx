import { useState } from "preact/hooks";
import { Spinner } from "../../../../../../components/Spinner";
import { Badge } from "../../../../../../components/Badge";
import { getJson, patchJson } from "../../../../../../shared/api-client";
import { toast } from "../../../../ui";
import type { BadgeRoleInfo } from "../../types";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useData } from "../../../../../../hooks/useData";
import { AuditLogTable } from "../../../../../../components/AuditLogTable";
import { DetailsSummary } from "../../../../../../components/DetailsSummary";
import { Alert } from "../../../../../../ui/Alert";
import { Button } from "../../../../../../ui/Button";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import {
  registrationBadgePatchSchema,
  registrationBadgeResponseSchema,
} from "../../../../../../../shared/schemas/participant-roles";
import {
  eventRegistrationManagementUpdateResponseSchema,
  eventRegistrationManagementUpdateSchema,
} from "../../../../../../../shared/schemas/route-contracts-event-registration-management";
import { eventRegistrationPath, eventRegistrationResourcePath } from "../registration-paths";

/** "co_speaker" → "Co-speaker". */
function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).replace("_", "-");
}

export function BadgeRolePanel({ slug, regId }: { slug: string; regId: string }) {
  const [info, setInfo] = useState<BadgeRoleInfo | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // The badge patch contract the route parses decides what the control
  // shows and what Save may send; an empty choice is the explicit null.
  const form = useContractForm(registrationBadgePatchSchema, { role: selectedRole || null });

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
    const checked = form.submit();
    if (!checked.data) {
      setSaveError(checked.message);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const res = await patchJson(
        eventRegistrationResourcePath(slug, regId, "badge"),
        checked.data,
        registrationBadgeResponseSchema,
      );
      setInfo(res);
      setSelectedRole(res.admin_override ?? "");
      form.reset();
      toast("Badge role updated", "success");
    } catch (e) {
      // A refusal that names the field lands on the control; the rest is
      // stated beside the form.
      setSaveError(form.refuse(e));
    } finally {
      setSaving(false);
    }
  }

  if (!info) return loading ? <Spinner label="Loading the badge role…" /> : null;

  return (
    <div class="pk pk-stack pk-stack--snug" {...form.handlers}>
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

      <Field label="Role override" help="Leave on Auto to keep following the registration." {...form.of("role")}>
        {(control) => (
          <Select
            {...control}
            name="role"
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

      {saveError && <Alert tone="danger">{saveError}</Alert>}

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
  // The registration update contract the route parses checks the address as
  // it is typed and is the only thing that may refuse it.
  const form = useContractForm(eventRegistrationManagementUpdateSchema, { action: "update", email: value });

  function stopEditing(): void {
    setEditing(false);
    setError("");
    form.reset();
  }

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
    // Nothing to change is not a refusal: the editor simply closes.
    if (!trimmed || trimmed === email.toLowerCase()) {
      stopEditing();
      return;
    }
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await patchJson(
        eventRegistrationPath(slug, regId),
        checked.data,
        eventRegistrationManagementUpdateResponseSchema,
      );
      toast("Email updated — confirmation sent to new address", "success");
      stopEditing();
      onSaved();
    } catch (e) {
      setError(form.refuse(e));
    } finally {
      setSaving(false);
    }
  }

  /*
   * The consequence of the edit is the field's own guidance, described by the
   * control without claiming the value is invalid. The contract's verdict on
   * the address replaces it on the same field; a refusal the server does not
   * attribute to the field is stated beside it.
   */
  return (
    <div class="pk pk-stack pk-stack--tight" {...form.handlers}>
      <Field
        label="Email address"
        help={
          isCancelled
            ? "Changing the email will restore this cancelled registration and send a confirmation email to the new address."
            : "Changing the email will require re-confirmation."
        }
        {...form.of("email")}
      >
        {(control) => (
          <TextInput
            {...control}
            name="email"
            type="email"
            value={value}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSave();
              }
              if (e.key === "Escape") stopEditing();
            }}
            disabled={saving}
            autoFocus
          />
        )}
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <div class="pk-cluster">
        <Button variant="primary" size="sm" loading={saving} onClick={() => void handleSave()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" disabled={saving} onClick={stopEditing}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
