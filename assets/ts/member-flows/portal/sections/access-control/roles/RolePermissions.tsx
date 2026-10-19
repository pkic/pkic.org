import { permissionAreas } from "../../../../../../shared/permission-metadata";
import { isPermission, PERMISSIONS, type Permission } from "../../../../../../shared/schemas/permissions";
import { type MatrixArea, PermissionMatrix } from "../../../../../components/PermissionMatrix";

/** Every permission in the catalog by area; the opened list names each one's code as well. */
const CATALOG_AREAS: readonly MatrixArea[] = permissionAreas(PERMISSIONS).map((area) => ({
  ...area,
  permissions: area.permissions.map((item) => ({ ...item, hint: item.permission })),
}));

/**
 * A role's permission bundle in the shared permission matrix, for role
 * creation, editing and the role's details. The form callers wrap it in a
 * `<fieldset>` whose `<legend>` names the group.
 */
export function RolePermissions({
  selected,
  onSelect,
  disabled,
}: {
  selected: ReadonlySet<Permission>;
  /** Without it the matrix is read only. */
  onSelect?: (next: Set<Permission>) => void;
  disabled?: boolean;
}) {
  return (
    <div class="portal-access-role-permissions">
      <PermissionMatrix
        areas={CATALOG_AREAS}
        selected={selected}
        disabled={disabled}
        readOnly={!onSelect}
        onSelect={(next) => onSelect?.(new Set([...next].filter(isPermission)))}
      />
    </div>
  );
}
