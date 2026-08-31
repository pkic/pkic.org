import { useRef, useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import {
  groupEventDetailResponseSchema,
  groupEventsListResponseSchema,
} from "../../../../../shared/schemas/group-events";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { fmt } from "../../ui";
import { GroupEventEditor } from "./GroupEventEditor";
import { GroupEventWorkspace } from "./GroupEventWorkspace";

export function GroupEvents({
  groupId,
  canManage = false,
  initialEventId,
  initialEventTab,
  initialEventDetailId,
}: {
  groupId: string;
  canManage?: boolean;
  initialEventId?: string;
  initialEventTab?: string;
  initialEventDetailId?: string;
}) {
  const [, navigate] = usePortalHashLocation();
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
        {detail.loading && <Spinner label="Loading event…" />}
        {detail.error && <ErrorAlert error={detail.error} />}
        {!detail.loading && !detail.error && detail.data?.event.id === selectedEventId && (
          <GroupEventWorkspace
            event={detail.data.event}
            groupId={groupId}
            tab={initialEventTab}
            detailId={initialEventDetailId}
            onUpdated={detail.reload}
          />
        )}
      </div>
    );
  }

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-body">
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
          createAction={canManage ? { label: "Create event", onSelect: () => setShowCreate(true) } : undefined}
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
          empty={
            canManage ? (
              <EmptyState title="No events yet" body="Create an event to get started." />
            ) : (
              "No events are available through this group."
            )
          }
          rowKey={(event) => event.id}
        />
      </div>
    </div>
  );
}
