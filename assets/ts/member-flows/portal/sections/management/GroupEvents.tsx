import { HashRedirect } from "../../HashRedirect";
import { useEffect, useRef } from "preact/hooks";
import {
  groupEventDetailResponseSchema,
  groupEventsListResponseSchema,
} from "../../../../../shared/schemas/group-events";
import { EVENT_SOURCE_MODE_LABELS, EVENT_SOURCE_MODES } from "../../../../../shared/schemas/event-series";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { usePortalHashLocation } from "../../hash-location";
import { fmt } from "../../ui";
import { GroupEventEditor } from "./GroupEventEditor";
import { GroupEventWorkspace } from "./GroupEventWorkspace";

/** Reserved event segment that routes to the create page instead of a record. */
const NEW_EVENT_SEGMENT = "new";

/** Redirects back to the list from an effect, not render — see its call site below. */
function GroupEventsRedirect({ onNavigate }: { onNavigate: () => void }) {
  useEffect(onNavigate, [onNavigate]);
  return null;
}

export function GroupEvents({
  groupId,
  collection = "events",
  canManage = false,
  initialEventId,
  initialEventTab,
  initialEventDetailId,
  initialEventDetailTab,
  initialEventDetailSegment,
}: {
  groupId: string;
  collection?: "events" | "unscheduled_meetings";
  canManage?: boolean;
  initialEventId?: string;
  initialEventTab?: string;
  initialEventDetailId?: string;
  /** The facet of the tab's resource: a proposal's own tab. */
  initialEventDetailTab?: string;
  /** A page under that facet: the co-speaker invitation under a proposal's Speakers. */
  initialEventDetailSegment?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const eventsPath = `/groups/${encodeURIComponent(groupId)}/events`;
  const creating = initialEventId === NEW_EVENT_SEGMENT;
  // The event id arrives from the URL; rows are links, so this surface never
  // drives navigation itself.
  const selectedEventId = creating ? null : (initialEventId ?? null);
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

  if (creating) {
    // Navigating away belongs in an effect, not in render.
    if (!canManage) return <GroupEventsRedirect onNavigate={() => navigate(eventsPath)} />;
    return (
      <div class="pk pk-stack">
        {/* The page's way back: creating has its own address, so leaving it
            is navigation rather than the disappearance of a layer. */}

        <Panel aria-label="New group event">
          <PanelHeader title="New group event" headingLevel={2} breadcrumb />
          <PanelBody>
            <GroupEventEditor
              groupId={groupId}
              event={null}
              onSaved={async () => navigate(eventsPath)}
              onCancel={() => navigate(eventsPath)}
            />
          </PanelBody>
        </Panel>
      </div>
    );
  }

  if (
    selectedEventId &&
    canManage &&
    detail.data?.event.id === selectedEventId &&
    !detail.data.event.seriesId &&
    ["meeting", "board_meeting"].includes(detail.data.event.profileKey ?? "")
  ) {
    return (
      <HashRedirect to={`/groups/${encodeURIComponent(groupId)}/meetings/new/${encodeURIComponent(selectedEventId)}`} />
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
            detailTab={initialEventDetailTab}
            detailSegment={initialEventDetailSegment}
            onUpdated={detail.reload}
          />
        )}
      </div>
    );
  }

  return (
    <div class="pk pk-stack">
      <ApiDataTable
        caption={collection === "events" ? "Group events" : "Meetings awaiting a schedule"}
        params={{ collection }}
        endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/events`}
        responseSchema={groupEventsListResponseSchema}
        resolve={(response) => response.events}
        resolvePage={(response) => response.page}
        paginate
        actionsRef={tableActions}
        createAction={
          canManage && collection === "events"
            ? { label: "Create event", onSelect: () => navigate(`${eventsPath}/${NEW_EVENT_SEGMENT}`) }
            : undefined
        }
        searchPlaceholder={collection === "events" ? "Search events…" : "Search meetings…"}
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
            cell: (event) => (event.sourceMode ? EVENT_SOURCE_MODE_LABELS[event.sourceMode] : "—"),
            width: "fit",
            filter: {
              param: "sourceMode",
              options: [
                { value: "", label: "All sources" },
                ...EVENT_SOURCE_MODES.map((mode) => ({ value: mode as string, label: EVENT_SOURCE_MODE_LABELS[mode] })),
              ],
            },
          },
          {
            // A date has a bounded length; the column says so instead of
            // wearing `pk-nowrap` while still claiming slack.
            header: "Next",
            cell: (event) =>
              event.nextOccurrenceAt || event.startsAt
                ? fmt(event.nextOccurrenceAt ?? event.startsAt)
                : "Not scheduled",
            width: "fit",
            sort: { asc: "next_occurrence_at", desc: "-next_occurrence_at", defaultDirection: "asc" },
          },
        ]}
        empty={
          collection === "unscheduled_meetings" ? (
            "No meetings awaiting a schedule."
          ) : canManage ? (
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
          href:
            collection === "unscheduled_meetings"
              ? `#/groups/${encodeURIComponent(groupId)}/meetings/new/${encodeURIComponent(event.id)}`
              : `#/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}`,
        })}
      />
    </div>
  );
}
