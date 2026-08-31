import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { RowActions } from "../../../../../ui/RowActions";
import { Spinner } from "../../../../../components/Spinner";
import { deleteJson, getJson } from "../../../../../shared/api-client";
import { successResponseSchema } from "../../../../../../shared/schemas/api-common";
import { fmt, fmtDate, toast } from "../../../ui";
import {
  SYSTEM_ROLE_IDS,
  roleAssignmentsListResponseSchema,
  roleResponseEnvelopeSchema,
  type Role,
  type RoleAssignment,
} from "../../../../../../shared/schemas/access-control";
import { RoleAssignForm } from "./RoleAssignForm";
import { RoleEditForm } from "./RoleEditForm";

/** Role detail: fields with Edit, its assignee list, and an assign control — reachable from the roles list. */
export function RoleDetail({
  roleId,
  canGrant,
  canRevoke,
  onBack,
}: {
  roleId: string;
  canGrant: boolean;
  canRevoke: boolean;
  onBack: () => void;
}) {
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const assignmentsRef = useRef<ApiTableActions | null>(null);
  const capacityBoundLeadership = roleId === SYSTEM_ROLE_IDS.groupLead || roleId === SYSTEM_ROLE_IDS.groupDeputyLead;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJson(`/api/v1/roles/${encodeURIComponent(roleId)}`, roleResponseEnvelopeSchema);
      setRole(data.role);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [roleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUnassign(assignment: RoleAssignment) {
    const confirmed = await confirmAction({
      title: `Remove this role from ${assignment.name}?`,
      consequences: [`${assignment.name} loses the permissions this role grants`],
      confirmLabel: "Unassign role",
    });
    if (!confirmed) return;
    try {
      await deleteJson(`/api/v1/users/${assignment.userId}/roles/${assignment.userRoleId}`, successResponseSchema);
      toast("Role unassigned", "success");
      await assignmentsRef.current?.reload();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onBack}>
          ← All roles
        </button>
      </div>

      {loading ? (
        <Spinner label="Loading role…" />
      ) : error ? (
        <ErrorAlert error={error} />
      ) : role ? (
        <>
          <div class="card border-0 shadow-sm mb-3">
            <div class="card-header bg-white d-flex align-items-center gap-2 flex-wrap">
              <div>
                <h6 class="mb-0 mono">
                  {role.name}
                  {role.isSystemRole && <span class="badge text-bg-secondary ms-2">System</span>}
                </h6>
                {role.description && <div class="small text-muted">{role.description}</div>}
              </div>
              {canGrant && !role.isSystemRole && !editing && (
                <button type="button" class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
            </div>
            <div class="card-body">
              {editing ? (
                <RoleEditForm
                  role={role}
                  onSaved={(updated) => {
                    setRole(updated);
                    setEditing(false);
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <div class="d-flex flex-wrap gap-1">
                  {role.permissions.length === 0 ? (
                    <span class="text-muted small">No permissions</span>
                  ) : (
                    role.permissions.map((p) => (
                      <span key={p} class="badge text-bg-light border small mono">
                        {p}
                      </span>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div class="card border-0 shadow-sm">
            <div class="card-header bg-white fw-semibold">Assignees</div>
            <div class="card-body">
              {canGrant && capacityBoundLeadership ? (
                <p class="alert alert-info small">
                  Assign this role from the selected group&apos;s Leadership section, where the person&apos;s active
                  Member capacity is selected explicitly.
                </p>
              ) : canGrant ? (
                <RoleAssignForm roleId={role.id} onAssigned={() => void assignmentsRef.current?.reload()} />
              ) : null}
              <ApiDataTable
                endpoint={`/api/v1/roles/${encodeURIComponent(role.id)}/assignments`}
                responseSchema={roleAssignmentsListResponseSchema}
                resolve={(data) => data.assignments}
                resolvePage={(data) => data.page}
                paginate
                initialPageSize={25}
                initialSort="-created_at"
                searchPlaceholder="Search assignees…"
                actionsRef={assignmentsRef}
                rowKey={(assignment) => assignment.userRoleId}
                empty="No one holds this role"
                columns={[
                  {
                    header: "Person",
                    cell: (assignment) => (
                      <>
                        <span class="fw-semibold">{assignment.name}</span>
                        <div class="small text-muted">{assignment.email}</div>
                      </>
                    ),
                    sort: { asc: "name", desc: "-name" },
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
                            {
                              id: "unassign",
                              label: "Unassign role",
                              onSelect: () => void handleUnassign(assignment),
                            },
                          ]}
                        />
                      ) : null,
                  },
                ]}
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
