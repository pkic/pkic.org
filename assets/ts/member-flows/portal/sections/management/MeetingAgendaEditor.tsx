import { MeetingFormatPicker } from "./MeetingFormatPicker";
import { UserPicker } from "../../../../components/UserPicker";
import { groupMembershipsManagementListResponseSchema } from "../../../../../shared/schemas/groups";
import { useState } from "preact/hooks";
import { z } from "zod";
import {
  meetingAgendaSchema,
  meetingAgendaSaveSchema,
  meetingAgendaScopeSchema,
  meetingAgendaTimes,
  type MeetingAgenda,
} from "../../../../../shared/schemas/meeting-agenda";
import { formatDateTimeInZone } from "../../../../../shared/format-date";
import { useData } from "../../../../hooks/useData";
import { useContractForm } from "../../../../hooks/useContractForm";
import { getJson, postJson } from "../../../../shared/api-client";
import { Panel, PanelHeader, PanelBody } from "../../../../ui/Panel";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { TextInput, Textarea, Select } from "../../../../ui/TextControl";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
export function MeetingAgendaEditor({
  groupId,
  seriesId,
  occurrenceId,
}: {
  groupId: string;
  seriesId: string;
  occurrenceId?: string;
}) {
  const endpoint = `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(seriesId)}/agenda`;
  const detail = useData(
    () =>
      getJson(
        `${endpoint}${occurrenceId ? `?occurrenceId=${encodeURIComponent(occurrenceId)}` : ""}`,
        meetingAgendaSchema,
      ),
    [endpoint, occurrenceId],
  );
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data) return <Spinner />;
  return (
    <AgendaForm
      groupId={groupId}
      key={`${occurrenceId ?? "template"}/${detail.data.revision}/${detail.data.formatVersion}`}
      agenda={detail.data}
      endpoint={endpoint}
    />
  );
}
const meetingPeopleResponseSchema = groupMembershipsManagementListResponseSchema.transform((response) => ({
  page: response.page,
  users: response.memberships.map((person) => ({
    id: person.userId,
    email: "",
    first_name: person.userName,
    last_name: "",
    organization_name: person.organizationName,
  })),
}));
function AgendaForm({ agenda, endpoint, groupId }: { agenda: MeetingAgenda; endpoint: string; groupId: string }) {
  const [snapshot, setSnapshot] = useState(agenda),
    [name, setName] = useState(agenda.name),
    [items, setItems] = useState(agenda.items),
    [scope, setScope] = useState<z.infer<typeof meetingAgendaScopeSchema>>(
      agenda.occurrenceId ? "occurrence" : "template",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const body = {
    expectedRevision: snapshot.revision,
    expectedFormatVersion: snapshot.formatVersion,
    expectedWriteRevision: snapshot.writeRevision,
    scope,
    fromOccurrenceId: snapshot.occurrenceId,
    name,
    items,
  };
  const [copying, setCopying] = useState(false);
  const form = useContractForm(meetingAgendaSaveSchema, body);
  const immutable =
    snapshot.publishedAt !== null || (snapshot.startsAt !== null && Date.parse(snapshot.startsAt) <= Date.now());
  function move(index: number, target: number) {
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    setItems(next);
  }
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
      const updated = await postJson(endpoint, checked.data, meetingAgendaSchema);
      setSnapshot(updated);
      setItems(updated.items);
      setName(updated.name);
      setMessage(
        scope === "template"
          ? "Reusable format saved. Existing occurrence agendas are preserved."
          : scope === "future"
            ? "Future draft agendas updated; exceptions, past and published agendas were preserved."
            : "This occurrence agenda was saved as an exception.",
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save agenda.");
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!snapshot.occurrenceId) return;
    setBusy(true);
    try {
      const updated = await postJson(
        endpoint.replace(/\/agenda$/u, `/occurrences/${encodeURIComponent(snapshot.occurrenceId)}/agenda/publications`),
        { expectedRevision: snapshot.revision },
        meetingAgendaSchema,
      );
      setSnapshot(updated);
      setItems(updated.items);
      setName(updated.name);
      setMessage("Approved agenda frozen for this meeting occurrence.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not approve agenda.");
    } finally {
      setBusy(false);
    }
  }
  const times = snapshot.startsAt ? meetingAgendaTimes(snapshot.startsAt, items) : null;
  return (
    <Panel>
      <PanelHeader title={snapshot.occurrenceId ? "Meeting agenda" : "Reusable meeting format"} />
      <PanelBody>
        {!immutable && <Button onClick={() => setCopying(!copying)}>Browse reusable formats</Button>}
        {copying && (
          <MeetingFormatPicker
            groupId={groupId}
            onCopy={(copiedName, copiedItems) => {
              setName(copiedName);
              setItems(copiedItems);
              setCopying(false);
              setMessage("Format copied into this draft. Review durations and assign speakers before saving.");
            }}
          />
        )}
        <p>Order items and set their durations. Times follow the existing meeting occurrence and its timezone.</p>
        {immutable && (
          <p>This past or approved occurrence is preserved. Update the reusable format or another future draft.</p>
        )}
        <form noValidate onSubmit={save} class="pk-form">
          <Field label="Agenda name" {...form.of("name")}>
            {(control) => (
              <TextInput
                {...control}
                value={name}
                disabled={immutable}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="Apply changes" {...form.of("scope")}>
            {(control) => (
              <Select
                {...control}
                value={scope}
                disabled={immutable}
                onChange={(event) => setScope(meetingAgendaScopeSchema.parse(event.currentTarget.value))}
              >
                {meetingAgendaScopeSchema.options
                  .filter((option) => snapshot.occurrenceId || option === "template")
                  .map((option) => (
                    <option value={option}>
                      {option === "occurrence"
                        ? "Only this occurrence (exception)"
                        : option === "future"
                          ? "Future draft occurrences from this meeting"
                          : "Reusable format for new occurrences"}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <ol>
            {items.map((item, index) => (
              <li key={item.id}>
                <div class="pk-stack">
                  <Field label={`Item ${index + 1} title`} {...form.of(`items.${index}.title`)}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={item.title}
                        disabled={immutable}
                        onInput={(event) =>
                          setItems(
                            items.map((value, position) =>
                              position === index ? { ...value, title: event.currentTarget.value } : value,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field label="Description" {...form.of(`items.${index}.description`)}>
                    {(control) => (
                      <Textarea
                        {...control}
                        value={item.description}
                        disabled={immutable}
                        onInput={(event) =>
                          setItems(
                            items.map((value, position) =>
                              position === index ? { ...value, description: event.currentTarget.value } : value,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field label="Duration in minutes" {...form.of(`items.${index}.durationMinutes`)}>
                    {(control) => (
                      <TextInput
                        type="number"
                        {...control}
                        value={item.durationMinutes}
                        min={1}
                        max={480}
                        disabled={immutable}
                        onInput={(event) =>
                          setItems(
                            items.map((value, position) =>
                              position === index
                                ? { ...value, durationMinutes: Number(event.currentTarget.value) }
                                : value,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field label="Add speaker" {...form.of(`items.${index}.speakerUserIds`)}>
                    {(control) => (
                      <UserPicker
                        inputProps={control}
                        value={null}
                        disabled={immutable || item.speakerUserIds.length >= 30}
                        endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/memberships`}
                        responseSchema={meetingPeopleResponseSchema}
                        sort="user_name"
                        placeholder="Search this group's people"
                        onChange={(person) => {
                          if (person && !item.speakerUserIds.includes(person.id))
                            setItems(
                              items.map((value, position) =>
                                position === index
                                  ? { ...value, speakerUserIds: [...value.speakerUserIds, person.id] }
                                  : value,
                              ),
                            );
                        }}
                      />
                    )}
                  </Field>
                  {item.speakerUserIds.map((person, position) => (
                    <Button
                      type="button"
                      disabled={immutable}
                      onClick={() =>
                        setItems(
                          items.map((value, itemPosition) =>
                            itemPosition === index
                              ? { ...value, speakerUserIds: value.speakerUserIds.filter((id) => id !== person) }
                              : value,
                          ),
                        )
                      }
                    >
                      Remove speaker {position + 1}
                    </Button>
                  ))}
                  {times && (
                    <p>
                      {formatDateTimeInZone(times[index]!.startAt, snapshot.timezone)} –{" "}
                      {formatDateTimeInZone(times[index]!.endAt, snapshot.timezone)}
                    </p>
                  )}
                  <div class="pk-cluster">
                    <Button type="button" disabled={immutable || index === 0} onClick={() => move(index, index - 1)}>
                      Move up
                    </Button>
                    <Button
                      type="button"
                      disabled={immutable || index === items.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      Move down
                    </Button>
                    <Button
                      type="button"
                      disabled={immutable}
                      onClick={() => setItems(items.filter((_, position) => position !== index))}
                    >
                      Remove item
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p>Total duration: {items.reduce((sum, item) => sum + item.durationMinutes, 0)} minutes.</p>
          <Button
            type="button"
            disabled={immutable || items.length >= 100}
            onClick={() =>
              setItems([
                ...items,
                {
                  id: crypto.randomUUID(),
                  title: "New agenda item",
                  description: "",
                  durationMinutes: 5,
                  speakerUserIds: [],
                },
              ])
            }
          >
            Add agenda item
          </Button>
          <Button type="submit" disabled={busy || immutable}>
            Save agenda
          </Button>
        </form>
        {snapshot.occurrenceId && (
          <Button
            disabled={
              busy || immutable || snapshot.revision === 0 || items !== snapshot.items || name !== snapshot.name
            }
            onClick={publish}
          >
            Approve and freeze this agenda
          </Button>
        )}
        {error && <ErrorAlert error={error} />} {message && <p role="status">{message}</p>}
      </PanelBody>
    </Panel>
  );
}
