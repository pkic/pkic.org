import { useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../components/Table";
import { api } from "../../api";
import { toast } from "../../ui";
import type { Role } from "../../types";
import { PERMISSIONS } from "../../permissions";
import { rolesListResponseSchema } from "../../../../shared/schemas/access-control";

/** Built-in roles ship system-locked; custom roles are admin-creatable. */
export function Roles() {
  const tableRef = useRef<ApiTableActions | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  function toggle(permission: string) {
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
      await api("/api/v1/admin/roles", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          permissions: Array.from(selected),
        }),
      });
      toast("Role created", "success");
      setName("");
      setDescription("");
      setSelected(new Set());
      tableRef.current?.reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(role: Role) {
    if (!confirm(`Delete role "${role.name}"?`)) return;
    try {
      await api(`/api/v1/admin/roles/${role.id}`, { method: "DELETE" });
      toast("Role deleted", "success");
      tableRef.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div>
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white fw-semibold">Create a custom role</div>
        <div class="card-body">
          <form onSubmit={handleCreate}>
            <div class="row g-2 mb-2">
              <div class="col-md-4">
                <label class="form-label small fw-semibold">Name</label>
                <input
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
                <label class="form-label small fw-semibold">Description</label>
                <input
                  class="form-control form-control-sm"
                  value={description}
                  onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
                  disabled={submitting}
                />
              </div>
            </div>
            <label class="form-label small fw-semibold">Permissions</label>
            <div class="d-flex flex-wrap gap-2 mb-2 p-2 border rounded adm-role-permissions">
              {PERMISSIONS.map((permission) => (
                <div key={permission} class="form-check">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    id={`perm-${permission}`}
                    checked={selected.has(permission)}
                    onChange={() => toggle(permission)}
                    disabled={submitting}
                  />
                  <label class="form-check-label small mono" for={`perm-${permission}`}>
                    {permission}
                  </label>
                </div>
              ))}
            </div>
            <button type="submit" class="btn btn-sm btn-success" disabled={submitting}>
              {submitting ? "Creating…" : "Create role"}
            </button>
          </form>
        </div>
      </div>

      <ApiDataTable<Role>
        endpoint="/api/v1/admin/roles"
        resolve={(data) => rolesListResponseSchema.parse(data).roles}
        resolvePage={(data) => rolesListResponseSchema.parse(data).page}
        paginate
        actionsRef={tableRef}
        columns={[
          {
            header: "Name",
            cell: (r) => (
              <>
                <span class="fw-semibold mono">{r.name}</span>
                {r.isSystemRole && <span class="badge text-bg-secondary ms-1">System</span>}
              </>
            ),
            sort: { asc: "name", desc: "-name" },
          },
          {
            header: "Description",
            cell: (r) => r.description ?? "—",
            className: "small text-muted",
            sort: { asc: "description", desc: "-description" },
          },
          {
            header: "Permissions",
            cell: (r) => (
              <div class="d-flex flex-wrap gap-1">
                {r.permissions.length === 0 ? (
                  <span class="text-muted small">None</span>
                ) : (
                  r.permissions.map((p) => (
                    <span key={p} class="badge text-bg-light border small mono">
                      {p}
                    </span>
                  ))
                )}
              </div>
            ),
          },
          {
            header: "",
            cell: (r) => (
              <button
                class="btn btn-sm btn-outline-danger"
                onClick={() => void handleDelete(r)}
                disabled={r.isSystemRole}
                title={r.isSystemRole ? "Built-in roles cannot be deleted" : undefined}
              >
                Delete
              </button>
            ),
          },
        ]}
        empty="No roles"
        rowKey={(r) => r.id}
      />
    </div>
  );
}
