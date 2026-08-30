import { useState } from "preact/hooks";
import { patchJson } from "../../../../../shared/api-client";
import { toast } from "../../../ui";
import { roleResponseEnvelopeSchema, type Role } from "../../../../../../shared/schemas/access-control";
import { PermissionCheckboxes } from "./RolePermissions";

/** Edits a role's name/description/permission bundle behind an explicit Edit action on RoleDetail. */
export function RoleEditForm({
  role,
  onSaved,
  onCancel,
}: {
  role: Role;
  onSaved: (role: Role) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissions));
  const [submitting, setSubmitting] = useState(false);

  function toggle(permission: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  async function handleSave(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const updated = await patchJson(
        `/api/v1/roles/${role.id}`,
        {
          name: name.trim(),
          description: description.trim() || null,
          permissions: Array.from(selected),
          revision: role.updatedAt,
        },
        roleResponseEnvelopeSchema,
      );
      toast("Role updated", "success");
      onSaved(updated.role);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSave}>
      <div class="row g-2 mb-2">
        <div class="col-md-4">
          <label class="form-label small fw-semibold" for="access-control-role-edit-name">
            Name
          </label>
          <input
            id="access-control-role-edit-name"
            class="form-control form-control-sm"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            pattern="^[a-z][a-z0-9_]*$"
            disabled={submitting}
            required
          />
        </div>
        <div class="col-md-8">
          <label class="form-label small fw-semibold" for="access-control-role-edit-description">
            Description
          </label>
          <input
            id="access-control-role-edit-description"
            class="form-control form-control-sm"
            value={description}
            onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
            disabled={submitting}
          />
        </div>
      </div>
      <label class="form-label small fw-semibold">Permissions</label>
      <PermissionCheckboxes selected={selected} onToggle={toggle} disabled={submitting} />
      <div class="d-flex gap-2">
        <button type="submit" class="btn btn-sm btn-success" disabled={submitting}>
          {submitting ? "Saving…" : "Save changes"}
        </button>
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
