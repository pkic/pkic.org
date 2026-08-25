import { adminEventCatalog, adminGroupCatalog } from "../../services/catalogs";
import { ServerSearchSelect } from "../../components/ServerSearchSelect";

export interface PickedContext {
  contextType: "event" | "group" | null;
  contextId: string | null;
}

/** contextType/contextId picker for permission_grants / user_roles (both null, or both set). */
export function ContextPicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedContext;
  onChange: (context: PickedContext) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div class="d-flex gap-2">
        <select
          class="form-select form-select-sm"
          value={value.contextType ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const contextType = (e.target as HTMLSelectElement).value as "" | "event" | "group";
            onChange({ contextType: contextType || null, contextId: null });
          }}
        >
          <option value="">Global (no context)</option>
          <option value="event">Event</option>
          <option value="group">Group</option>
        </select>
        {value.contextType === "event" && (
          <div class="flex-grow-1">
            <ServerSearchSelect
              catalog={adminEventCatalog}
              label="Event"
              value={value.contextId}
              disabled={disabled}
              placeholder="Select event…"
              onChange={(event) => onChange({ ...value, contextId: event?.id ?? null })}
            />
          </div>
        )}
        {value.contextType === "group" && (
          <div class="flex-grow-1">
            <ServerSearchSelect
              catalog={adminGroupCatalog}
              label="Group"
              value={value.contextId}
              disabled={disabled}
              placeholder="Select group…"
              onChange={(group) => onChange({ ...value, contextId: group?.id ?? null })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
