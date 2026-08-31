import { PERMISSIONS, type Permission } from "../../../../../../shared/schemas/permissions";

/** Shared permission-bundle checkbox grid used by both role creation and editing. */
export function PermissionCheckboxes({
  selected,
  onToggle,
  disabled,
}: {
  selected: Set<Permission>;
  onToggle: (permission: Permission) => void;
  disabled?: boolean;
}) {
  return (
    <div class="d-flex flex-wrap gap-2 mb-2 p-2 border rounded portal-access-role-permissions">
      {PERMISSIONS.map((permission) => (
        <div key={permission} class="form-check">
          <input
            class="form-check-input"
            type="checkbox"
            id={`perm-${permission}`}
            checked={selected.has(permission)}
            onChange={() => onToggle(permission)}
            disabled={disabled}
          />
          <label class="form-check-label small mono" for={`perm-${permission}`}>
            {permission}
          </label>
        </div>
      ))}
    </div>
  );
}
