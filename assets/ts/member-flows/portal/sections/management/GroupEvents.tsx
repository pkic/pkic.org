import { useRef, useState } from "preact/hooks";
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
import { GroupEventDetail } from "./GroupEventDetail";
import { GroupEventEditor } from "./GroupEventEditor";
import { ResourceCapabilities } from "./ResourceCapabilities";
import { ResourceSharingEditor } from "./ResourceSharingEditor";

function isStandaloneEvent(event: { seriesId: string | null; profileKey: string | null }): boolean {
  return event.seriesId === null && event.profileKey !== "meeting" && event.profileKey !== "board_meeting";
}

export function GroupEvents({ groupId, canManage = false }: { groupId: string; canManage?: boolean }) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
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
            return (
              <div class="p-3 bg-body-tertiary">
                <GroupEventDetail
                  event={selected}
                  groupId={groupId}
                  onUpdated={async () => {
                    await detail.reload();
                    await tableActions.current?.reload();
                  }}
                  onEdit={
                    selected.capabilities.includes("manage") && isStandaloneEvent(selected)
                      ? () => setEditingEventId(selected.id)
                      : undefined
                  }
                />
                {editingEventId === selected.id && (
                  <div class="border-top mt-3 pt-3">
                    <h6>Edit event</h6>
                    <GroupEventEditor
                      groupId={groupId}
                      event={selected}
                      onSaved={async () => {
                        setEditingEventId(null);
                        await detail.reload();
                        await tableActions.current?.reload();
                      }}
                      onCancel={() => setEditingEventId(null)}
                    />
                  </div>
                )}
                {selected.capabilities.includes("manage") && selected.ownerGroupId === groupId && (
                  <div class="border-top mt-3 pt-3">
                    <ResourceSharingEditor
                      kind="event"
                      groupId={groupId}
                      resourceId={selected.id}
                      ownerGroupId={selected.ownerGroupId}
                    />
                  </div>
                )}
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
