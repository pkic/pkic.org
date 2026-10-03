import { useEditorFocus } from "./useEditorFocus";
import { useState } from "preact/hooks";
import {
  agendaAdmissionPolicySchema,
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaPeopleListSchema,
  agendaSnapshotSchema,
  type AgendaOccurrence,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson, patchJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Select, Textarea } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { UserPicker, type PickedUser } from "../../../../../../components/UserPicker";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";

export function SessionEditor({
  snapshot,
  occurrence,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  occurrence?: AgendaOccurrence;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const [speakers, setSpeakers] = useState(occurrence?.speakers ?? []);
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [title, setTitle] = useState(occurrence?.title ?? "");
  const [description, setDescription] = useState(occurrence?.description ?? "");
  const [start, setStart] = useState(
    occurrence?.startAt ? instantToDateTimeLocal(occurrence.startAt, snapshot.timeZone) : "",
  );
  const [end, setEnd] = useState(occurrence?.endAt ? instantToDateTimeLocal(occurrence.endAt, snapshot.timeZone) : "");
  const [roomId, setRoom] = useState(occurrence?.roomId ?? "");
  const [policy, setPolicy] = useState<AgendaOccurrence["admissionPolicy"]>(
    occurrence?.admissionPolicy ?? "preference",
  );
  const [kind, setKind] = useState(occurrence?.kind ?? "session");
  const [visibility, setVisibility] = useState(occurrence?.visibility ?? "public");
  const [presentationUrl, setPresentation] = useState(occurrence?.presentationUrl ?? "");
  const [recordingUrl, setRecording] = useState(occurrence?.recordingUrl ?? "");
  const [remoteCapacity, setRemoteCapacity] = useState(occurrence?.remoteCapacity?.toString() ?? "");
  const [capacity, setCapacity] = useState(occurrence?.capacity?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function instant(value: string) {
    if (!value) return null;
    try {
      return dateTimeLocalToIso(value, snapshot.timeZone);
    } catch {
      return value;
    }
  }
  const body = {
    speakerUserIds: speakers.map((speaker) => speaker.userId),
    expectedRevision: snapshot.revision,
    title,
    description,
    startAt: instant(start),
    endAt: instant(end),
    roomId: roomId || null,
    admissionPolicy: policy,
    capacity: capacity ? Number(capacity) : null,
    remoteCapacity: remoteCapacity ? Number(remoteCapacity) : null,
    presentationUrl: presentationUrl || null,
    recordingUrl: recordingUrl || null,
    visibility,
    kind,
  };
  const form = useContractForm(occurrence ? agendaOccurrencePatchSchema : agendaOccurrenceCreateSchema, body);
  async function save(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const base = `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/occurrences`;
      const result = occurrence
        ? await patchJson(`${base}/${encodeURIComponent(occurrence.id)}`, checked.data, agendaSnapshotSchema)
        : await postJson(base, checked.data, agendaSnapshotSchema);
      onSaved(result);
      onClose();
    } catch (e) {
      setError(form.refuse(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title={occurrence ? "Edit session" : "New session"}>
        <Button onClick={onClose}>Close</Button>
      </PanelHeader>
      <PanelBody>
        <p class="pk-agenda-editor__notice">
          Times in {snapshot.timeZone}. Leave times and location empty to keep this session in the backlog.
        </p>
        {error && <ErrorAlert error={error} />}
        <form ref={focus} noValidate {...form.handlers} onSubmit={(event) => void save(event)} class="pk-stack">
          <fieldset disabled={busy} class="pk-fieldset pk-agenda-editor__form">
            <div class="pk-agenda-editor__form-wide">
              <Field label="Session title" required {...form.of("title")}>
                {(control) => (
                  <TextInput {...control} name="title" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
                )}
              </Field>
            </div>
            <Field label="Starts" {...form.of("startAt")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="startAt"
                  type="datetime-local"
                  value={start}
                  onInput={(e) => setStart(e.currentTarget.value)}
                />
              )}
            </Field>
            <Field label="Ends" {...form.of("endAt")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="endAt"
                  type="datetime-local"
                  value={end}
                  onInput={(e) => setEnd(e.currentTarget.value)}
                />
              )}
            </Field>
            <Field label="Location" {...form.of("roomId")}>
              {(control) => (
                <Select {...control} name="roomId" value={roomId} onChange={(e) => setRoom(e.currentTarget.value)}>
                  <option value="">Unscheduled</option>
                  {snapshot.rooms.map((room) => (
                    <option value={room.id}>{room.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Admission" {...form.of("admissionPolicy")}>
              {(control) => (
                <Select
                  {...control}
                  name="admissionPolicy"
                  value={policy}
                  onChange={(e) =>
                    setPolicy(agendaOccurrenceCreateSchema.shape.admissionPolicy.parse(e.currentTarget.value))
                  }
                >
                  {agendaAdmissionPolicySchema.options.map((value) => (
                    <option value={value}>
                      {value === "preference"
                        ? "Preference · first come, first served"
                        : value === "reservation"
                          ? "Reservation required"
                          : "Approval required"}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Session type" {...form.of("kind")}>
              {(control) => (
                <Select
                  {...control}
                  name="kind"
                  value={kind}
                  onChange={(event) =>
                    setKind(agendaOccurrenceCreateSchema.shape.kind.unwrap().parse(event.currentTarget.value))
                  }
                >
                  {agendaOccurrenceCreateSchema.shape.kind.unwrap().options.map((value) => (
                    <option value={value}>{value}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Visibility" {...form.of("visibility")}>
              {(control) => (
                <Select
                  {...control}
                  name="visibility"
                  value={visibility}
                  onChange={(event) =>
                    setVisibility(
                      agendaOccurrenceCreateSchema.shape.visibility.unwrap().parse(event.currentTarget.value),
                    )
                  }
                >
                  {agendaOccurrenceCreateSchema.shape.visibility.unwrap().options.map((value) => (
                    <option value={value}>{value}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Physical session capacity"
              help="Leave empty to use the location capacity."
              {...form.of("capacity")}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="capacity"
                  type="number"
                  value={capacity}
                  onInput={(e) => setCapacity(e.currentTarget.value)}
                />
              )}
            </Field>
            <Field
              label="Remote session capacity"
              help="Leave empty for unlimited remote attendance."
              {...form.of("remoteCapacity")}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="remoteCapacity"
                  type="number"
                  value={remoteCapacity}
                  onInput={(event) => setRemoteCapacity(event.currentTarget.value)}
                />
              )}
            </Field>
            <div class="pk-agenda-editor__form-wide">
              <Field label="Add speaker" {...form.of("speakerUserIds")}>
                {(control) => (
                  <UserPicker
                    responseSchema={agendaPeopleListSchema}
                    sort="name"
                    placeholder="Search event people by name…"
                    endpoint={`/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/people`}
                    value={picked}
                    onChange={(person) => {
                      setPicked(person);
                      if (person && !speakers.some((speaker) => speaker.userId === person.id))
                        setSpeakers([
                          ...speakers,
                          {
                            userId: person.id,
                            displayName: [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email,
                          },
                        ]);
                    }}
                    inputProps={{ ...control, name: "speakerUserIds" }}
                  />
                )}
              </Field>
              <div class="pk-cluster">
                {speakers.map((speaker) => (
                  <Button
                    size="sm"
                    aria-label={`Remove speaker ${speaker.displayName}`}
                    onClick={() => setSpeakers(speakers.filter((value) => value.userId !== speaker.userId))}
                  >
                    {speaker.displayName} ×
                  </Button>
                ))}
              </div>
            </div>
            <div class="pk-agenda-editor__form-wide">
              <Field label="Description" {...form.of("description")}>
                {(control) => (
                  <Textarea
                    {...control}
                    name="description"
                    value={description}
                    onInput={(e) => setDescription(e.currentTarget.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="Slides URL" {...form.of("presentationUrl")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="presentationUrl"
                  value={presentationUrl}
                  onInput={(event) => setPresentation(event.currentTarget.value)}
                />
              )}
            </Field>
            <Field label="Recording URL" {...form.of("recordingUrl")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="recordingUrl"
                  value={recordingUrl}
                  onInput={(event) => setRecording(event.currentTarget.value)}
                />
              )}
            </Field>
          </fieldset>
          <div class="pk-cluster pk-cluster--end">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving…" : "Save session"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
