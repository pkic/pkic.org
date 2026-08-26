import { useState } from "preact/hooks";
import {
  groupEventDetailResponseSchema,
  groupEventsListResponseSchema,
} from "../../../../../shared/schemas/group-events";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { fmt } from "../../ui";
import { ResourceCapabilities } from "./ResourceCapabilities";
import { ResourceSharingEditor } from "./ResourceSharingEditor";

export function GroupEvents({ groupId }: { groupId: string }) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const detail = useData(
    () =>
      selectedEventId
        ? getJson(
            `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(selectedEventId)}`,
            groupEventDetailResponseSchema,
          )
        : Promise.resolve(null),
    [groupId, selectedEventId],
  );

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
            {
              header: "",
              className: "text-end",
              cell: (event) => (
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary"
                  aria-expanded={selectedEventId === event.id}
                  onClick={() => setSelectedEventId((current) => (current === event.id ? null : event.id))}
                >
                  {selectedEventId === event.id ? "Hide" : "Details"}
                </button>
              ),
            },
          ]}
          empty="No events are available through this group."
          rowKey={(event) => event.id}
          detailRow={(event) => {
            if (selectedEventId !== event.id) return null;
            if (detail.loading) return <Spinner />;
            if (detail.error) return <ErrorAlert error={detail.error} />;
            if (detail.data?.event.id !== event.id) return null;
            const selected = detail.data.event;
            if (!selected.capabilities.includes("manage") || selected.ownerGroupId !== groupId) {
              return <p class="small text-muted mb-0">No management actions are available for this event.</p>;
            }
            return (
              <div class="p-3 bg-body-tertiary">
                <ResourceSharingEditor
                  kind="event"
                  groupId={groupId}
                  resourceId={selected.id}
                  ownerGroupId={selected.ownerGroupId}
                />
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
