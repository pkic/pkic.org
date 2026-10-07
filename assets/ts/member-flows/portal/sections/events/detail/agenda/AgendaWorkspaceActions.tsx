import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { RowActions } from "../../../../../../ui/RowActions";
export function AgendaWorkspaceActions({
  snapshot,
  canEdit,
  busy,
  onUndo,
  calendarLocked,
  onToggleCalendarLock,
  onNewSession,
  onNewBreak,
  onSettings,
  onImport,
  onReuseSession,
  onPreview,
  onNewLocation,
  onEditLocation,
  onPublication,
}: {
  snapshot: AgendaSnapshot;
  canEdit: boolean;
  busy: boolean;
  onUndo?: () => void;
  calendarLocked: boolean;
  onToggleCalendarLock: () => void;
  onNewSession: () => void;
  onNewBreak: () => void;
  onSettings: () => void;
  onImport: () => void;
  onReuseSession: () => void;
  onPreview: () => void;
  onNewLocation: () => void;
  onEditLocation: (room: AgendaSnapshot["rooms"][number]) => void;
  onPublication: () => void;
}) {
  return (
    <RowActions
      subject="Agenda"
      actions={[
        { id: "publication", label: "Review for publication", onSelect: onPublication },
        { id: "preview", label: "Public preview", onSelect: onPreview },
        ...(canEdit
          ? [
              ...(onUndo ? [{ id: "undo", label: "Undo last session edit", disabled: busy, onSelect: onUndo }] : []),
              {
                id: "calendar-lock",
                label: calendarLocked ? "Unlock calendar" : "Lock calendar",
                onSelect: onToggleCalendarLock,
              },
              { id: "new-session", label: "New session", onSelect: onNewSession },
              { id: "new-break", label: "Add break or lunch", onSelect: onNewBreak },
              { id: "rules", label: "Scheduling rules", onSelect: onSettings },
              { id: "import", label: "Import sessions", onSelect: onImport },
              { id: "reuse", label: "Reuse a session", onSelect: onReuseSession },
              { id: "location", label: "New location", onSelect: onNewLocation },
              ...snapshot.rooms.map((room) => ({
                id: room.id,
                label: `Edit ${room.name}`,
                onSelect: () => onEditLocation(room),
              })),
            ]
          : []),
      ]}
    />
  );
}
