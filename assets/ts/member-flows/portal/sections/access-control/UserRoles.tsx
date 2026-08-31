import { useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { RowActions } from "../../../../ui/RowActions";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { deleteJson, postJson } from "../../../../shared/api-client";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import {
  userRoleResponseEnvelopeSchema,
  userRolesListResponseSchema,
  type UserRoleAssignment,
} from "../../../../../shared/schemas/access-control";
import { fmt, fmtDate, toast } from "../../ui";
import { TargetPicker, type PickedTarget } from "./TargetPicker";
import { roleCatalog } from "./catalogs";

/** People with assigned roles: permissioned users (often community members, not staff). */
export function UserRoles({ canGrant = true, canRevoke = true }: { canGrant?: boolean; canRevoke?: boolean } = {}) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const tableRef = useRef<ApiTableActions | null>(null);
  const [roleId, setRoleId] = useState("");
  const [roleLabel, setRoleLabel] = useState<string>();
  const [target, setTarget] = useState<PickedTarget>({ targetType: null, targetId: null });
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAssign(e: Event) {
    e.preventDefault();
    if (!user || !roleId) return;
    if (target.targetType && !target.targetId) {
      toast("Pick a specific event/working group, or clear the context", "error");
      return;
    }
    setSubmitting(true);
    try {
      await postJson(
        `/api/v1/users/${user.id}/roles`,
        {
          roleId,
          contextType: target.targetType,
          contextId: target.targetId,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        },
        userRoleResponseEnvelopeSchema,
      );
      toast("Role assigned", "success");
      setTarget({ targetType: null, targetId: null });
      setExpiresAt("");
      await tableRef.current?.reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(assignment: UserRoleAssignment) {
    if (!user) return;
    const confirmed = await confirmAction({
      title: `Revoke the "${assignment.roleName}" role from ${user.email}?`,
      consequences: [`${user.email} loses the permissions this role grants`],
      confirmLabel: "Revoke role",
    });
    if (!confirmed) return;
    try {
      await deleteJson(`/api/v1/users/${user.id}/roles/${assignment.id}`, successResponseSchema);
      toast("Role revoked", "success");
      await tableRef.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">People — assign roles</div>
      <div class="card-body">
        <div class="mb-3 portal-access-role-user-picker">
          <label class="form-label small fw-semibold">User</label>
          <UserPicker endpoint="/api/v1/permissions/subjects" value={user} onChange={setUser} />
        </div>

        {!user ? (
          <p class="text-muted small mb-0">Pick a user to view and manage their role assignments.</p>
        ) : (
          <>
            {canGrant && (
              <form onSubmit={handleAssign} class="row g-2 align-items-end mb-3">
                <div class="col-md-3">
                  <ServerSearchSelect
                    catalog={roleCatalog}
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
                  <label class="form-label small fw-semibold">Target</label>
                  <TargetPicker value={target} onChange={setTarget} disabled={submitting} />
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
            )}

            <ApiDataTable
              endpoint={`/api/v1/users/${user.id}/roles`}
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
                  cell: (assignment) => <span class="small mono">{fmtDate(assignment.createdAt)}</span>,
                  sort: { asc: "created_at", desc: "-created_at" },
                },
                {
                  header: "",
                  cell: (assignment) =>
                    canRevoke ? (
                      <RowActions
                        actions={[
                          { id: "revoke", label: "Revoke role", onSelect: () => void handleRevoke(assignment) },
                        ]}
                      />
                    ) : null,
                },
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}
