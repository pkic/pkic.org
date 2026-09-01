import { PERMISSIONS, type Permission } from "../../../../../../shared/schemas/permissions";
// `pk-check`, `pk-check__input` and `pk-check__label` come from Field.css and
// `pk-mono` from Content.css. Both are written here as class names rather than
// reached through a component, so this module pulls the stylesheets into its
// own chunk: a label carrying only `pk-check` renders an operating-system
// default checkbox, and nothing complains.
import "../../../../../ui/Field.css";
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
        // The label wraps the control, so the two are bound without a `for`/`id`
        // pair to keep in step.
        <label key={permission} class="pk-check">
          <input
            class="pk-check__input"
            type="checkbox"
            checked={selected.has(permission)}
            onChange={() => onToggle(permission)}
            disabled={disabled}
          />
          <span class="pk-check__label pk-mono pk-small">{permission}</span>
        </label>
      ))}
    </div>
  );
}
