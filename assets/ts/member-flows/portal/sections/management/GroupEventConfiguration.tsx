/**
 * The registration setup for one event, as four disclosures.
 *
 * `<details>` is kept rather than rebuilt: it is already a disclosure the
 * keyboard and a screen reader both understand, so it needs no role, no
 * handler and no state. Each one sits in its own Panel, so the rule the
 * Bootstrap version drew with `border-top` is the panel's own edge and the
 * margin under each card is the stack's gap.
 */
import { useEffect, useState } from "preact/hooks";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { Panel, PanelBody } from "../../../../ui/Panel";
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
    <section class="pk pk-stack" aria-label={`Configure ${event.name} registration`}>
      <h6>Registration setup</h6>
      <p class="pk-small">
        Configure the registration policy, optional custom questions, required terms, and per-day attendance choices.
      </p>
      <Panel>
        <PanelBody>
          <details open>
            <summary class="pk-strong">Terms and conditions</summary>
            <div class="pk-stack">
              <EventTermsEditor
                groupId={groupId}
                event={event}
                expectedUpdatedAt={updatedAt}
                onRevision={recordRevision}
              />
            </div>
          </details>
        </PanelBody>
      </Panel>
      <Panel>
        <PanelBody>
          <details open>
            <summary class="pk-strong">Policy and registration questions</summary>
            <div class="pk-stack">
              <EventRegistrationSettingsEditor
                groupId={groupId}
                eventId={event.id}
                expectedUpdatedAt={updatedAt}
                onRevision={recordRevision}
                showFormConfiguration={canConfigureForms}
              />
            </div>
          </details>
        </PanelBody>
      </Panel>
      {canConfigureForms && (
        <Panel>
          <PanelBody>
            <details>
              <summary class="pk-strong">Proposal submission questions</summary>
              <div class="pk-stack">
                <p class="pk-small">
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
          </PanelBody>
        </Panel>
      )}
      <Panel>
        <PanelBody>
          <details>
            <summary class="pk-strong">Attendance days</summary>
            <div class="pk-stack">
              <EventDaysEditor
                groupId={groupId}
                event={event}
                expectedUpdatedAt={updatedAt}
                onRevision={recordRevision}
              />
            </div>
          </details>
        </PanelBody>
      </Panel>
    </section>
  );
}
