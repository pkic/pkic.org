import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import type { EventSummary, WorkingGroupSummary } from "../../types";

export interface PickedContext {
  contextType: "event" | "working_group" | null;
  contextId: string | null;
}

/** contextType/contextId picker for permission_grants / user_roles (PRD §2.1 — both null, or both set). */
export function ContextPicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedContext;
  onChange: (context: PickedContext) => void;
  disabled?: boolean;
}) {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [workingGroups, setWorkingGroups] = useState<WorkingGroupSummary[] | null>(null);

  useEffect(() => {
    if (value.contextType === "event" && events === null) {
      api<{ events: EventSummary[] }>("/api/v1/admin/events")
        .then((d) => setEvents(d.events))
        .catch(() => setEvents([]));
    }
    if (value.contextType === "working_group" && workingGroups === null) {
      api<{ workingGroups: WorkingGroupSummary[] }>("/api/v1/working-groups")
        .then((d) => setWorkingGroups(d.workingGroups))
        .catch(() => setWorkingGroups([]));
    }
  }, [value.contextType]);

  return (
    <div class="d-flex gap-2">
      <select
        class="form-select form-select-sm"
        value={value.contextType ?? ""}
        disabled={disabled}
        onChange={(e) => {
          const contextType = (e.target as HTMLSelectElement).value as "" | "event" | "working_group";
          onChange({ contextType: contextType || null, contextId: null });
        }}
      >
        <option value="">Global (no context)</option>
        <option value="event">Event</option>
        <option value="working_group">Working group</option>
      </select>
      {value.contextType === "event" && (
        <select
          class="form-select form-select-sm"
          value={value.contextId ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, contextId: (e.target as HTMLSelectElement).value || null })}
        >
          <option value="">Select event…</option>
          {(events ?? []).map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
            </option>
          ))}
        </select>
      )}
      {value.contextType === "working_group" && (
        <select
          class="form-select form-select-sm"
          value={value.contextId ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, contextId: (e.target as HTMLSelectElement).value || null })}
        >
          <option value="">Select working group…</option>
          {(workingGroups ?? []).map((wg) => (
            <option key={wg.id} value={wg.id}>
              {wg.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
