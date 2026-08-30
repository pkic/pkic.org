import { useRef, useState } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import {
  groupEventDetailResponseSchema,
  groupEventsListResponseSchema,
} from "../../../../../shared/schemas/group-events";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { fmt } from "../../ui";
import { GroupEventEditor } from "./GroupEventEditor";
import { GroupEventWorkspace } from "./GroupEventWorkspace";
import { ResourceCapabilities } from "./ResourceCapabilities";

export function GroupEvents({
  groupId,
  canManage = false,
  initialEventId,
  initialEventTab,
}: {
  groupId: string;
  canManage?: boolean;
  initialEventId?: string;
  initialEventTab?: string;
}) {
  const [, navigate] = useHashLocation();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(initialEventId ?? null);
  const [showCreate, setShowCreate] = useState(false);
  const tableActions = useRef<ApiTableActions | null>(null);
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

  function selectEvent(eventId: string | null): void {
    setSelectedEventId(eventId);
    navigate(
      eventId
        ? `/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}`
        : `/groups/${encodeURIComponent(groupId)}/events`,
    );
  }

  if (selectedEventId) {
    return (
      <div class="d-flex flex-column gap-3">
        {detail.loading && <Spinner />}
        {detail.error && <ErrorAlert error={detail.error} />}
        {!detail.loading && !detail.error && detail.data?.event.id === selectedEventId && (
          <GroupEventWorkspace
            event={detail.data.event}
            groupId={groupId}
            tab={initialEventTab}
            onUpdated={detail.reload}
          />
        )}
      </div>
    );
  }

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Events</div>
      <div class="card-body">
        {canManage && (
          <div class="mb-3">
            <button
              type="button"
              class="btn btn-sm btn-primary"
              aria-expanded={showCreate}
              onClick={() => setShowCreate((shown) => !shown)}
            >
              {showCreate ? "Hide event editor" : "Create event"}
            </button>
          </div>
        )}
        {showCreate && (
          <div class="card mb-3">
            <div class="card-header fw-semibold">New group event</div>
            <div class="card-body">
              <GroupEventEditor
                groupId={groupId}
                event={null}
                onSaved={async () => {
                  setShowCreate(false);
                  await tableActions.current?.reload();
                }}
                onCancel={() => setShowCreate(false)}
              />
            </div>
          </div>
        )}
        <ApiDataTable
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/events`}
          responseSchema={groupEventsListResponseSchema}
          resolve={(response) => response.events}
          resolvePage={(response) => response.page}
          paginate
          actionsRef={tableActions}
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
                <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => selectEvent(event.id)}>
                  Details
                </button>
              ),
            },
          ]}
          empty="No events are available through this group."
          rowKey={(event) => event.id}
        />
      </div>
    </div>
  );
}
