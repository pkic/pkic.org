import {
  agendaMediaCapabilities,
  withoutAgendaMediaEquipment,
  withAgendaMediaCapabilities,
} from "../../../../../../../shared/event-agenda-media";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import { useEditorFocus } from "./useEditorFocus";
import { useState } from "preact/hooks";
import {
  agendaRoomCreateSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useFormTabs } from "../../../../../../hooks/useFormTabs";
import { TabList } from "../../../../../../ui/TabList";
import { postJson, putJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
export function RoomEditor({
  snapshot,
  room,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  room?: AgendaSnapshot["rooms"][number];
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const [setupMinutes, setSetup] = useState(String(room?.setupMinutes ?? 0));
  const [name, setName] = useState(room?.name ?? "");
  const [capacity, setCapacity] = useState(room?.capacity == null ? "" : String(room.capacity));
  const [equipment, setEquipment] = useState(withoutAgendaMediaEquipment(room?.equipment).join(", "));
  const [media, setMedia] = useState(() => agendaMediaCapabilities(room?.equipment));
  const [virtualRoomUrl, setVirtualRoomUrl] = useState(room?.virtualRoomUrl ?? "");
  const [periods, setPeriods] = useState(
    (room?.availablePeriods ?? []).map((period) => ({
      startAt: instantToDateTimeLocal(period.startAt, snapshot.timeZone),
      endAt: instantToDateTimeLocal(period.endAt, snapshot.timeZone),
    })),
  );
  function instant(value: string) {
    try {
      return dateTimeLocalToIso(value, snapshot.timeZone);
    } catch {
      return value;
    }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(agendaRoomCreateSchema, {
    expectedRevision: snapshot.revision,
    name,
    setupMinutes: Number(setupMinutes),
    capacity: capacity ? Number(capacity) : null,
    availablePeriods: periods.map((period) => ({ startAt: instant(period.startAt), endAt: instant(period.endAt) })),
    equipment: withAgendaMediaCapabilities(
      equipment
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      media,
    ),
    virtualRoomUrl: virtualRoomUrl.trim() || null,
  });
  const tabs = useFormTabs(form, [
    { id: "location", label: "Location", fields: ["name", "capacity"] },
    { id: "equipment", label: "Equipment & media", fields: ["equipment", "virtualRoomUrl"] },
    { id: "availability", label: "Availability", fields: ["setupMinutes", "availablePeriods"] },
  ]);
  async function save(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      tabs.revealErrors();
      return;
    }
    setBusy(true);
    try {
      onSaved(
        await (room ? putJson : postJson)(
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/rooms${room ? `/${encodeURIComponent(room.id)}` : ""}`,
          checked.data,
          agendaSnapshotSchema,
        ),
      );
      onClose();
    } catch (e) {
      setError(form.refuse(e));
      tabs.revealErrors();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title={room ? "Edit location" : "New location"} />
      <PanelBody>
        {error && <ErrorAlert error={error} />}
        <form ref={focus} noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => void save(event)}>
          <TabList label="Location editing sections" {...tabs.list} />
          <div {...tabs.panel("location")} class="pk-stack">
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
              help="Leave empty for unlimited physical capacity."
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
          </div>
          <div {...tabs.panel("equipment")} class="pk-stack">
            <fieldset class="pk-stack">
              <legend>Planned media</legend>
              <Checkbox
                name="recording"
                label="Recording"
                checked={media.recording}
                onChange={(event) => setMedia({ ...media, recording: event.currentTarget.checked })}
              />
              <Checkbox
                name="liveStreaming"
                label="Live streaming"
                checked={media.liveStreaming}
                onChange={(event) => setMedia({ ...media, liveStreaming: event.currentTarget.checked })}
              />
              <p class="pk-muted">
                Sessions here follow these plans and the virtual-room link unless a session overrides them. Plans do not
                publish a recording.
              </p>
            </fieldset>
            <Field
              label="Virtual-room link"
              help="Default online destination for sessions in this location. Only authorized signed-in attendees can open it during a session; the public agenda never exposes this address."
              {...form.of("virtualRoomUrl")}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="virtualRoomUrl"
                  value={virtualRoomUrl}
                  onInput={(event) => setVirtualRoomUrl(event.currentTarget.value)}
                />
              )}
            </Field>
            <Field
              label="Available equipment"
              help="Separate other items with commas, for example projector, microphones."
              {...form.of("equipment")}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="equipment"
                  value={equipment}
                  onInput={(event) => setEquipment(event.currentTarget.value)}
                />
              )}
            </Field>
          </div>
          <div {...tabs.panel("availability")} class="pk-stack">
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
            <fieldset class="pk-stack">
              <legend>Location availability</legend>
              <p>
                Leave empty for the whole event. Otherwise, add opening periods in {snapshot.timeZone}; sessions and
                setup time must fit inside a period.
              </p>
              {periods.map((period, index) => (
                <div class="pk-stack">
                  <Field label={`Period ${index + 1} opens`} required {...form.of(`availablePeriods.${index}.startAt`)}>
                    {(control) => (
                      <TextInput
                        {...control}
                        name={`availablePeriods.${index}.startAt`}
                        type="datetime-local"
                        value={period.startAt}
                        onInput={(event) =>
                          setPeriods(
                            periods.map((current, position) =>
                              position === index ? { ...current, startAt: event.currentTarget.value } : current,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field label={`Period ${index + 1} closes`} required {...form.of(`availablePeriods.${index}.endAt`)}>
                    {(control) => (
                      <TextInput
                        {...control}
                        name={`availablePeriods.${index}.endAt`}
                        type="datetime-local"
                        value={period.endAt}
                        onInput={(event) =>
                          setPeriods(
                            periods.map((current, position) =>
                              position === index ? { ...current, endAt: event.currentTarget.value } : current,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <div class="pk-cluster">
                    <Button
                      type="button"
                      onClick={() => setPeriods(periods.filter((_, position) => position !== index))}
                    >
                      Remove period {index + 1}
                    </Button>
                  </div>
                </div>
              ))}
              <div class="pk-cluster">
                <Button
                  type="button"
                  disabled={periods.length >= 100}
                  onClick={() => setPeriods([...periods, { startAt: "", endAt: "" }])}
                >
                  Add opening period
                </Button>
              </div>
            </fieldset>
          </div>
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
