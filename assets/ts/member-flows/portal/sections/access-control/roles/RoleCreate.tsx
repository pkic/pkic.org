import { useState } from "preact/hooks";
import { postValidated } from "../../../../../shared/api-client";
import { toast } from "../../../ui";
import { roleCreateSchema, roleResponseEnvelopeSchema } from "../../../../../../shared/schemas/access-control";
import type { Permission } from "../../../../../../shared/schemas/permissions";
import { PermissionCheckboxes } from "./RolePermissions";

/** Distinct create-role view: replaces the roles list rather than layering above it. */
export function RoleCreate({ onCreated, onCancel }: { onCreated: (roleId: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<Permission>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  function toggle(permission: Permission) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  async function handleCreate(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const created = await postValidated(
        "/api/v1/roles",
        roleCreateSchema,
        {
          name: name.trim(),
          description: description.trim() || undefined,
          permissions: Array.from(selected),
        },
        roleResponseEnvelopeSchema,
      );
      toast("Role created", "success");
      onCreated(created.role.id);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onCancel}>
          ← All roles
        </button>
      </div>
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white fw-semibold">New role</div>
        <div class="card-body">
          <form onSubmit={handleCreate}>
            <div class="row g-2 mb-2">
              <div class="col-md-4">
                <label class="form-label small fw-semibold" for="access-control-role-name">
                  Name
                </label>
                <input
                  id="access-control-role-name"
                  class="form-control form-control-sm"
                  value={name}
                  onInput={(e) => setName((e.target as HTMLInputElement).value)}
                  placeholder="e.g. sponsorship_lead"
                  pattern="^[a-z][a-z0-9_]*$"
                  disabled={submitting}
                  required
                />
                <div class="form-text">Lowercase letters, numbers, underscores only.</div>
              </div>
              <div class="col-md-8">
                <label class="form-label small fw-semibold" for="access-control-role-description">
                  Description
                </label>
                <input
                  id="access-control-role-description"
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
                {submitting ? "Creating…" : "Create role"}
              </button>
              <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onCancel} disabled={submitting}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
