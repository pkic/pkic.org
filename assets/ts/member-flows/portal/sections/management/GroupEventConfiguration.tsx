/**
 * The registration setup for one event: four panels, each a named region
 * with the editor it holds.
 *
 * They were four `<details>` disclosures under a sixth-level heading and a
 * sentence explaining the tab; two opened by default and two did not, so the
 * attendance days — the setting a manager most often comes here to change —
 * were folded away on arrival. A settings page shows what is set; the form
 * that changes it opens behind each panel's own Edit.
 */
import { useEffect, useState } from "preact/hooks";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
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
      <Panel aria-label="Terms and conditions">
        <PanelHeader title="Terms and conditions" />
        <PanelBody>
          <EventTermsEditor groupId={groupId} event={event} expectedUpdatedAt={updatedAt} onRevision={recordRevision} />
        </PanelBody>
      </Panel>
      <Panel aria-label="Registration policy and questions">
        <PanelHeader title="Registration policy and questions" />
        <PanelBody>
          <EventRegistrationSettingsEditor
            groupId={groupId}
            eventId={event.id}
            expectedUpdatedAt={updatedAt}
            onRevision={recordRevision}
            showFormConfiguration={canConfigureForms}
          />
        </PanelBody>
      </Panel>
      {canConfigureForms && (
        <Panel aria-label="Proposal submission questions">
          <PanelHeader title="Proposal submission questions" />
          <PanelBody class="pk-stack">
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
          </PanelBody>
        </Panel>
      )}
      <Panel aria-label="Attendance days">
        <PanelHeader title="Attendance days" />
        <PanelBody>
          <EventDaysEditor groupId={groupId} event={event} expectedUpdatedAt={updatedAt} onRevision={recordRevision} />
        </PanelBody>
      </Panel>
    </section>
  );
}
