import { useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../../components/EmptyState";
import { Badge } from "../../../../../ui/Badge";
import { Button } from "../../../../../ui/Button";
import { Chip } from "../../../../../ui/Chip";
import { RowActions } from "../../../../../ui/RowActions";
// `pk-mono` is written here as a class name rather than reached through a
// component, so this module has to pull its stylesheet into its own chunk.
// Without the import the permission keys render in the body face and nothing
// complains.
import "../../../../../ui/Content.css";
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
  if (permissions.length === 0) return <span class="pk-muted pk-small">None</span>;
  if (permissions.length > PERMISSION_COUNT_ONLY_THRESHOLD) {
    return <span class="pk-muted pk-small">{permissions.length} permissions</span>;
  }
  const visible = permissions.slice(0, MAX_VISIBLE_PERMISSION_CHIPS);
  const remaining = permissions.length - visible.length;
  return (
    // A permission is a tag the row reports, not a status and not a control,
    // so it is a static Chip — which renders as text rather than as a button
    // that does nothing when activated.
    <div class="pk-cluster">
      {visible.map((p) => (
        <Chip key={p}>
          <span class="pk-mono">{p}</span>
        </Chip>
      ))}
      {remaining > 0 && <span class="pk-muted pk-small">+{remaining} more</span>}
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
    // The table already supplies the surface's `.pk` root and its rhythm, so
    // the bare wrapper this used to sit in has gone with the utilities on it.
    <ApiDataTable
      caption="Roles"
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
            // The cluster's gap is what separates the name from the pill; the
            // pill used to carry its own `ms-1`.
            <span class="pk-cluster">
              <span class="pk-strong pk-mono">{r.name}</span>
              {r.isSystemRole && <Badge tone="neutral">System</Badge>}
            </span>
          ),
          sort: { asc: "name", desc: "-name" },
        },
        {
          header: "Description",
          cell: (r) => r.description ?? "—",
          className: "pk-small pk-muted",
          sort: { asc: "description", desc: "-description" },
        },
        {
          header: "Permissions",
          cell: (r) => <PermissionsSummaryCell permissions={r.permissions} />,
        },
        {
          header: "",
          className: "pk-end",
          cell: (r) => (
            // Both controls name the role they act on: a page of rows
            // otherwise offers a column of buttons all called "Open" and a
            // column of menus all called "Row actions".
            <div class="pk-cluster pk-cluster--end">
              <Button size="sm" aria-label={`Open ${r.name}`} onClick={() => onOpenRole(r.id)}>
                Open
              </Button>
              {canRevoke && (
                <RowActions
                  label={`Actions for ${r.name}`}
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
          // The toolbar above already carries "New role"; repeating it here
          // would leave one command answering to two identically named
          // controls.
          <EmptyState title="No roles yet" body="Use New role above to bundle permissions you assign together." />
        ) : (
          <EmptyState title="No roles yet" body="No roles have been defined for this installation." />
        )
      }
      rowKey={(r) => r.id}
    />
  );
}
