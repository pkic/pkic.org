import { useState } from "preact/hooks";
import { eventSeriesListResponseSchema, type EventSeries } from "../../../../shared/schemas/event-series";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Pager } from "../../../components/Pager";
import { Spinner } from "../../../components/Spinner";
import { useApiPage } from "../../../hooks/useApiPage";
import { fmt } from "../ui";

function MeetingSeriesCard({ groupId, series }: { groupId: string; series: EventSeries }) {
  const next = series.nextOccurrenceAt ?? series.startsAt;
  return (
    <div class="border rounded p-3 d-flex flex-wrap align-items-start justify-content-between gap-3">
      <div>
        <div class="d-flex flex-wrap align-items-center gap-2">
          <span class="fw-semibold">{series.eventName}</span>
          <span class="badge text-bg-secondary">{series.profileKey.replaceAll("_", " ")}</span>
          {!series.active && <span class="badge text-bg-warning">Inactive</span>}
        </div>
        <div class="small text-muted mt-1">
          Next: {fmt(next)} · {series.timezone} · {series.durationMinutes} minutes
        </div>
        {series.location && <div class="small text-muted">{series.location}</div>}
      </div>
      <a
        class="btn btn-sm btn-outline-secondary"
        href={`/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(series.id)}/calendar.ics`}
      >
        Download calendar
      </a>
    </div>
  );
}

export function GroupMeetingSeriesList({ groupId }: { groupId: string }) {
  const [pendingSearch, setPendingSearch] = useState("");
  const [search, setSearch] = useState("");
  const page = useApiPage(
    `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series`,
    { active: "true", sort: "next_occurrence_at", ...(search ? { q: search } : {}) },
    eventSeriesListResponseSchema,
    (data) => data.series,
    25,
  );

  if (!page.data && page.loading) return <Spinner />;

  return (
    <div class="d-flex flex-column gap-3">
      <form
        class="d-flex gap-2 portal-management-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(pendingSearch.trim());
        }}
      >
        <label class="visually-hidden" for="group-meeting-search">
          Search meeting series
        </label>
        <input
          id="group-meeting-search"
          type="search"
          class="form-control"
          placeholder="Search meeting name or location…"
          value={pendingSearch}
          onInput={(event) => setPendingSearch((event.target as HTMLInputElement).value)}
        />
        <button type="submit" class="btn btn-outline-secondary">
          Search
        </button>
      </form>
      {page.error && <ErrorAlert error={page.error.message} />}
      {page.data?.series.length === 0 ? (
        <p class="text-muted mb-0">No matching active meeting series.</p>
      ) : (
        <div class="d-flex flex-column gap-2">
          {page.data?.series.map((series) => (
            <MeetingSeriesCard key={series.id} groupId={groupId} series={series} />
          ))}
        </div>
      )}
      {page.pagerProps && <Pager {...page.pagerProps} />}
    </div>
  );
}
