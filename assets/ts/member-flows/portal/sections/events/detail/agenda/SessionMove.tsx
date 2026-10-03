import { useEditorFocus } from "./useEditorFocus";
import { useState } from "preact/hooks";
import {
  agendaOccurrencePatchSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
  type AgendaOccurrence,
} from "../../../../../../../shared/schemas/event-agenda";
import { instantToDateTimeLocal, dateTimeLocalToIso } from "../../../../../../../shared/timezone";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { patchJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
export function SessionMove({
  snapshot,
  session,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  session: AgendaOccurrence;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const [start, setStart] = useState(session.startAt ? instantToDateTimeLocal(session.startAt, snapshot.timeZone) : "");
  const [room, setRoom] = useState(session.roomId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const duration = session.startAt && session.endAt ? Date.parse(session.endAt) - Date.parse(session.startAt) : 1800000;
  let startAt = "";
  let endAt = "";
  try {
    if (start) {
      startAt = dateTimeLocalToIso(start, snapshot.timeZone);
      endAt = new Date(Date.parse(startAt) + duration).toISOString();
    }
  } catch {
    startAt = start;
    endAt = start;
  }
  const form = useContractForm(agendaOccurrencePatchSchema, {
    expectedRevision: snapshot.revision,
    startAt,
    endAt,
    roomId: room,
  });
  async function move(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    try {
      onSaved(
        await patchJson(
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/occurrences/${encodeURIComponent(session.id)}`,
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
      <PanelHeader title={`Move ${session.title}`} />
      <PanelBody>
        <p>
          Choose any day, start time, and location. This session keeps its {duration / 60000}-minute duration. Times in{" "}
          {snapshot.timeZone}.
        </p>
        {error && <ErrorAlert error={error} />}
        <form ref={focus} noValidate {...form.handlers} onSubmit={(event) => void move(event)} class="pk-stack">
          <Field label="New day and start time" required {...form.of("startAt")}>
            {(control) => (
              <TextInput
                {...control}
                name="startAt"
                type="datetime-local"
                value={start}
                onInput={(event) => setStart(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="New location" required {...form.of("roomId")}>
            {(control) => (
              <Select {...control} name="roomId" value={room} onChange={(event) => setRoom(event.currentTarget.value)}>
                <option value="">Choose a location</option>
                {snapshot.rooms.map((value) => (
                  <option value={value.id}>{value.name}</option>
                ))}
              </Select>
            )}
          </Field>
          <div class="pk-cluster pk-cluster--end">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Move session
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
