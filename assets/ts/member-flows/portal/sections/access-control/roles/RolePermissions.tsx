import { PERMISSIONS, type Permission } from "../../../../../../shared/schemas/permissions";
import { Checkbox } from "../../../../../ui/Checkbox";
// `pk-mono` comes from Content.css and is written here as a class name rather
// than reached through a component, so this module pulls the stylesheet into
// its own chunk.
import "../../../../../ui/Content.css";

/**
 * Shared permission-bundle checkbox grid used by both role creation and
 * editing. Both callers wrap it in a `<fieldset>` whose `<legend>` names the
 * group, so this renders the controls and nothing else.
 */
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
    // The frame and the inset moved into `.portal-access-role-permissions`
    // beside the scroll behaviour they belong with; the markup keeps only the
    // arrangement.
    <div class="pk-cluster portal-access-role-permissions">
      {PERMISSIONS.map((permission) => (
        <Checkbox
          key={permission}
          checked={selected.has(permission)}
          onChange={() => onToggle(permission)}
          disabled={disabled}
          label={<span class="pk-mono pk-small">{permission}</span>}
        />
      ))}
    </div>
  );
}
