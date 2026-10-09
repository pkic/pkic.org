import { SessionSpeakerFields } from "./SessionSpeakerFields";
import { SessionScheduleFields } from "./SessionScheduleFields";
import { SessionParticipationFields, type SessionParticipationDraft } from "./SessionParticipationFields";
import { SessionTypeFields } from "./SessionTypeFields";
import { SessionSlidesStatus } from "./SessionSlidesStatus";
import { AgendaSponsorFields } from "./AgendaSponsorFields";
import { TabList } from "../../../../../../ui/TabList";
import { SessionMediaFields } from "./SessionMediaFields";
import { LazyAgendaConflictDetails } from "./LazyAgendaConflictDetails";
import { agendaConflictDetails } from "./agenda-conflict-details";
import { agendaMovedSpeakers } from "../../../../../../../shared/event-agenda-rooms";
import {
  agendaMediaCapabilities,
  agendaOccurrenceMedia,
  withoutAgendaMediaEquipment,
} from "../../../../../../../shared/event-agenda-media";
import { withinAgendaEventWindow } from "../../../../../../../shared/event-agenda-event-window";
import { useEditorFocus } from "./useEditorFocus";
import { useRef, useState } from "preact/hooks";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaPeopleListSchema,
  agendaSnapshotSchema,
  type AgendaOccurrence,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useFormTabs } from "../../../../../../hooks/useFormTabs";
import { postJson, patchJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Select } from "../../../../../../ui/TextControl";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { UserPicker, type PickedUser } from "../../../../../../components/UserPicker";
import { MarkdownEditor } from "../../../../../../components/markdown-editor/MarkdownInput";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { RowActions, type RowActionsProps } from "../../../../../../ui/RowActions";

export function SessionEditor({
  snapshot,
  occurrence,
  initialSchedule,
  onSaved,
  onClose,
  onManageSlides,
  actions,
  dialog = false,
  onBusy,
}: {
  actions?: (close: () => void) => RowActionsProps["actions"];
  dialog?: boolean;
  onBusy?: (busy: boolean) => void;
  snapshot: AgendaSnapshot;
  occurrence?: AgendaOccurrence;
  initialSchedule?: Pick<AgendaOccurrence, "startAt" | "endAt" | "roomId">;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
  /** Opens the session's materials, where slides are uploaded and released. */
  onManageSlides?: (occurrence: AgendaOccurrence) => void;
}) {
  const focus = useEditorFocus();
  const [speakers, setSpeakers] = useState(occurrence?.speakers ?? []);
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [title, setTitle] = useState(occurrence?.title ?? "");
  const [track, setTrack] = useState(occurrence?.track ?? "");
  const [format, setFormat] = useState(occurrence?.format ?? "");
  const [placeholder, setPlaceholder] = useState(occurrence?.placeholder ?? false);
  const [description, setDescription] = useState(occurrence?.description ?? "");
  const initialStart = occurrence ? occurrence.startAt : initialSchedule?.startAt;
  const initialEnd = occurrence ? occurrence.endAt : initialSchedule?.endAt;
  const [start, setStart] = useState(initialStart ? instantToDateTimeLocal(initialStart, snapshot.timeZone) : "");
  const [end, setEnd] = useState(initialEnd ? instantToDateTimeLocal(initialEnd, snapshot.timeZone) : "");
  const [roomId, setRoom] = useState(occurrence?.roomId ?? initialSchedule?.roomId ?? "");
  const [additionalRoomIds, setAdditionalRooms] = useState(occurrence?.additionalRoomIds ?? []);
  const [kind, setKind] = useState(occurrence?.kind ?? "session");
  const [sponsorIds, setSponsorIds] = useState(occurrence?.sponsorIds ?? []);
  const [visibility, setVisibility] = useState(occurrence?.visibility ?? "public");
  const [recordingUrl, setRecording] = useState(occurrence?.recordingUrl ?? "");
  const [equipment, setEquipment] = useState(withoutAgendaMediaEquipment(occurrence?.requiredEquipment).join(", "));
  // Media keys once stored among required equipment are an explicit session plan.
  const storedMedia = agendaMediaCapabilities(occurrence?.requiredEquipment);
  const storedOverride = storedMedia.recording || storedMedia.liveStreaming;
  const [mediaOverride, setMediaOverride] = useState(
    occurrence?.plannedMedia != null || Boolean(occurrence?.virtualRoomUrl) || storedOverride,
  );
  const [media, setMedia] = useState(() => {
    const effective = agendaOccurrenceMedia(snapshot.rooms, occurrence ?? { roomId: roomId || null });
    return storedOverride && occurrence?.plannedMedia == null
      ? storedMedia
      : { recording: effective.recording, liveStreaming: effective.liveStreaming };
  });
  const [virtualRoomUrl, setVirtualRoomUrl] = useState(occurrence?.virtualRoomUrl ?? "");
  const [participation, setParticipation] = useState<SessionParticipationDraft>(() => ({
    policy: occurrence?.admissionPolicy ?? "preference",
    accessPolicy: occurrence?.accessPolicy ?? "open",
    capacity: occurrence?.capacity?.toString() ?? "",
    remoteCapacity: occurrence?.remoteCapacity?.toString() ?? "",
    bookingOpensAt: occurrence?.bookingOpensAt
      ? instantToDateTimeLocal(occurrence.bookingOpensAt, snapshot.timeZone)
      : "",
    bookingClosesAt: occurrence?.bookingClosesAt
      ? instantToDateTimeLocal(occurrence.bookingClosesAt, snapshot.timeZone)
      : "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<ReturnType<typeof agendaConflictDetails>>(null);
  const room = snapshot.rooms.find((candidate) => candidate.id === roomId);
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
    format: kind === "break" ? null : format || null,
    placeholder: kind !== "break" && placeholder,
    description,
    startAt: instant(start),
    endAt: instant(end),
    roomId: roomId || null,
    additionalRoomIds: roomId ? additionalRoomIds.filter((id) => id !== roomId) : [],
    requiredEquipment: equipment
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    // Null follows the primary location's planned media and virtual-room link.
    plannedMedia: mediaOverride ? media : null,
    virtualRoomUrl: mediaOverride ? virtualRoomUrl.trim() || null : null,
    admissionPolicy: participation.policy,
    accessPolicy: participation.accessPolicy,
    bookingOpensAt: instant(participation.bookingOpensAt),
    bookingClosesAt: instant(participation.bookingClosesAt),
    capacity: participation.capacity ? Number(participation.capacity) : null,
    remoteCapacity: participation.remoteCapacity ? Number(participation.remoteCapacity) : null,
    recordingUrl: recordingUrl || null,
    visibility,
    kind,
    sponsorIds,
  };
  const form = useContractForm(
    withinAgendaEventWindow(occurrence ? agendaOccurrencePatchSchema : agendaOccurrenceCreateSchema, snapshot),
    body,
  );
  // What a session is and who presents it comes first; time and place are usually set on the agenda itself.
  const tabs = useFormTabs(form, [
    {
      id: "session",
      label: "Session",
      fields: [
        "title",
        "kind",
        "format",
        "track",
        "placeholder",
        "speakerUserIds",
        "speakerRoles",
        "speakerPlacements",
        "description",
      ],
    },
    { id: "schedule", label: "Schedule", fields: ["startAt", "endAt", "roomId", "additionalRoomIds"] },
    {
      id: "participation",
      label: "Participation",
      fields: ["admissionPolicy", "accessPolicy", "bookingOpensAt", "bookingClosesAt", "capacity", "remoteCapacity"],
    },
    {
      id: "media",
      label: "Media & equipment",
      fields: ["recordingUrl", "plannedMedia", "virtualRoomUrl", "requiredEquipment"],
    },
    { id: "publishing", label: "Publishing", fields: ["visibility", "sponsorIds"] },
  ]);
  const initialBody = useRef(JSON.stringify(body));
  const dirty = JSON.stringify(body) !== initialBody.current;
  async function save(event: Event) {
    event.preventDefault();
    if (busy) return;
    const checked = form.submit();
    if (!checked.data) {
      tabs.revealErrors();
      setError(checked.message);
      return;
    }
    setBusy(true);
    onBusy?.(true);
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
      tabs.revealErrors();
      setConflicts(agendaConflictDetails(e));
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <Panel>
      {!dialog && (
        <PanelHeader title={occurrence ? "Edit session" : "New session"}>
          {occurrence && actions && (
            <RowActions
              subject={occurrence.title}
              actions={actions(onClose).map((action) => ({ ...action, disabled: busy || dirty || action.disabled }))}
            />
          )}
          <Button onClick={onClose}>Close</Button>
        </PanelHeader>
      )}
      <PanelBody>
        {actions && dirty && <p class="pk-muted">Save or cancel your changes before using session actions.</p>}
        {error && <ErrorAlert error={error} />}
        {conflicts && <LazyAgendaConflictDetails details={conflicts} snapshot={snapshot} />}
        <form ref={focus} noValidate {...form.handlers} onSubmit={(event) => void save(event)} class="pk-stack">
          <TabList label="Session editing sections" {...tabs.list} />
          <div {...tabs.panel("session")}>
            <fieldset disabled={busy} class="pk-fieldset pk-agenda-editor__form">
              <div class="pk-agenda-editor__form-wide">
                <Field label="Session title" required {...form.of("title")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="title"
                      value={title}
                      onInput={(e) => setTitle(e.currentTarget.value)}
                    />
                  )}
                </Field>
              </div>
              <SessionTypeFields
                snapshot={snapshot}
                occurrence={occurrence}
                kind={kind}
                onKind={(next, suggestedTitle) => {
                  setKind(next);
                  if (suggestedTitle && !title.trim()) setTitle(suggestedTitle);
                }}
                format={format}
                onFormat={setFormat}
                track={track}
                onTrack={setTrack}
                of={form.of}
              />
              {kind !== "break" && (
                <div class="pk-agenda-editor__form-wide">
                  <Checkbox
                    name="placeholder"
                    checked={placeholder}
                    aria-invalid={form.of("placeholder").state === "invalid" ? "true" : undefined}
                    onInput={(event) => setPlaceholder(event.currentTarget.checked)}
                    label="Placeholder — content to be announced"
                  />
                </div>
              )}
              <div class="pk-agenda-editor__form-wide pk-stack pk-stack--snug">
                <Field label="Speakers" {...form.of("speakerUserIds")}>
                  {(control) => (
                    <UserPicker
                      responseSchema={agendaPeopleListSchema}
                      sort="name"
                      placeholder="Add a speaker: search event people by name…"
                      endpoint={`/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/people`}
                      value={picked}
                      onChange={(person) => {
                        setPicked(person);
                        if (person && !speakers.some((speaker) => speaker.userId === person.id))
                          setSpeakers([
                            ...speakers,
                            {
                              userId: person.id,
                              displayName:
                                [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email,
                            },
                          ]);
                      }}
                      inputProps={{ ...control, name: "speakerUserIds" }}
                    />
                  )}
                </Field>
                <SessionSpeakerFields
                  occurrence={snapshot.occurrences.find((item) => item.id === occurrence?.id)}
                  speakers={speakers}
                  setSpeakers={setSpeakers}
                />
              </div>
              <div class="pk-agenda-editor__form-wide pk-agenda-editor__description">
                <Field label="Description" help="Markdown formatting is kept." {...form.of("description")}>
                  {(control) => (
                    <MarkdownEditor
                      {...control}
                      variant="compact"
                      name="description"
                      label="Description"
                      initialValue={description}
                      disabled={busy}
                      onChange={setDescription}
                    />
                  )}
                </Field>
              </div>
            </fieldset>
          </div>
          <div {...tabs.panel("schedule")}>
            <SessionScheduleFields
              snapshot={snapshot}
              start={start}
              end={end}
              onStart={setStart}
              onEnd={setEnd}
              roomId={roomId}
              additionalRoomIds={additionalRoomIds}
              globalAll={kind === "break"}
              of={form.of}
              disabled={busy}
              onLocations={(selected) => {
                const primary = selected.includes(roomId) ? roomId : (selected[0] ?? "");
                setSpeakers(agendaMovedSpeakers({ roomId: roomId || null, speakers }, primary || null));
                setRoom(primary);
                setAdditionalRooms(selected.filter((id) => id !== primary));
              }}
            />
          </div>
          <div {...tabs.panel("participation")}>
            <SessionParticipationFields
              draft={participation}
              onChange={(next) => setParticipation((current) => ({ ...current, ...next }))}
              timeZone={snapshot.timeZone}
              of={form.of}
              disabled={busy}
            />
          </div>
          <div {...tabs.panel("media")} class="pk-stack">
            <fieldset disabled={busy} class="pk-fieldset pk-agenda-editor__form">
              <div class="pk-agenda-editor__form-wide">
                <Field
                  label="Recording URL"
                  help="For example the YouTube address. The public agenda shows it once the recording is released in the session's materials."
                  {...form.of("recordingUrl")}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      name="recordingUrl"
                      type="url"
                      value={recordingUrl}
                      onInput={(event) => setRecording(event.currentTarget.value)}
                    />
                  )}
                </Field>
              </div>
              <SessionSlidesStatus
                occurrence={occurrence}
                blocked={dirty || busy}
                onManage={occurrence && onManageSlides ? () => onManageSlides(occurrence) : undefined}
              />
            </fieldset>
            <SessionMediaFields
              room={room}
              override={mediaOverride}
              onOverride={(value) => {
                if (value && !mediaOverride) {
                  const defaults = agendaMediaCapabilities(room?.equipment);
                  setMedia(defaults);
                  setVirtualRoomUrl(room?.virtualRoomUrl ?? "");
                }
                setMediaOverride(value);
              }}
              media={media}
              onMedia={setMedia}
              virtualRoomUrl={virtualRoomUrl}
              onVirtualRoomUrl={setVirtualRoomUrl}
              equipment={equipment}
              onEquipment={setEquipment}
              of={form.of}
              disabled={busy}
            />
          </div>
          <div {...tabs.panel("publishing")}>
            <fieldset disabled={busy} class="pk-fieldset pk-agenda-editor__form">
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
                      <option value={value}>{value === "public" ? "Public" : "Private"}</option>
                    ))}
                  </Select>
                )}
              </Field>
              {kind === "break" && (
                <div class="pk-agenda-editor__form-wide">
                  <AgendaSponsorFields
                    slug={snapshot.eventSlug}
                    value={sponsorIds}
                    onChange={setSponsorIds}
                    disabled={busy}
                    {...form.of("sponsorIds")}
                  />
                </div>
              )}
            </fieldset>
          </div>
          {!dialog && (
            <div class="pk-cluster pk-cluster--end">
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving…" : "Save session"}
              </Button>
            </div>
          )}
        </form>
      </PanelBody>
    </Panel>
  );
}
