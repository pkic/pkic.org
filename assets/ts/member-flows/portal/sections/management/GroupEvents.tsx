import { useId, useRef, useState } from "preact/hooks";
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
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
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
  const createHeadingId = useId();
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
      <div class="pk pk-stack">
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
    <div class="pk pk-stack">
      {showCreate && (
        <Panel aria-labelledby={createHeadingId}>
          <PanelHeader id={createHeadingId} title="New group event" />
          <PanelBody>
            <GroupEventEditor
              groupId={groupId}
              event={null}
              onSaved={async () => {
                setShowCreate(false);
                await tableActions.current?.reload();
              }}
              onCancel={() => setShowCreate(false)}
            />
          </PanelBody>
        </Panel>
      )}
      <Panel>
        <PanelBody>
          <ApiDataTable
            caption="Group events"
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
                  <div class="pk-stack pk-stack--tight">
                    <span class="pk-strong">{event.name}</span>
                    {event.location && <span class="pk-small">{event.location}</span>}
                  </div>
                ),
                sort: { asc: "name", desc: "-name" },
              },
              {
                header: "Profile",
                cell: (event) => <Badge status={event.profileKey ?? "event"} />,
                width: "fit",
              },
              {
                // A date has a bounded length; the column says so instead of
                // wearing `pk-nowrap` while still claiming slack.
                header: "Next",
                cell: (event) => fmt(event.nextOccurrenceAt ?? event.startsAt),
                width: "fit",
                sort: { asc: "next_occurrence_at", desc: "-next_occurrence_at", defaultDirection: "asc" },
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
            // The whole row opens the event. It used to be a "Details" button in
            // a nameless last column, which meant the row itself was inert and
            // the button repeated once per row with the same accessible name.
            rowAction={(event) => ({ label: `Open ${event.name}`, onSelect: () => selectEvent(event.id) })}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
