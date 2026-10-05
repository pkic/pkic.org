import { AgendaSchedulePreview } from "./AgendaSchedulePreview";
import { scheduleSwap } from "./schedule-proposals";
import {
  agendaScheduleSwapSelectionSchema,
  type AgendaScheduleProposal,
} from "../../../../../../../shared/schemas/event-agenda-schedule";
import { useEditorFocus } from "./useEditorFocus";
import { useState } from "preact/hooks";
import { type AgendaSnapshot, type AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
export function SessionSwap({
  snapshot,
  first,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  first: AgendaOccurrence;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const [secondId, setSecond] = useState("");
  const [proposal, setProposal] = useState<AgendaScheduleProposal | null>(null);
  const [error, setError] = useState("");
  const form = useContractForm(agendaScheduleSwapSelectionSchema, {
    expectedRevision: snapshot.revision,
    firstId: first.id,
    secondId,
  });
  async function swap(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    const second = snapshot.occurrences.find((item) => item.id === checked.data.secondId);
    if (second) setProposal(scheduleSwap(snapshot, first, second));
  }
  if (proposal)
    return (
      <AgendaSchedulePreview
        snapshot={snapshot}
        proposal={proposal}
        onSaved={onSaved}
        onClose={() => {
          setProposal(null);
          onClose();
        }}
      />
    );
  return (
    <Panel>
      <PanelHeader title={`Swap ${first.title}`} />
      <PanelBody>
        <p>Exchange start time and location. Each session keeps its duration. Both moves must pass conflict checks.</p>
        {error && <ErrorAlert error={error} />}
        <form ref={focus} noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => void swap(event)}>
          <Field label="Swap with session" required {...form.of("secondId")}>
            {(control) => (
              <Select
                {...control}
                name="secondId"
                value={secondId}
                onChange={(event) => setSecond(event.currentTarget.value)}
              >
                <option value="">Choose a session</option>
                {snapshot.occurrences
                  .filter((value) => value.id !== first.id && value.startAt && value.endAt)
                  .map((value) => (
                    <option value={value.id}>{value.title}</option>
                  ))}
              </Select>
            )}
          </Field>
          <div class="pk-cluster pk-cluster--end">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary">
              Review swap
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
