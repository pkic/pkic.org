import { agendaMediaCapabilities, withoutAgendaMediaEquipment } from "../../../../../../../shared/event-agenda-media";
import { IconBadge } from "../../../../../../ui/Badge";
import { IconVideo } from "../../../../../../ui/MediaIcons";
import { IconRemote } from "../../../../../../components/icons/indicators";
import { agendaRoomsListSchema } from "../../../../../../../shared/schemas/event-agenda-room-list";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { formatNumber } from "../../../../../../../shared/format-number";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { EmptyState } from "../../../../../../ui/EmptyState";

/** Locations are maintained through the same editor used by calendar columns. */
export function AgendaLocations({
  snapshot,
  canEdit,
  onEdit,
  onNew,
}: {
  snapshot: AgendaSnapshot;
  canEdit: boolean;
  onEdit: (room: AgendaSnapshot["rooms"][number]) => void;
  onNew: () => void;
}) {
  return (
    <ApiDataTable
      key={snapshot.revision}
      endpoint={`/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/rooms`}
      responseSchema={agendaRoomsListSchema}
      resolve={(response) => response.rooms}
      resolvePage={(response) => response.page}
      paginate
      urlState="agendaLocations"
      caption="Locations"
      searchPlaceholder="Search locations…"
      initialSort="name"
      rowKey={(room) => room.id}
      rowAction={canEdit ? (room) => ({ label: `Edit ${room.name}`, onSelect: () => onEdit(room) }) : undefined}
      createAction={canEdit ? { label: "New location", onSelect: onNew } : undefined}
      empty={
        <EmptyState
          title="No locations found"
          body={
            canEdit
              ? "Add a location to give its sessions their own calendar column."
              : "Locations appear here once organizers add them."
          }
        />
      }
      columns={[
        { header: "Location", sort: { asc: "name", desc: "-name" }, cell: (room) => room.name },
        {
          header: "Physical capacity",
          sort: { asc: "capacity", desc: "-capacity" },
          align: "end",
          width: "fit",
          cell: (room) => (room.capacity === null ? "Unlimited" : formatNumber(room.capacity)),
        },
        {
          header: "Setup buffer",
          align: "end",
          width: "fit",
          cell: (room) => `${formatNumber(room.setupMinutes ?? 0)} min`,
        },
        {
          header: "Planned media",
          width: "fit",
          cell: (room) => {
            const media = agendaMediaCapabilities(room.equipment);
            return (
              <div class="pk-cluster">
                {media.recording && <IconBadge icon={<IconVideo />} label="Recording planned" />}
                {media.liveStreaming && <IconBadge icon={<IconRemote />} label="Live streaming planned" />}
                {!media.recording && !media.liveStreaming && "None planned"}
              </div>
            );
          },
        },
        {
          header: "Equipment",
          cell: (room) => withoutAgendaMediaEquipment(room.equipment).join(", ") || "None recorded",
        },
      ]}
    />
  );
}
