import { useRef } from "preact/hooks";
import { eventSeriesListResponseSchema, type GroupEventSeries } from "../../../../../shared/schemas/event-series";
import { eventSeriesCancelResponseSchema } from "../../../../../shared/schemas/meeting-invitations";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { postJson } from "../../../../shared/api-client";
import { usePortalHashLocation } from "../../hash-location";
import { useMeetingCancellation } from "./useMeetingCancellation";
import { downloadMeetingCalendar } from "./meeting-calendar-actions";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import { RowActions } from "../../../../ui/RowActions";
import { fmt } from "../../ui";

export function GroupMeetingSeriesList({
  groupId,
  createAction,
}: {
  groupId: string;
  createAction?: { label: string; onSelect: () => void; disabled?: boolean };
}) {
  const meetingsPath = `/groups/${encodeURIComponent(groupId)}/meetings`;
  const [, navigate] = usePortalHashLocation();
  const actions = useRef<ApiTableActions | null>(null);
  const cancellation = useMeetingCancellation<GroupEventSeries>({
    wholeSeries: true,
    label: (series) => series.eventName,
    canCancel: (series) => series.active && series.capabilities.includes("manage"),
    cancel: (series) =>
      postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(series.id)}/cancel`,
        { expectedUpdatedAt: series.updatedAt },
        eventSeriesCancelResponseSchema,
      ),
    reload: async () => actions.current?.reload(),
  });

  return (
    <ApiDataTable
      caption="Meetings"
      endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series`}
      responseSchema={eventSeriesListResponseSchema}
      resolve={(response) => response.series}
      resolvePage={(response) => response.page}
      paginate
      actionsRef={actions}
      onData={(response) => cancellation.onRows(response.series)}
      selection={cancellation.selection}
      bulkBar={cancellation.bulkBar}
      createAction={createAction}
      searchPlaceholder="Search meeting name or location…"
      initialSort="next_occurrence_at"
      columns={[
        {
          // A meeting, whether it happens once or repeats: the portal draws
          // the line between meetings and events, not between one meeting and
          // a series of them (#101).
          header: "Meeting",
          cell: (series) => (
            <div class="pk-stack pk-stack--tight">
              <span class="pk-strong">{series.eventName}</span>
              {series.location && <span class="pk-small">{series.location}</span>}
            </div>
          ),
          sort: { asc: "event_name", desc: "-event_name" },
        },
        { header: "Profile", cell: (series) => <Badge status={series.profileKey} />, width: "fit" },
        {
          // A date has a bounded length; the column says so instead of
          // wearing `pk-nowrap` while still claiming slack.
          header: "Next",
          cell: (series) => fmt(series.nextOccurrenceAt ?? series.startsAt),
          width: "fit",
          sort: { asc: "next_occurrence_at", desc: "-next_occurrence_at", defaultDirection: "asc" },
        },
        {
          // An active series used to be a grey em dash and an inactive one a
          // pill, so the difference between the two was a shape nobody could
          // name and a colour nobody could hear. Both states say their word.
          header: "Status",
          cell: (series) => <Badge status={series.active ? "active" : "inactive"} />,
          width: "fit",
        },
        {
          header: "",
          cell: (series) => (
            // Row commands live behind the row's menu; the row itself opens
            // the record. The calendar file is a navigation the menu starts.
            <RowActions
              subject={series.eventName}
              actions={[
                {
                  id: "calendar",
                  label: "Download calendar",
                  onSelect: () => downloadMeetingCalendar(groupId, series.id),
                },
                ...(series.capabilities.includes("manage")
                  ? [
                      {
                        id: "settings",
                        label: "Change meeting…",
                        onSelect: () => navigate(`${meetingsPath}/${encodeURIComponent(series.id)}/settings`),
                      },
                      {
                        id: "cancel",
                        label: "Cancel meeting…",
                        danger: true,
                        disabled: cancellation.busy || !series.active,
                        onSelect: () => void cancellation.cancelRows([series]),
                      },
                    ]
                  : []),
              ]}
            />
          ),
        },
      ]}
      empty={
        createAction ? (
          // The same `createAction` is already the toolbar's button, so this
          // state names it rather than rendering it a second time under the
          // same accessible name.
          <EmptyState title="No meetings yet" body={`Use ${createAction.label} above to get started.`} />
        ) : (
          "No matching meetings."
        )
      }
      rowKey={(series) => series.id}
      // A series is a URL-addressed record; the row is a link to it, so it
      // can be opened in a new tab and the address bar follows.
      rowAction={(series) => ({
        label: `Open ${series.eventName}`,
        href: `#${meetingsPath}/${encodeURIComponent(series.id)}`,
      })}
    />
  );
}
