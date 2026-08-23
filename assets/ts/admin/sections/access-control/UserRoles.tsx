import { useRef, useState } from "preact/hooks";
import { api, apiCommand } from "../../api";
import { fmt, toast } from "../../ui";
import type { UserRoleAssignment } from "../../types";
import { UserPicker, type PickedUser } from "./UserPicker";
import { ContextPicker, type PickedContext } from "./ContextPicker";
import { adminRoleCatalog } from "../../services/catalogs";
import { ServerSearchSelect } from "../../components/ServerSearchSelect";
import { ApiDataTable, type ApiTableActions } from "../../components/ApiDataTable";
import { userRoleResponseEnvelopeSchema, userRolesListResponseSchema } from "../../../../shared/schemas/access-control";

/** Staff management: assign built-in roles, override individual permissions. */
export function UserRoles() {
  const [user, setUser] = useState<PickedUser | null>(null);
  const tableRef = useRef<ApiTableActions | null>(null);
  const [roleId, setRoleId] = useState("");
  const [roleLabel, setRoleLabel] = useState<string>();
  const [context, setContext] = useState<PickedContext>({ contextType: null, contextId: null });
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAssign(e: Event) {
    e.preventDefault();
    if (!user || !roleId) return;
    if (context.contextType && !context.contextId) {
      toast("Pick a specific event/working group, or clear the context", "error");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/v1/admin/users/${user.id}/roles`, userRoleResponseEnvelopeSchema, {
        method: "POST",
        body: JSON.stringify({
          roleId,
          contextType: context.contextType,
          contextId: context.contextId,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      toast("Role assigned", "success");
      setContext({ contextType: null, contextId: null });
      setExpiresAt("");
      tableRef.current?.reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(assignment: UserRoleAssignment) {
    if (!user) return;
    if (!confirm(`Revoke role "${assignment.roleName}"?`)) return;
    try {
      await apiCommand(`/api/v1/admin/users/${user.id}/roles/${assignment.id}`, { method: "DELETE" });
      toast("Role revoked", "success");
      tableRef.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Staff management — assign roles</div>
      <div class="card-body">
        <div class="mb-3 adm-role-user-picker">
          <label class="form-label small fw-semibold">User</label>
          <UserPicker value={user} onChange={setUser} />
        </div>

        {!user ? (
          <p class="text-muted small mb-0">Pick a user to view and manage their role assignments.</p>
        ) : (
          <>
            <form onSubmit={handleAssign} class="row g-2 align-items-end mb-3">
              <div class="col-md-3">
                <ServerSearchSelect
                  catalog={adminRoleCatalog}
                  label="Role"
                  value={roleId}
                  selectedLabel={roleLabel}
                  disabled={submitting}
                  allowEmpty={false}
                  autoSelectFirst
                  onChange={(role) => {
                    setRoleId(role?.id ?? "");
                    setRoleLabel(role?.name);
                  }}
                />
              </div>
              <div class="col-md-5">
                <label class="form-label small fw-semibold">Context</label>
                <ContextPicker value={context} onChange={setContext} disabled={submitting} />
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-semibold">Expires (optional)</label>
                <input
                  class="form-control form-control-sm"
                  type="datetime-local"
                  value={expiresAt}
                  onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)}
                  disabled={submitting}
                />
              </div>
              <div class="col-md-2">
                <button type="submit" class="btn btn-sm btn-success w-100" disabled={submitting || !roleId}>
                  {submitting ? "Assigning…" : "Assign"}
                </button>
              </div>
            </form>

            <ApiDataTable
              endpoint={`/api/v1/admin/users/${user.id}/roles`}
              responseSchema={userRolesListResponseSchema}
              resolve={(response) => response.roles}
              resolvePage={(response) => response.page}
              paginate
              initialPageSize={25}
              initialSort="-created_at"
              searchPlaceholder="Search role assignments…"
              actionsRef={tableRef}
              rowKey={(assignment) => assignment.id}
              empty="No roles assigned"
              columns={[
                {
                  header: "Role",
                  cell: (assignment) => <span class="fw-semibold mono">{assignment.roleName}</span>,
                  sort: { asc: "role_name", desc: "-role_name" },
                },
                {
                  header: "Context",
                  cell: (assignment) => (
                    <span class="small mono">
                      {assignment.contextType ? (
                        `${assignment.contextType}:${assignment.contextId}`
                      ) : (
                        <span class="text-muted">Global</span>
                      )}
                    </span>
                  ),
                  sort: { asc: "context_type", desc: "-context_type" },
                },
                {
                  header: "Expires",
                  cell: (assignment) => (
                    <span class="small">
                      {assignment.expiresAt ? fmt(assignment.expiresAt) : <span class="text-muted">Never</span>}
                    </span>
                  ),
                  sort: { asc: "expires_at", desc: "-expires_at" },
                },
                {
                  header: "Granted",
                  cell: (assignment) => <span class="small mono">{fmt(assignment.createdAt)}</span>,
                  sort: { asc: "created_at", desc: "-created_at" },
                },
                {
                  header: "",
                  cell: (assignment) => (
                    <button class="btn btn-sm btn-outline-danger" onClick={() => void handleRevoke(assignment)}>
                      Revoke
                    </button>
                  ),
                },
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}
