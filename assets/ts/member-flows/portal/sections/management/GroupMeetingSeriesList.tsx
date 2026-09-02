import { eventSeriesListResponseSchema } from "../../../../../shared/schemas/event-series";
import { ApiDataTable } from "../../../../components/ApiDataTable";
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

  return (
    <ApiDataTable
      caption="Meeting series"
      endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series`}
      responseSchema={eventSeriesListResponseSchema}
      resolve={(response) => response.series}
      resolvePage={(response) => response.page}
      paginate
      createAction={createAction}
      searchPlaceholder="Search meeting name or location…"
      initialSort="next_occurrence_at"
      columns={[
        {
          header: "Meeting series",
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
                  onSelect: () => {
                    // A same-tab navigation to the calendar file. `window.open`
                    // rather than `location.assign` because jsdom lets a test
                    // observe the former; both navigate identically here.
                    window.open(
                      `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(series.id)}/calendar.ics`,
                      "_self",
                    );
                  },
                },
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
          <EmptyState title="No meeting series yet" body={`Use ${createAction.label} above to get started.`} />
        ) : (
          "No matching meeting series."
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
