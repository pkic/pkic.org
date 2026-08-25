import { groupEventsListResponseSchema } from "../../../../../shared/schemas/group-events";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { fmt } from "../../ui";
import { ResourceCapabilities } from "./ResourceCapabilities";

export function GroupEvents({ groupId }: { groupId: string }) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Events</div>
      <div class="card-body">
        <ApiDataTable
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/events`}
          responseSchema={groupEventsListResponseSchema}
          resolve={(response) => response.events}
          resolvePage={(response) => response.page}
          paginate
          searchPlaceholder="Search events…"
          initialSort="next_occurrence_at"
          columns={[
            {
              header: "Event",
              cell: (event) => (
                <div>
                  <div class="fw-semibold">{event.name}</div>
                  {event.location && <div class="small text-muted">{event.location}</div>}
                </div>
              ),
              sort: { asc: "name", desc: "-name" },
            },
            {
              header: "Profile",
              cell: (event) => <Badge status={event.profileKey ?? "event"} />,
            },
            {
              header: "Next",
              cell: (event) => fmt(event.nextOccurrenceAt ?? event.startsAt),
              className: "text-nowrap",
              sort: { asc: "next_occurrence_at", desc: "-next_occurrence_at", defaultDirection: "asc" },
            },
            { header: "Access", cell: (event) => <ResourceCapabilities capabilities={event.capabilities} /> },
          ]}
          empty="No events are available through this group."
          rowKey={(event) => event.id}
        />
      </div>
    </div>
  );
}
