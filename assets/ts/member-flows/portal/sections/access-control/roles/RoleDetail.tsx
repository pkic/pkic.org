import { Menu } from "../../../../../ui/Menu";
import { BreadcrumbBranch } from "../../../../../ui/BreadcrumbScope";
import { ProfileHeader } from "../../../../../ui/ProfileHeader";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../components/Spinner";
import { Alert } from "../../../../../ui/Alert";
import { Badge } from "../../../../../ui/Badge";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { PersonCell } from "../../../../../ui/PersonCell";
import { RowActions } from "../../../../../ui/RowActions";
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
import { RolePermissions } from "./RolePermissions";
// A context and a date are identifiers, so they are set in `pk-mono`. That class
// lives in the content stylesheet, and component CSS ships in lazy chunks —
// a surface that writes the class name has to import the sheet itself.
import "../../../../../ui/Content.css";

/** Role detail: fields with Edit, its assignee list, and an assign control — reachable from the roles list. */
export function RoleDetail({ roleId, canGrant, canRevoke }: { roleId: string; canGrant: boolean; canRevoke: boolean }) {
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
    <div class="pk pk-stack">
      {loading ? (
        <Spinner label="Loading role…" />
      ) : error ? (
        <ErrorAlert error={error} />
      ) : role ? (
        <>
          <BreadcrumbBranch items={[{ label: role.name }]} />
          <ProfileHeader
            headingLevel={3}
            title={role.name}
            context={
              role.isSystemRole && (
                <Badge tone="info" dot={false}>
                  System
                </Badge>
              )
            }
            actions={
              canGrant &&
              !editing && (
                <Menu
                  label="Role actions"
                  align="end"
                  items={[{ id: "edit", label: "Edit", onSelect: () => setEditing(true) }]}
                />
              )
            }
          />
          <Panel>
            <PanelBody class="pk-stack pk-stack--snug">
              {role.isSystemRole && (
                <p class="pk-muted pk-small">
                  Permission changes apply to everyone holding this role within their assignment's scope. Other roles
                  and direct grants still apply. Responsibilities such as group leadership remain in effect.
                </p>
              )}
              {!editing && role.description && <p class="pk-muted pk-small">{role.description}</p>}
              {editing ? (
                <RoleEditForm
                  role={role}
                  onSaved={(updated) => {
                    setRole(updated);
                    setEditing(false);
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : role.permissions.length === 0 ? (
                <span class="pk-muted pk-small">No permissions</span>
              ) : (
                <RolePermissions selected={new Set(role.permissions)} />
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Assignees" />
            <PanelBody class="pk-stack pk-stack--snug">
              {canGrant && capacityBoundLeadership ? (
                <Alert tone="info">
                  Assign this role from the selected group&apos;s Leadership section, where the person&apos;s active
                  Member capacity is selected explicitly.
                </Alert>
              ) : canGrant ? (
                <RoleAssignForm roleId={role.id} onAssigned={() => void assignmentsRef.current?.reload()} />
              ) : null}
            </PanelBody>
            <ApiDataTable
              urlState="role-assignees"
              caption={`${role.name} assignees`}
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
                  cell: (assignment) => <PersonCell size="sm" name={assignment.name} />,
                  sort: { asc: "name", desc: "-name" },
                },
                {
                  header: "Context",
                  cell: (assignment) =>
                    assignment.contextType ? (
                      `${assignment.contextType}:${assignment.contextId}`
                    ) : (
                      <span class="pk-muted">Global</span>
                    ),
                  className: "pk-mono pk-small",
                  sort: { asc: "context_type", desc: "-context_type" },
                },
                {
                  header: "Expires",
                  cell: (assignment) =>
                    assignment.expiresAt ? fmt(assignment.expiresAt) : <span class="pk-muted">Never</span>,
                  className: "pk-small",
                  sort: { asc: "expires_at", desc: "-expires_at" },
                },
                {
                  header: "Granted",
                  cell: (assignment) => fmtDate(assignment.createdAt),
                  className: "pk-mono pk-small",
                  sort: { asc: "created_at", desc: "-created_at" },
                },
                {
                  header: "",
                  cell: (assignment) =>
                    canRevoke ? (
                      <RowActions
                        subject={assignment.name}
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
          </Panel>
        </>
      ) : null}
    </div>
  );
}
