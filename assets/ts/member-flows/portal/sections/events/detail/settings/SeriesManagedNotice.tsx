import type { EventDetail } from "../../types";

/**
 * Meeting-series events store their schedule, registration policy, terms,
 * questions, and attendance days on the owning meeting series, not on the
 * event's own direct-configuration endpoints. Those endpoints reject writes
 * for a series-managed event (`EVENT_MANAGED_BY_MEETING_SERIES`), so this
 * notice replaces the direct-configuration form instead of letting it render
 * fields that cannot be saved.
 */
export function SeriesManagedNotice({ event }: { event: Pick<EventDetail, "ownerGroupId" | "seriesId"> }) {
  const { ownerGroupId, seriesId } = event;
  return (
    <div class="alert alert-info mb-0">
      <p class="mb-2">
        This event is managed by a meeting series. Its schedule, registration policy, terms, questions, and attendance
        days are configured on the meeting series, not here.
      </p>
      {ownerGroupId && seriesId ? (
        <a
          class="btn btn-sm btn-outline-primary"
          href={`#/groups/${encodeURIComponent(ownerGroupId)}/meetings/${encodeURIComponent(seriesId)}`}
        >
          Open meeting series →
        </a>
      ) : (
        <p class="mb-0 small fst-italic">The owning group for this meeting series could not be determined.</p>
      )}
    </div>
  );
}
