import { Alert } from "../../../../../../ui/Alert";
import { ButtonLink } from "../../../../../../ui/Button";
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
    <div class="pk">
      <Alert tone="info">
        <div class="pk-stack pk-stack--snug">
          <p>
            This event is managed by a meeting series. Its schedule, registration policy, terms, questions, and
            attendance days are configured on the meeting series, not here.
          </p>
          {ownerGroupId && seriesId ? (
            // A link, not a Button: this navigates, so it must be openable in
            // a new tab and say where it goes.
            <div class="pk-cluster">
              <ButtonLink
                size="sm"
                href={`#/groups/${encodeURIComponent(ownerGroupId)}/meetings/${encodeURIComponent(seriesId)}`}
              >
                Open meeting series <span aria-hidden="true">→</span>
              </ButtonLink>
            </div>
          ) : (
            // The italic that used to carry "this is an aside" is gone: the
            // sentence says what happened, and the smaller size is the whole
            // of the emphasis the system offers for it.
            <p class="pk-small">The owning group for this meeting series could not be determined.</p>
          )}
        </div>
      </Alert>
    </div>
  );
}
