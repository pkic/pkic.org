import { useEditorFocus } from "./useEditorFocus";
import { useState } from "preact/hooks";
import {
  agendaSettingsSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
export function AgendaSettings({
  snapshot,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const [travel, setTravel] = useState(snapshot.travelMinutes.toString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(agendaSettingsSchema, {
    expectedRevision: snapshot.revision,
    travelMinutes: Number(travel),
  });
  async function save(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    try {
      onSaved(
        await postJson(
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/settings`,
          checked.data,
          agendaSnapshotSchema,
        ),
      );
      onClose();
    } catch (e) {
      setError(form.refuse(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title="Scheduling rules" />
      <PanelBody>
        {error && <ErrorAlert error={error} />}
        <form ref={focus} noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => void save(event)}>
          <Field
            label="Travel buffer between locations (minutes)"
            help="Speakers and assigned staff need this time when moving between rooms."
            {...form.of("travelMinutes")}
          >
            {(control) => (
              <TextInput
                {...control}
                name="travelMinutes"
                type="number"
                value={travel}
                onInput={(event) => setTravel(event.currentTarget.value)}
              />
            )}
          </Field>
          <div class="pk-cluster pk-cluster--end">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Save rules
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
