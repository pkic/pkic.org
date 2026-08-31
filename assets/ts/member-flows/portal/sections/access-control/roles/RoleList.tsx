import { useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../../components/EmptyState";
import { RowActions } from "../../../../../ui/RowActions";
import { deleteJson } from "../../../../../shared/api-client";
import { successResponseSchema } from "../../../../../../shared/schemas/api-common";
import { toast } from "../../../ui";
import { rolesListResponseSchema, type Role } from "../../../../../../shared/schemas/access-control";

const MAX_VISIBLE_PERMISSION_CHIPS = 4;
const PERMISSION_COUNT_ONLY_THRESHOLD = 8;

/**
 * A role's permission list can run to dozens of entries (the admin role especially). Show a few
 * chips inline and collapse the rest into a count — the full list stays on the role detail view.
 */
function PermissionsSummaryCell({ permissions }: { permissions: string[] }) {
  if (permissions.length === 0) return <span class="text-muted small">None</span>;
  if (permissions.length > PERMISSION_COUNT_ONLY_THRESHOLD) {
    return <span class="text-muted small">{permissions.length} permissions</span>;
  }
  const visible = permissions.slice(0, MAX_VISIBLE_PERMISSION_CHIPS);
  const remaining = permissions.length - visible.length;
  return (
    <div class="d-flex flex-wrap align-items-center gap-1">
      {visible.map((p) => (
        <span key={p} class="badge text-bg-light border small mono">
          {p}
        </span>
      ))}
      {remaining > 0 && <span class="text-muted small">+{remaining} more</span>}
    </div>
  );
}

/** List-first roles view: creation and detail both live behind an explicit action, not open by default. */
export function RoleList({
  canGrant,
  canRevoke,
  onOpenRole,
  onCreateNew,
}: {
  canGrant: boolean;
  canRevoke: boolean;
  onOpenRole: (roleId: string) => void;
  onCreateNew: () => void;
}) {
  const tableRef = useRef<ApiTableActions | null>(null);

  async function handleDelete(role: Role) {
    const confirmed = await confirmAction({
      title: `Delete the role "${role.name}"?`,
      consequences: [
        "Everyone currently assigned this role loses the permissions it grants",
        "The role definition is permanently removed",
      ],
      confirmLabel: "Delete role",
    });
    if (!confirmed) return;
    try {
      await deleteJson(`/api/v1/roles/${role.id}`, successResponseSchema);
      toast("Role deleted", "success");
      await tableRef.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div>
      <ApiDataTable
        urlState="roles"
        endpoint="/api/v1/roles"
        responseSchema={rolesListResponseSchema}
        resolve={(data) => data.roles}
        resolvePage={(data) => data.page}
        paginate
        actionsRef={tableRef}
        createAction={canGrant ? { label: "New role", onSelect: onCreateNew } : undefined}
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
            cell: (r) => <PermissionsSummaryCell permissions={r.permissions} />,
          },
          {
            header: "",
            cell: (r) => (
              <div class="d-flex gap-1 justify-content-end align-items-center">
                <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => onOpenRole(r.id)}>
                  Open
                </button>
                {canRevoke && (
                  <RowActions
                    actions={[
                      {
                        id: "delete",
                        label: "Delete role",
                        onSelect: () => void handleDelete(r),
                        disabled: r.isSystemRole,
                      },
                    ]}
                  />
                )}
              </div>
            ),
          },
        ]}
        empty={
          canGrant ? (
            <EmptyState title="No roles yet" body="Create a role to bundle permissions you assign together." />
          ) : (
            <EmptyState title="No roles yet" />
          )
        }
        rowKey={(r) => r.id}
      />
    </div>
  );
}
