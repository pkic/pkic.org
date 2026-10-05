import type { z } from "zod";
import { useEditorFocus } from "./useEditorFocus";
import { useMemo, useState } from "preact/hooks";
import {
  agendaRoleMemberSchema,
  agendaStaffingSchema,
  agendaPeopleListSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import {
  listFilterOptionSchema,
  listFilterOptionsResponseSchema,
} from "../../../../../../../shared/schemas/list-filter-options";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { UserPicker, type PickedUser } from "../../../../../../components/UserPicker";
import { postJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";

export function StaffingSetup({
  snapshot,
  onSaved,
  onClose,
  kind,
  editId,
}: {
  snapshot: AgendaSnapshot;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
  kind: "block" | "person";
  editId?: string;
}) {
  const focus = useEditorFocus();
  const existingBlock = kind === "block" ? snapshot.blocks.find((item) => item.id === editId) : undefined;
  const existingPerson = kind === "person" ? snapshot.roleMembers.find((item) => item.userId === editId) : undefined;
  const [compatible, setCompatible] = useState<Array<[string, string]>>(existingBlock?.compatibleRolePairs ?? []);
  const [startBoundary, setStartBoundary] = useState(existingBlock?.boundaries?.startOccurrenceId ?? "");
  const [endBoundary, setEndBoundary] = useState(existingBlock?.boundaries?.endOccurrenceId ?? "");
  const [seniority, setSeniority] = useState<"junior" | "senior">(existingPerson?.seniority ?? "junior");
  const [attendanceMode, setAttendanceMode] = useState<"physical" | "remote">(
    existingPerson?.attendanceMode ?? "physical",
  );
  const [maximum, setMaximum] = useState(existingPerson?.maxMinutes?.toString() ?? "");
  const [name, setName] = useState(existingBlock?.name ?? "");
  const [roles, setRoles] = useState((existingBlock?.roles ?? existingPerson?.roles)?.join(", ") ?? "");
  const [start, setStart] = useState(() => {
    const value = existingBlock?.startAt ?? existingPerson?.availableFrom;
    return value ? instantToDateTimeLocal(value, snapshot.timeZone) : "";
  });
  const [end, setEnd] = useState(() => {
    const value = existingBlock?.endAt ?? existingPerson?.availableUntil;
    return value ? instantToDateTimeLocal(value, snapshot.timeZone) : "";
  });
  const [track, setTrack] = useState(existingBlock?.track ?? null);
  const trackCatalog = useMemo(
    () => ({
      endpoint: `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/occurrences/filters`,
      params: { field: "track" },
      responseSchema: listFilterOptionsResponseSchema,
      resolveItems: (response: z.infer<typeof listFilterOptionsResponseSchema>) => response.options,
      resolvePage: (response: z.infer<typeof listFilterOptionsResponseSchema>) => response.page,
      itemKey: (item: z.infer<typeof listFilterOptionSchema>) => item.value,
      itemLabel: (item: z.infer<typeof listFilterOptionSchema>) => item.label,
      sort: "value",
    }),
    [snapshot.eventSlug],
  );
  const [room, setRoom] = useState(existingBlock?.roomId ?? "");
  const [person, setPerson] = useState<PickedUser | null>(
    existingPerson ? { id: existingPerson.userId, email: "", firstName: existingPerson.displayName } : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(() => existingBlock?.id ?? crypto.randomUUID());
  function instant(value: string) {
    try {
      return dateTimeLocalToIso(value, snapshot.timeZone);
    } catch {
      return value;
    }
  }
  const blockIndex = snapshot.blocks.filter((item) => item.id !== editId).length;
  const personIndex = snapshot.roleMembers.filter((item) => item.userId !== editId).length;
  const prefix = kind === "block" ? `blocks.${blockIndex}` : `roleMembers.${personIndex}`;
  const eligibleRoles = roles
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  const body = {
    expectedRevision: snapshot.revision,
    blocks:
      kind === "block"
        ? [
            ...snapshot.blocks.filter((item) => item.id !== editId),
            {
              id,
              name,
              startAt: instant(start),
              endAt: instant(end),
              roomId: room || null,
              track,
              roles: eligibleRoles,
              compatibleRolePairs: compatible.filter((pair) => pair.every((role) => eligibleRoles.includes(role))),
              boundaries: { startOccurrenceId: startBoundary || null, endOccurrenceId: endBoundary || null },
              roleRequirements: existingBlock?.roleRequirements ?? [],
            },
          ]
        : snapshot.blocks,
    roleMembers:
      kind === "person"
        ? [
            ...snapshot.roleMembers.filter((item) => item.userId !== editId),
            {
              userId: person?.id ?? "",
              displayName: [person?.firstName, person?.lastName].filter(Boolean).join(" ") || person?.email || "",
              roles: eligibleRoles,
              availableFrom: start ? instant(start) : null,
              availableUntil: end ? instant(end) : null,
              maxMinutes: maximum ? Number(maximum) : null,
              seniority,
              attendanceMode,
            },
          ]
        : snapshot.roleMembers,
    assignments: snapshot.assignments,
    staffingRoles: snapshot.staffingRoles,
    staffingPosts: snapshot.staffingPosts,
    staffingRequirements: snapshot.staffingRequirements,
    staffingPositions: snapshot.staffingPositions,
  };
  const form = useContractForm(agendaStaffingSchema, body);
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
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/staffing`,
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
      <PanelHeader
        title={
          editId
            ? kind === "block"
              ? "Edit staffing block"
              : "Edit eligible person"
            : kind === "block"
              ? "New staffing block"
              : "Add eligible person"
        }
      />
      <PanelBody>
        {error && <ErrorAlert error={error} />}
        <form ref={focus} noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => void save(event)}>
          {kind === "block" ? (
            <Field label="Block name" required {...form.of(`blocks.${blockIndex}.name`)}>
              {(control) => (
                <TextInput
                  {...control}
                  name={`blocks.${blockIndex}.name`}
                  value={name}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              )}
            </Field>
          ) : (
            <Field label="Person" required {...form.of(`roleMembers.${personIndex}.userId`)}>
              {(control) => (
                <UserPicker
                  responseSchema={agendaPeopleListSchema}
                  sort="name"
                  placeholder="Search event people by name…"
                  endpoint={`/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/people`}
                  value={person}
                  onChange={setPerson}
                  inputProps={{ ...control, name: `roleMembers.${personIndex}.userId` }}
                />
              )}
            </Field>
          )}
          {kind === "person" && (
            <Field label="Eligible roles" {...form.of(`roleMembers.${personIndex}.roles`)} group>
              {() => (
                <div class="pk-stack">
                  {snapshot.staffingRoles.map((role) => (
                    <Checkbox
                      label={role.name}
                      checked={eligibleRoles.includes(role.id)}
                      onChange={(event) =>
                        setRoles(
                          (event.currentTarget.checked
                            ? [...eligibleRoles, role.id]
                            : eligibleRoles.filter((id) => id !== role.id)
                          ).join(","),
                        )
                      }
                    />
                  ))}
                  {!snapshot.staffingRoles.length && <p>Configure event roles first.</p>}
                </div>
              )}
            </Field>
          )}
          <Field
            label={kind === "block" ? "Block starts" : "Available from"}
            {...form.of(`${prefix}.${kind === "block" ? "startAt" : "availableFrom"}`)}
            help={`Times in ${snapshot.timeZone}`}
          >
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
          <Field
            label={kind === "block" ? "Block ends" : "Available until"}
            {...form.of(`${prefix}.${kind === "block" ? "endAt" : "availableUntil"}`)}
          >
            {(control) => (
              <TextInput
                {...control}
                name="endAt"
                type="datetime-local"
                value={end}
                onInput={(event) => setEnd(event.currentTarget.value)}
              />
            )}
          </Field>
          {kind === "person" && (
            <div class="pk-agenda-editor__form">
              <Field label="Experience" {...form.of(`${prefix}.seniority`)}>
                {(control) => (
                  <Select
                    {...control}
                    name={`${prefix}.seniority`}
                    value={seniority}
                    onChange={(event) =>
                      setSeniority(agendaRoleMemberSchema.shape.seniority.unwrap().parse(event.currentTarget.value))
                    }
                  >
                    {agendaRoleMemberSchema.shape.seniority.unwrap().options.map((value) => (
                      <option value={value}>{value}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Staff attendance mode" {...form.of(`${prefix}.attendanceMode`)}>
                {(control) => (
                  <Select
                    {...control}
                    name={`${prefix}.attendanceMode`}
                    value={attendanceMode}
                    onChange={(event) =>
                      setAttendanceMode(
                        agendaRoleMemberSchema.shape.attendanceMode.unwrap().parse(event.currentTarget.value),
                      )
                    }
                  >
                    {agendaRoleMemberSchema.shape.attendanceMode.unwrap().options.map((value) => (
                      <option value={value}>{value}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          )}
          {kind === "block" && (
            <>
              <Field label="Start after break or lunch" {...form.of(`${prefix}.boundaries.startOccurrenceId`)}>
                {(control) => (
                  <Select
                    {...control}
                    name={`${prefix}.boundaries.startOccurrenceId`}
                    value={startBoundary}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setStartBoundary(value);
                      const occurrence = snapshot.occurrences.find((item) => item.id === value);
                      if (occurrence?.endAt) setStart(instantToDateTimeLocal(occurrence.endAt, snapshot.timeZone));
                    }}
                  >
                    <option value="">Custom boundary</option>
                    {snapshot.occurrences
                      .filter((item) => item.kind === "break" && item.endAt)
                      .map((item) => (
                        <option value={item.id}>{item.title}</option>
                      ))}
                  </Select>
                )}
              </Field>
              <Field label="End at break or lunch" {...form.of(`${prefix}.boundaries.endOccurrenceId`)}>
                {(control) => (
                  <Select
                    {...control}
                    name={`${prefix}.boundaries.endOccurrenceId`}
                    value={endBoundary}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setEndBoundary(value);
                      const occurrence = snapshot.occurrences.find((item) => item.id === value);
                      if (occurrence?.startAt) setEnd(instantToDateTimeLocal(occurrence.startAt, snapshot.timeZone));
                    }}
                  >
                    <option value="">Custom boundary</option>
                    {snapshot.occurrences
                      .filter((item) => item.kind === "break" && item.startAt)
                      .map((item) => (
                        <option value={item.id}>{item.title}</option>
                      ))}
                  </Select>
                )}
              </Field>
              <Field
                label="Compatible duties"
                help="Only explicitly selected pairs can be assigned to one person in this same block. Each duty counts toward their workload."
                {...form.of(`${prefix}.compatibleRolePairs`)}
                group
              >
                {(control) => (
                  <>
                    {eligibleRoles.flatMap((first, index) =>
                      eligibleRoles
                        .slice(index + 1)
                        .map((second) => (
                          <Checkbox
                            {...control}
                            label={`${first} + ${second}`}
                            checked={compatible.some((pair) => pair.includes(first) && pair.includes(second))}
                            onChange={(event) =>
                              setCompatible(
                                event.currentTarget.checked
                                  ? [...compatible, [first, second]]
                                  : compatible.filter((pair) => !pair.includes(first) || !pair.includes(second)),
                              )
                            }
                          />
                        )),
                    )}
                  </>
                )}
              </Field>
            </>
          )}
          {kind === "person" && (
            <Field
              label="Maximum assigned minutes"
              help="Leave empty for an unrestricted workload."
              {...form.of(`${prefix}.maxMinutes`)}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name={`${prefix}.maxMinutes`}
                  type="number"
                  value={maximum}
                  onInput={(event) => setMaximum(event.currentTarget.value)}
                />
              )}
            </Field>
          )}
          {kind === "block" && (
            <Field
              label="Track"
              help="Limit this block to the chosen program track. When a location is also selected, both must match."
              {...form.of(`${prefix}.track`)}
            >
              {(control) => (
                <ServerSearchSelect
                  {...control}
                  catalog={trackCatalog}
                  searchLabel="Track"
                  value={track}
                  selectedLabel={track ?? undefined}
                  placeholder="All tracks"
                  onChange={(item) => setTrack(item?.value ?? null)}
                />
              )}
            </Field>
          )}
          {kind === "block" && (
            <Field label="Location" {...form.of(`${prefix}.roomId`)}>
              {(control) => (
                <Select
                  {...control}
                  name="roomId"
                  value={room}
                  onChange={(event) => setRoom(event.currentTarget.value)}
                >
                  <option value="">All locations</option>
                  {snapshot.rooms.map((value) => (
                    <option value={value.id}>{value.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <div class="pk-cluster pk-cluster--end">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Save {kind === "block" ? "block" : "person"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
