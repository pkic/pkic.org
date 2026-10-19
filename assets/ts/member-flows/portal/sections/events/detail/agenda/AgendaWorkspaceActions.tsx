import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import type { MenuItem } from "../../../../../../ui/Menu";
import { RowActions } from "../../../../../../ui/RowActions";

/**
 * The whole-agenda menu, grouped by purpose: build the program, set up the venue, then review and publish.
 * Individual locations are edited from the Locations tab or their calendar column header; the menu offers them as
 * one submenu rather than one item per room.
 */
export function AgendaWorkspaceActions({
  snapshot,
  canEdit,
  busy,
  onUndo,
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
  const build: MenuItem[] = canEdit
    ? [
        ...(onUndo ? [{ id: "undo", label: "Undo last session edit", disabled: busy, onSelect: onUndo }] : []),
        { id: "new-session", label: "New session", separatorBefore: Boolean(onUndo), onSelect: onNewSession },
        { id: "new-break", label: "Add break or lunch", onSelect: onNewBreak },
        { id: "reuse", label: "Reuse a session", onSelect: onReuseSession },
        { id: "import", label: "Import sessions", onSelect: onImport },
      ]
    : [];
  const venue: MenuItem[] = canEdit
    ? [
        { id: "location", label: "New location", separatorBefore: true, onSelect: onNewLocation },
        ...(snapshot.rooms.length
          ? [
              {
                id: "edit-location",
                label: "Edit location",
                children: snapshot.rooms.map((room) => ({
                  id: room.id,
                  label: room.name,
                  onSelect: () => onEditLocation(room),
                })),
              },
            ]
          : []),
        { id: "rules", label: "Scheduling rules", onSelect: onSettings },
      ]
    : [];
  return (
    <RowActions
      subject="Agenda"
      actions={[
        ...build,
        ...venue,
        {
          id: "publication",
          label: "Review for publication",
          separatorBefore: build.length + venue.length > 0,
          onSelect: onPublication,
        },
        { id: "preview", label: "Public preview", onSelect: onPreview },
      ]}
    />
  );
}
