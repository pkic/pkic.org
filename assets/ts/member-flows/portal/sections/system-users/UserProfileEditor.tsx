import { useState } from "preact/hooks";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { patchJson } from "../../../../shared/api-client";
import { normalizeProfileLinks } from "../../../../shared/widgets/profile-links";
import { userRoleValueSchema, userUpdateResponseSchema } from "../../../../../shared/schemas/user-management";
import { toast } from "../../ui";
import type { UserDetail } from "./model";

type EditableUser = {
  email: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  organizationName: string;
  jobTitle: string;
  biography: string;
  links: string[];
  role: string;
  active: boolean;
  isEcMember: boolean;
};

function editFormFor(user: UserDetail): EditableUser {
  return {
    email: user.email,
    firstName: user.first_name ?? "",
    lastName: user.last_name ?? "",
    preferredName: user.preferred_name ?? "",
    organizationName: user.organization_name ?? "",
    jobTitle: user.job_title ?? "",
    biography: user.biography ?? "",
    links: normalizeProfileLinks(user.links),
    role: user.role,
    active: user.active,
    isEcMember: user.isEcMember ?? false,
  };
}

export function UserProfileEditor({
  user,
  canGrantAccess,
  onSaved,
}: {
  user: UserDetail;
  canGrantAccess: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<EditableUser>(() => editFormFor(user));

  function startEditing() {
    setForm(editFormFor(user));
    setError("");
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await patchJson(
        `/api/v1/users/${encodeURIComponent(user.id)}`,
        {
          ...(canGrantAccess ? { email: form.email.trim().toLowerCase() || undefined, role: form.role } : {}),
          firstName: form.firstName || null,
          lastName: form.lastName || null,
          preferredName: form.preferredName || null,
          organizationName: form.organizationName || null,
          jobTitle: form.jobTitle || null,
          biography: form.biography || null,
          links: form.links,
          active: form.active,
          isEcMember: form.isEcMember,
        },
        userUpdateResponseSchema,
      );
      toast("User updated", "success");
      setEditing(false);
      await onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button class="btn btn-sm btn-outline-primary" onClick={startEditing}>
        Edit profile
      </button>
    );
  }

  return (
    <div class="mt-3">
      <div class="row g-2 mb-2">
        {(
          [
            ["First name", "firstName"],
            ["Last name", "lastName"],
            ["Preferred name", "preferredName"],
            ["Organization", "organizationName"],
            ["Job title", "jobTitle"],
          ] as Array<[string, keyof EditableUser]>
        ).map(([label, field]) => (
          <div key={field} class="col-sm-6">
            <label class="form-label small mb-1" for={`user-${field}`}>
              {label}
            </label>
            <input
              id={`user-${field}`}
              type="text"
              class="form-control form-control-sm"
              value={form[field] as string}
              onInput={(event) => setForm((current) => ({ ...current, [field]: event.currentTarget.value }))}
              disabled={saving}
            />
          </div>
        ))}
        <div class="col-12">
          <label class="form-label small mb-1" for="user-biography">
            Biography
          </label>
          <textarea
            id="user-biography"
            class="form-control form-control-sm"
            rows={4}
            value={form.biography}
            onInput={(event) => setForm((current) => ({ ...current, biography: event.currentTarget.value }))}
            disabled={saving}
          />
        </div>
        <div class="col-12">
          <label class="form-label small mb-1">Profile links</label>
          <ProfileLinksInput
            fieldName="userProfileLink"
            value={form.links}
            onChange={(links) => setForm((current) => ({ ...current, links }))}
          />
        </div>
        {canGrantAccess && (
          <div class="col-12">
            <label class="form-label small mb-1" for="user-email">
              Email
            </label>
            <input
              id="user-email"
              type="email"
              class="form-control form-control-sm"
              value={form.email}
              onInput={(event) => setForm((current) => ({ ...current, email: event.currentTarget.value }))}
              disabled={saving}
            />
          </div>
        )}
        {canGrantAccess && (
          <div class="col-sm-6">
            <div class="form-label small mb-1">Role</div>
            <div class="d-flex gap-3">
              {userRoleValueSchema.options.map((role) => (
                <div key={role} class="form-check mb-0">
                  <input
                    class="form-check-input"
                    type="radio"
                    id={`edit-role-${role}`}
                    name="edit-role"
                    checked={form.role === role}
                    onChange={() => setForm((current) => ({ ...current, role }))}
                    disabled={saving}
                  />
                  <label class="form-check-label small" for={`edit-role-${role}`}>
                    {role}
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}
        <div class="col-sm-6">
          <div class="form-check mt-4">
            <input
              class="form-check-input"
              type="checkbox"
              id="edit-active"
              checked={form.active}
              onChange={(event) => setForm((current) => ({ ...current, active: event.currentTarget.checked }))}
              disabled={saving}
            />
            <label class="form-check-label small" for="edit-active">
              Active
            </label>
          </div>
          <div class="form-check mt-2">
            <input
              class="form-check-input"
              type="checkbox"
              id="edit-ec-member"
              checked={form.isEcMember}
              onChange={(event) => setForm((current) => ({ ...current, isEcMember: event.currentTarget.checked }))}
              disabled={saving}
            />
            <label class="form-check-label small" for="edit-ec-member">
              Executive Council member
            </label>
          </div>
        </div>
      </div>
      {error && <div class="alert alert-danger small py-2 mb-2">{error}</div>}
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button class="btn btn-sm btn-outline-secondary" onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
