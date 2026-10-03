import { useEditorFocus } from "./useEditorFocus";
import { useState } from "preact/hooks";
import {
  agendaRoomCreateSchema,
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
export function RoomEditor({
  snapshot,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const [setupMinutes, setSetup] = useState("0");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(agendaRoomCreateSchema, {
    expectedRevision: snapshot.revision,
    name,
    setupMinutes: Number(setupMinutes),
    capacity: capacity ? Number(capacity) : null,
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
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/rooms`,
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
      <PanelHeader title="New location" />
      <PanelBody>
        {error && <ErrorAlert error={error} />}
        <form ref={focus} noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => void save(event)}>
          <Field label="Location name" required {...form.of("name")}>
            {(control) => (
              <TextInput
                {...control}
                name="name"
                value={name}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field
            label="Physical capacity"
            help="Leave empty when a physical limit does not apply."
            {...form.of("capacity")}
          >
            {(control) => (
              <TextInput
                {...control}
                name="capacity"
                type="number"
                value={capacity}
                onInput={(event) => setCapacity(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field
            label="Setup buffer (minutes)"
            help="Time reserved after a session before this room can be reused."
            {...form.of("setupMinutes")}
          >
            {(control) => (
              <TextInput
                {...control}
                name="setupMinutes"
                type="number"
                value={setupMinutes}
                onInput={(event) => setSetup(event.currentTarget.value)}
              />
            )}
          </Field>
          <div class="pk-cluster pk-cluster--end">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Save location
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
