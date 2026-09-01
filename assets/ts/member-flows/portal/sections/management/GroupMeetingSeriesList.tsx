import { useRef, useState, type MutableRef } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { eventSeriesListResponseSchema } from "../../../../../shared/schemas/event-series";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import { Button } from "../../../../ui/Button";
import { fmt } from "../../ui";
import { GroupMeetingSeriesDetail } from "./GroupMeetingSeriesDetail";
import { ResourceCapabilities } from "./ResourceCapabilities";

export function GroupMeetingSeriesList({
  groupId,
  actionsRef,
  initialSeriesId,
  initialSeriesTab,
  createAction,
}: {
  groupId: string;
  actionsRef?: MutableRef<ApiTableActions | null>;
  initialSeriesId?: string;
  /** The URL-addressed tab segment for `initialSeriesId`'s detail view. */
  initialSeriesTab?: string;
  createAction?: { label: string; onSelect: () => void; disabled?: boolean };
}) {
  const [, navigate] = usePortalHashLocation();
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(initialSeriesId ?? null);
  const localActions = useRef<ApiTableActions | null>(null);
  const effectiveActions = actionsRef ?? localActions;

  function selectSeries(seriesId: string | null): void {
    setSelectedSeriesId(seriesId);
    navigate(
      seriesId
        ? `/groups/${encodeURIComponent(groupId)}/meetings/${encodeURIComponent(seriesId)}`
        : `/groups/${encodeURIComponent(groupId)}/meetings`,
    );
  }

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
      actionsRef={effectiveActions}
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
        { header: "Profile", cell: (series) => <Badge status={series.profileKey} /> },
        {
          header: "Next",
          cell: (series) => fmt(series.nextOccurrenceAt ?? series.startsAt),
          className: "pk-nowrap",
          sort: { asc: "next_occurrence_at", desc: "-next_occurrence_at", defaultDirection: "asc" },
        },
        {
          // An active series used to be a grey em dash and an inactive one a
          // pill, so the difference between the two was a shape nobody could
          // name and a colour nobody could hear. Both states say their word.
          header: "Status",
          cell: (series) => <Badge status={series.active ? "active" : "inactive"} />,
        },
        { header: "Access", cell: (series) => <ResourceCapabilities capabilities={series.capabilities} /> },
        {
          header: "",
          className: "pk-end",
          cell: (series) => (
            // Both controls name the series they belong to: a page of rows
            // otherwise offers a list of controls all called "Calendar". The
            // visible word leads the accessible name, so speaking it still
            // activates the right one.
            <div class="pk-cluster pk-cluster--end">
              {/* A file to fetch, not an action, so it stays an anchor and
                  merely borrows the button's appearance. */}
              <a
                class="pk-btn pk-btn--secondary pk-btn--sm"
                aria-label={`Calendar for ${series.eventName}`}
                href={`/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(series.id)}/calendar.ics`}
              >
                Calendar
              </a>
              <Button
                size="sm"
                aria-label={`${selectedSeriesId === series.id ? "Hide" : "Details"} for ${series.eventName}`}
                aria-expanded={selectedSeriesId === series.id}
                aria-controls={`meeting-series-detail-${series.id}`}
                onClick={() => selectSeries(selectedSeriesId === series.id ? null : series.id)}
              >
                {selectedSeriesId === series.id ? "Hide" : "Details"}
              </Button>
            </div>
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
      detailRow={(series) =>
        selectedSeriesId === series.id ? (
          <GroupMeetingSeriesDetail
            groupId={groupId}
            series={series}
            initialTab={initialSeriesTab}
            onChanged={() => effectiveActions.current?.reload()}
          />
        ) : null
      }
    />
  );
}
