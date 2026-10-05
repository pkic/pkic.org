import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { RowActions } from "../../../../../../ui/RowActions";
export function AgendaWorkspaceActions({
  snapshot,
  canEdit,
  busy,
  onUndo,
  onSettings,
  onImport,
  onAcceptedProposals,
  onPreview,
  onNewLocation,
  onEditLocation,
  onPublication,
}: {
  snapshot: AgendaSnapshot;
  canEdit: boolean;
  busy: boolean;
  onUndo?: () => void;
  onSettings: () => void;
  onImport: () => void;
  onAcceptedProposals: () => void;
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
              { id: "rules", label: "Scheduling rules", onSelect: onSettings },
              { id: "import", label: "Import sessions", onSelect: onImport },
              { id: "accepted", label: "Accepted proposals", onSelect: onAcceptedProposals },
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
