import { useId, useRef, useState } from "preact/hooks";
import {
  groupEventDetailResponseSchema,
  groupEventsListResponseSchema,
} from "../../../../../shared/schemas/group-events";
import { EVENT_SOURCE_MODES, type EventSourceMode } from "../../../../../shared/schemas/event-series";
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

/** Where an event is authored, in product language rather than schema keys. */
const EVENT_SOURCE_LABELS: Record<EventSourceMode, string> = {
  hugo: "Website content",
  portal: "Portal",
  integration: "Integration",
};

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
  // The event id arrives from the URL; rows are links, so this surface never
  // drives navigation itself.
  const selectedEventId = initialEventId ?? null;
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
            // Where the event is authored. The list contract already accepts
            // `sourceMode`; the column shows the value and its menu narrows by
            // it, instead of a select above the table filtering by something
            // no column said.
            header: "Source",
            cell: (event) => (event.sourceMode ? EVENT_SOURCE_LABELS[event.sourceMode] : "—"),
            width: "fit",
            filter: {
              param: "sourceMode",
              options: [
                { value: "", label: "All sources" },
                ...EVENT_SOURCE_MODES.map((mode) => ({ value: mode as string, label: EVENT_SOURCE_LABELS[mode] })),
              ],
            },
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
        rowAction={(event) => ({
          label: `Open ${event.name}`,
          href: `#/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}`,
        })}
      />
    </div>
  );
}
