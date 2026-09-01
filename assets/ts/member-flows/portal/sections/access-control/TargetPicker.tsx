import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { Field } from "../../../../ui/Field";
import { Select } from "../../../../ui/TextControl";
import { permissionTargetCatalog } from "./catalogs";

export interface PickedTarget {
  targetType: "event" | "group" | "organization" | null;
  targetId: string | null;
}

type TargetType = NonNullable<PickedTarget["targetType"]>;

/**
 * The three resource kinds a grant can be scoped to. One record drives both the
 * type menu and the search selector's label, so the two cannot drift apart the
 * way three copied branches could.
 */
const TARGET_LABELS: Record<TargetType, string> = {
  event: "Event",
  group: "Group",
  organization: "Organization",
};

/** Resource-target picker for permission grants and user-role assignments. */
export function TargetPicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedTarget;
  onChange: (target: PickedTarget) => void;
  disabled?: boolean;
}) {
  return (
    // A grid rather than a flex row: the two selectors sit side by side where
    // there is room and stack on a phone, without a breakpoint class each.
    <div class="pk pk-grid">
      <Field label="Target type" help="A grant with no target applies everywhere.">
        {(control) => (
          <Select
            {...control}
            value={value.targetType ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const targetType = (e.target as HTMLSelectElement).value as "" | TargetType;
              onChange({ targetType: targetType || null, targetId: null });
            }}
          >
            <option value="">Global (no target)</option>
            {Object.entries(TARGET_LABELS).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {value.targetType && (
        <ServerSearchSelect
          // Remounts when the kind changes, so the previous kind's search text
          // and page do not carry over into a different catalog.
          key={value.targetType}
          catalog={permissionTargetCatalog(value.targetType)}
          label={TARGET_LABELS[value.targetType]}
          value={value.targetId}
          disabled={disabled}
          placeholder={`Select ${TARGET_LABELS[value.targetType].toLowerCase()}…`}
          onChange={(target) => onChange({ ...value, targetId: target?.id ?? null })}
        />
      )}
    </div>
  );
}
