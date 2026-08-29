import { useEffect, useState } from "preact/hooks";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { EventDaysEditor } from "./EventDaysEditor";
import { EventFormPlacementEditor } from "./EventFormPlacementEditor";
import { EventRegistrationSettingsEditor } from "./EventRegistrationSettingsEditor";
import { EventTermsEditor } from "./EventTermsEditor";

export function GroupEventConfiguration({
  event,
  groupId,
  onUpdated,
}: {
  event: GroupEvent;
  groupId: string;
  onUpdated?: () => void | Promise<void>;
}) {
  const [updatedAt, setUpdatedAt] = useState(event.updatedAt);
  useEffect(() => setUpdatedAt(event.updatedAt), [event.id, event.updatedAt]);
  const recordRevision = (nextUpdatedAt: string) => {
    setUpdatedAt(nextUpdatedAt);
    void onUpdated?.();
  };
  const canConfigureForms = event.sourceMode === "portal";

  return (
    <section class="border-top pt-3" aria-label={`Configure ${event.name} registration`}>
      <h6>Registration setup</h6>
      <p class="small text-muted">
        Configure the registration policy, optional custom questions, required terms, and per-day attendance choices.
      </p>
      <details class="card mb-3" open>
        <summary class="card-header fw-semibold">Terms and conditions</summary>
        <div class="card-body">
          <EventTermsEditor groupId={groupId} event={event} expectedUpdatedAt={updatedAt} onRevision={recordRevision} />
        </div>
      </details>
      <details class="card mb-3" open>
        <summary class="card-header fw-semibold">Policy and registration questions</summary>
        <div class="card-body">
          <EventRegistrationSettingsEditor
            groupId={groupId}
            eventId={event.id}
            expectedUpdatedAt={updatedAt}
            onRevision={recordRevision}
            showFormConfiguration={canConfigureForms}
          />
        </div>
      </details>
      {canConfigureForms && (
        <details class="card mb-3">
          <summary class="card-header fw-semibold">Proposal submission questions</summary>
          <div class="card-body">
            <p class="small text-muted">
              Select or create the questions speakers answer when submitting a proposal for this event.
            </p>
            <EventFormPlacementEditor
              groupId={groupId}
              eventId={event.id}
              purpose="proposal_submission"
              expectedUpdatedAt={updatedAt}
              onRevision={recordRevision}
            />
          </div>
        </details>
      )}
      <details class="card mb-3">
        <summary class="card-header fw-semibold">Attendance days</summary>
        <div class="card-body">
          <EventDaysEditor groupId={groupId} event={event} expectedUpdatedAt={updatedAt} onRevision={recordRevision} />
        </div>
      </details>
    </section>
  );
}
