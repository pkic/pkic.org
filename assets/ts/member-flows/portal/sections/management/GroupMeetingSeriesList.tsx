import { useRef, useState, type MutableRef } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { eventSeriesListResponseSchema } from "../../../../../shared/schemas/event-series";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
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
            <div>
              <div class="fw-semibold">{series.eventName}</div>
              {series.location && <div class="small text-muted">{series.location}</div>}
            </div>
          ),
          sort: { asc: "event_name", desc: "-event_name" },
        },
        { header: "Profile", cell: (series) => <Badge status={series.profileKey} /> },
        {
          header: "Next",
          cell: (series) => fmt(series.nextOccurrenceAt ?? series.startsAt),
          className: "text-nowrap",
          sort: { asc: "next_occurrence_at", desc: "-next_occurrence_at", defaultDirection: "asc" },
        },
        {
          header: "Status",
          cell: (series) => (series.active ? <span class="text-muted">—</span> : <Badge status="inactive" />),
        },
        { header: "Access", cell: (series) => <ResourceCapabilities capabilities={series.capabilities} /> },
        {
          header: "",
          className: "text-end",
          cell: (series) => (
            <div class="d-flex justify-content-end gap-2">
              <a
                class="btn btn-sm btn-outline-secondary"
                href={`/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(series.id)}/calendar.ics`}
              >
                Calendar
              </a>
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                aria-expanded={selectedSeriesId === series.id}
                aria-controls={`meeting-series-detail-${series.id}`}
                onClick={() => selectSeries(selectedSeriesId === series.id ? null : series.id)}
              >
                {selectedSeriesId === series.id ? "Hide" : "Details"}
              </button>
            </div>
          ),
        },
      ]}
      empty={
        createAction ? (
          <EmptyState
            title="No meeting series yet"
            body="Create a meeting series to get started."
            action={createAction}
          />
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
