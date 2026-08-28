import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { permissionTargetCatalog } from "./catalogs";

export interface PickedTarget {
  targetType: "event" | "group" | "organization" | null;
  targetId: string | null;
}

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
    <div>
      <div class="d-flex gap-2">
        <select
          class="form-select form-select-sm"
          value={value.targetType ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const targetType = (e.target as HTMLSelectElement).value as "" | "event" | "group" | "organization";
            onChange({ targetType: targetType || null, targetId: null });
          }}
        >
          <option value="">Global (no target)</option>
          <option value="event">Event</option>
          <option value="group">Group</option>
          <option value="organization">Organization</option>
        </select>
        {value.targetType === "event" && (
          <div class="flex-grow-1">
            <ServerSearchSelect
              catalog={permissionTargetCatalog("event")}
              label="Event"
              value={value.targetId}
              disabled={disabled}
              placeholder="Select event…"
              onChange={(event) => onChange({ ...value, targetId: event?.id ?? null })}
            />
          </div>
        )}
        {value.targetType === "group" && (
          <div class="flex-grow-1">
            <ServerSearchSelect
              catalog={permissionTargetCatalog("group")}
              label="Group"
              value={value.targetId}
              disabled={disabled}
              placeholder="Select group…"
              onChange={(group) => onChange({ ...value, targetId: group?.id ?? null })}
            />
          </div>
        )}
        {value.targetType === "organization" && (
          <div class="flex-grow-1">
            <ServerSearchSelect
              catalog={permissionTargetCatalog("organization")}
              label="Organization"
              value={value.targetId}
              disabled={disabled}
              placeholder="Select organization…"
              onChange={(organization) => onChange({ ...value, targetId: organization?.id ?? null })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
