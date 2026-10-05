import { LazyAgendaConflictDetails } from "./LazyAgendaConflictDetails";
import { agendaConflictDetails } from "./agenda-conflict-details";
import { agendaMovedAdditionalRoomIds, agendaMovedSpeakers } from "../../../../../../../shared/event-agenda-rooms";
import { SessionDemand } from "./SessionDemand";
import { useEditorFocus } from "./useEditorFocus";
import { useRef, useState } from "preact/hooks";
import {
  agendaAdmissionPolicySchema,
  agendaCreditRoleSchema,
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
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { UserPicker, type PickedUser } from "../../../../../../components/UserPicker";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { RowActions, type RowActionsProps } from "../../../../../../ui/RowActions";

export function SessionEditor({
  snapshot,
  occurrence,
  onSaved,
  onClose,
  actions,
}: {
  actions?: (close: () => void) => RowActionsProps["actions"];
  snapshot: AgendaSnapshot;
  occurrence?: AgendaOccurrence;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const [speakers, setSpeakers] = useState(occurrence?.speakers ?? []);
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [title, setTitle] = useState(occurrence?.title ?? "");
  const [track, setTrack] = useState(occurrence?.track ?? "");
  const [description, setDescription] = useState(occurrence?.description ?? "");
  const [start, setStart] = useState(
    occurrence?.startAt ? instantToDateTimeLocal(occurrence.startAt, snapshot.timeZone) : "",
  );
  const [end, setEnd] = useState(occurrence?.endAt ? instantToDateTimeLocal(occurrence.endAt, snapshot.timeZone) : "");
  const [roomId, setRoom] = useState(occurrence?.roomId ?? "");
  const [additionalRoomIds, setAdditionalRooms] = useState(occurrence?.additionalRoomIds ?? []);
  const [policy, setPolicy] = useState<AgendaOccurrence["admissionPolicy"]>(
    occurrence?.admissionPolicy ?? "preference",
  );
  const [kind, setKind] = useState(occurrence?.kind ?? "session");
  const [visibility, setVisibility] = useState(occurrence?.visibility ?? "public");
  const [presentationUrl, setPresentation] = useState(occurrence?.presentationUrl ?? "");
  const [recordingUrl, setRecording] = useState(occurrence?.recordingUrl ?? "");
  const [remoteCapacity, setRemoteCapacity] = useState(occurrence?.remoteCapacity?.toString() ?? "");
  const [capacity, setCapacity] = useState(occurrence?.capacity?.toString() ?? "");
  const [requiredEquipment, setRequiredEquipment] = useState((occurrence?.requiredEquipment ?? []).join(", "));
  const [accessPolicy, setAccessPolicy] = useState(occurrence?.accessPolicy ?? "open");
  const [bookingOpensAt, setBookingOpensAt] = useState(
    occurrence?.bookingOpensAt ? instantToDateTimeLocal(occurrence.bookingOpensAt, snapshot.timeZone) : "",
  );
  const [bookingClosesAt, setBookingClosesAt] = useState(
    occurrence?.bookingClosesAt ? instantToDateTimeLocal(occurrence.bookingClosesAt, snapshot.timeZone) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<ReturnType<typeof agendaConflictDetails>>(null);
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
    speakerRoles: Object.fromEntries(speakers.map((speaker) => [speaker.userId, speaker.role ?? "speaker"])),
    speakerPlacements: Object.fromEntries(
      speakers.map((speaker) => [
        speaker.userId,
        {
          attendanceMode: speaker.attendanceMode ?? "physical",
          roomId: speaker.attendanceMode === "remote" ? null : (speaker.roomId ?? null),
        },
      ]),
    ),
    expectedRevision: snapshot.revision,
    title,
    track: track || null,
    description,
    startAt: instant(start),
    endAt: instant(end),
    roomId: roomId || null,
    additionalRoomIds: roomId ? additionalRoomIds.filter((id) => id !== roomId) : [],
    requiredEquipment: requiredEquipment
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    admissionPolicy: policy,
    accessPolicy,
    bookingOpensAt: instant(bookingOpensAt),
    bookingClosesAt: instant(bookingClosesAt),
    capacity: capacity ? Number(capacity) : null,
    remoteCapacity: remoteCapacity ? Number(remoteCapacity) : null,
    presentationUrl: presentationUrl || null,
    recordingUrl: recordingUrl || null,
    visibility,
    kind,
  };
  const form = useContractForm(occurrence ? agendaOccurrencePatchSchema : agendaOccurrenceCreateSchema, body);
  const initialBody = useRef(JSON.stringify(body));
  const dirty = JSON.stringify(body) !== initialBody.current;
  async function save(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    setConflicts(null);
    try {
      const base = `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/occurrences`;
      const result = occurrence
        ? await patchJson(`${base}/${encodeURIComponent(occurrence.id)}`, checked.data, agendaSnapshotSchema)
        : await postJson(base, checked.data, agendaSnapshotSchema);
      onSaved(result);
      onClose();
    } catch (e) {
      setError(form.refuse(e));
      setConflicts(agendaConflictDetails(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title={occurrence ? "Edit session" : "New session"}>
        {occurrence && actions && (
          <RowActions
            subject={occurrence.title}
            actions={actions(onClose).map((action) => ({ ...action, disabled: busy || dirty || action.disabled }))}
          />
        )}
        <Button onClick={onClose}>Close</Button>
      </PanelHeader>
      <PanelBody>
        {actions && dirty && <p class="pk-muted">Save or cancel your changes before using session actions.</p>}
        <p class="pk-agenda-editor__notice">
          Times in {snapshot.timeZone}. Leave times and location empty to keep this session in the backlog.
        </p>
        {occurrence && <SessionDemand slug={snapshot.eventSlug} occurrenceId={occurrence.id} />}
        {error && <ErrorAlert error={error} />}
        {conflicts && <LazyAgendaConflictDetails details={conflicts} snapshot={snapshot} />}
        <form ref={focus} noValidate {...form.handlers} onSubmit={(event) => void save(event)} class="pk-stack">
          <fieldset disabled={busy} class="pk-fieldset pk-agenda-editor__form">
            <div class="pk-agenda-editor__form-wide">
              <Field label="Session title" required {...form.of("title")}>
                {(control) => (
                  <TextInput {...control} name="title" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
                )}
              </Field>
            </div>
            <Field
              label="Track"
              help="Optional program grouping, separate from the session type and location."
              {...form.of("track")}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="track"
                  value={track}
                  onInput={(event) => setTrack(event.currentTarget.value)}
                />
              )}
            </Field>
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
                <Select
                  {...control}
                  name="roomId"
                  value={roomId}
                  onChange={(e) => {
                    const next = e.currentTarget.value;
                    setAdditionalRooms(
                      agendaMovedAdditionalRoomIds({ roomId: roomId || null, additionalRoomIds }, next || null),
                    );
                    setSpeakers(agendaMovedSpeakers({ roomId: roomId || null, speakers }, next || null));
                    setRoom(next);
                  }}
                >
                  <option value="">Unscheduled</option>
                  {snapshot.rooms.map((room) => (
                    <option value={room.id}>{room.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            {roomId && snapshot.rooms.length > 1 && (
              <div class="pk-agenda-editor__form-wide">
                <Field
                  label="Additional locations"
                  help="Reserve every room used by this session. Attendees choose a location when booking."
                  {...form.of("additionalRoomIds")}
                >
                  {(control) => (
                    <div
                      class="pk-stack"
                      role="group"
                      aria-label="Additional locations"
                      aria-describedby={control["aria-describedby"]}
                    >
                      {snapshot.rooms
                        .filter((room) => room.id !== roomId)
                        .map((room) => (
                          <Checkbox
                            key={room.id}
                            name="additionalRoomIds"
                            value={room.id}
                            label={room.name}
                            checked={additionalRoomIds.includes(room.id)}
                            onChange={(event) =>
                              setAdditionalRooms(
                                event.currentTarget.checked
                                  ? [...additionalRoomIds, room.id]
                                  : additionalRoomIds.filter((id) => id !== room.id),
                              )
                            }
                          />
                        ))}
                    </div>
                  )}
                </Field>
              </div>
            )}
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
            <Field label="Session access" {...form.of("accessPolicy")}>
              {(control) => (
                <Select
                  {...control}
                  value={accessPolicy}
                  onChange={(e) =>
                    setAccessPolicy(
                      agendaOccurrenceCreateSchema.shape.accessPolicy.unwrap().parse(e.currentTarget.value),
                    )
                  }
                >
                  {agendaOccurrenceCreateSchema.shape.accessPolicy.unwrap().options.map((value) => (
                    <option value={value}>
                      {value === "open" ? "Open to registered attendees" : "Invitation only"}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Booking opens" help={`Optional; ${snapshot.timeZone}.`} {...form.of("bookingOpensAt")}>
              {(control) => (
                <TextInput
                  {...control}
                  type="datetime-local"
                  value={bookingOpensAt}
                  onInput={(e) => setBookingOpensAt(e.currentTarget.value)}
                />
              )}
            </Field>
            <Field label="Booking closes" help={`Optional; ${snapshot.timeZone}.`} {...form.of("bookingClosesAt")}>
              {(control) => (
                <TextInput
                  {...control}
                  type="datetime-local"
                  value={bookingClosesAt}
                  onInput={(e) => setBookingClosesAt(e.currentTarget.value)}
                />
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
                  <div class="pk-stack">
                    <Button
                      size="sm"
                      aria-label={`Remove speaker ${speaker.displayName}`}
                      onClick={() => setSpeakers(speakers.filter((value) => value.userId !== speaker.userId))}
                    >
                      {speaker.displayName} ×
                    </Button>
                    <Select
                      aria-label={`Credit for ${speaker.displayName}`}
                      value={speaker.role ?? "speaker"}
                      onChange={(event) =>
                        setSpeakers(
                          speakers.map((value) =>
                            value.userId === speaker.userId
                              ? { ...value, role: agendaCreditRoleSchema.parse(event.currentTarget.value) }
                              : value,
                          ),
                        )
                      }
                    >
                      {agendaCreditRoleSchema.options.map((role) => (
                        <option value={role}>{role.replaceAll("_", " ")}</option>
                      ))}
                    </Select>
                    <Select
                      aria-label={`Attendance for ${speaker.displayName}`}
                      value={speaker.attendanceMode ?? "physical"}
                      onChange={(event) =>
                        setSpeakers(
                          speakers.map((value) =>
                            value.userId === speaker.userId
                              ? {
                                  ...value,
                                  attendanceMode: event.currentTarget.value === "remote" ? "remote" : "physical",
                                  roomId: null,
                                }
                              : value,
                          ),
                        )
                      }
                    >
                      <option value="physical">In person</option>
                      <option value="remote">Remote</option>
                    </Select>
                    {(speaker.attendanceMode ?? "physical") === "physical" && (
                      <Select
                        aria-label={`Location for ${speaker.displayName}`}
                        value={speaker.roomId ?? ""}
                        onChange={(event) =>
                          setSpeakers(
                            speakers.map((value) =>
                              value.userId === speaker.userId
                                ? { ...value, roomId: event.currentTarget.value || null }
                                : value,
                            ),
                          )
                        }
                      >
                        <option value="">
                          {additionalRoomIds.length ? "Choose one location" : "Follow session location"}
                        </option>
                        {snapshot.rooms
                          .filter((room) => room.id === roomId || additionalRoomIds.includes(room.id))
                          .map((room) => (
                            <option value={room.id}>{room.name}</option>
                          ))}
                      </Select>
                    )}
                  </div>
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
          <Field
            label="Required equipment"
            help="Separate items with commas. Moving this session checks that the location provides every item."
            {...form.of("requiredEquipment")}
          >
            {(control) => (
              <TextInput
                {...control}
                name="requiredEquipment"
                value={requiredEquipment}
                onInput={(event) => setRequiredEquipment(event.currentTarget.value)}
              />
            )}
          </Field>
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
