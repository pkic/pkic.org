import { useEditorFocus } from "./useEditorFocus";
import { useState } from "preact/hooks";
import {
  agendaBlockSchema,
  agendaRoleMemberSchema,
  agendaStaffingSchema,
  agendaPeopleListSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { dateTimeLocalToIso } from "../../../../../../../shared/timezone";
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
}: {
  snapshot: AgendaSnapshot;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
  kind: "block" | "person";
}) {
  const focus = useEditorFocus();
  const [seniority, setSeniority] = useState<"junior" | "senior">("junior");
  const [attendanceMode, setAttendanceMode] = useState<"physical" | "remote">("physical");
  const [requirements, setRequirements] = useState<
    Record<string, { seniority: "any" | "senior"; attendanceMode: "any" | "physical" | "remote" }>
  >({});
  const [maximum, setMaximum] = useState("");
  const [name, setName] = useState("");
  const [roles, setRoles] = useState("MC, Room Q&A, Remote Q&A");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [room, setRoom] = useState("");
  const [person, setPerson] = useState<PickedUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(() => crypto.randomUUID());
  function instant(value: string) {
    try {
      return dateTimeLocalToIso(value, snapshot.timeZone);
    } catch {
      return value;
    }
  }
  const prefix = kind === "block" ? `blocks.${snapshot.blocks.length}` : `roleMembers.${snapshot.roleMembers.length}`;
  const eligibleRoles = roles
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  const body = {
    expectedRevision: snapshot.revision,
    blocks:
      kind === "block"
        ? [
            ...snapshot.blocks,
            {
              id,
              name,
              startAt: instant(start),
              endAt: instant(end),
              roomId: room || null,
              roles: eligibleRoles,
              roleRequirements: eligibleRoles.map((role) => ({
                role,
                seniority: requirements[role]?.seniority ?? "any",
                attendanceMode: requirements[role]?.attendanceMode ?? "any",
              })),
            },
          ]
        : snapshot.blocks,
    roleMembers:
      kind === "person"
        ? [
            ...snapshot.roleMembers,
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
      <PanelHeader title={kind === "block" ? "New staffing block" : "Add eligible person"} />
      <PanelBody>
        {error && <ErrorAlert error={error} />}
        <form ref={focus} noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => void save(event)}>
          {kind === "block" ? (
            <Field label="Block name" required {...form.of(`blocks.${snapshot.blocks.length}.name`)}>
              {(control) => (
                <TextInput
                  {...control}
                  name={`blocks.${snapshot.blocks.length}.name`}
                  value={name}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              )}
            </Field>
          ) : (
            <Field label="Person" required {...form.of(`roleMembers.${snapshot.roleMembers.length}.userId`)}>
              {(control) => (
                <UserPicker
                  responseSchema={agendaPeopleListSchema}
                  sort="name"
                  placeholder="Search event people by name…"
                  endpoint={`/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/people`}
                  value={person}
                  onChange={setPerson}
                  inputProps={{ ...control, name: `roleMembers.${snapshot.roleMembers.length}.userId` }}
                />
              )}
            </Field>
          )}
          <Field
            label="Roles"
            help="Separate role names with commas. Use the same names for blocks and eligible people."
            {...form.of(
              kind === "block"
                ? `blocks.${snapshot.blocks.length}.roles`
                : `roleMembers.${snapshot.roleMembers.length}.roles`,
            )}
          >
            {(control) => (
              <TextInput
                {...control}
                name="roles"
                value={roles}
                onInput={(event) => setRoles(event.currentTarget.value)}
              />
            )}
          </Field>
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
          {kind === "block" &&
            eligibleRoles.map((role, index) => (
              <div class="pk-agenda-editor__form">
                <Field
                  label={`${role.replaceAll("_", " ")} · experience`}
                  {...form.of(`${prefix}.roleRequirements.${index}.seniority`)}
                >
                  {(control) => (
                    <Select
                      {...control}
                      name={`${prefix}.roleRequirements.${index}.seniority`}
                      value={requirements[role]?.seniority ?? "any"}
                      onChange={(event) =>
                        setRequirements({
                          ...requirements,
                          [role]: {
                            attendanceMode: requirements[role]?.attendanceMode ?? "any",
                            seniority: agendaBlockSchema.shape.roleRequirements
                              .unwrap()
                              .element.shape.seniority.unwrap()
                              .parse(event.currentTarget.value),
                          },
                        })
                      }
                    >
                      {agendaBlockSchema.shape.roleRequirements
                        .unwrap()
                        .element.shape.seniority.unwrap()
                        .options.map((value) => (
                          <option value={value}>{value === "any" ? "Any experience" : "Senior required"}</option>
                        ))}
                    </Select>
                  )}
                </Field>
                <Field
                  label={`${role.replaceAll("_", " ")} · attendance`}
                  {...form.of(`${prefix}.roleRequirements.${index}.attendanceMode`)}
                >
                  {(control) => (
                    <Select
                      {...control}
                      name={`${prefix}.roleRequirements.${index}.attendanceMode`}
                      value={requirements[role]?.attendanceMode ?? "any"}
                      onChange={(event) =>
                        setRequirements({
                          ...requirements,
                          [role]: {
                            seniority: requirements[role]?.seniority ?? "any",
                            attendanceMode: agendaBlockSchema.shape.roleRequirements
                              .unwrap()
                              .element.shape.attendanceMode.unwrap()
                              .parse(event.currentTarget.value),
                          },
                        })
                      }
                    >
                      {agendaBlockSchema.shape.roleRequirements
                        .unwrap()
                        .element.shape.attendanceMode.unwrap()
                        .options.map((value) => (
                          <option value={value}>{value === "any" ? "Any attendance mode" : value}</option>
                        ))}
                    </Select>
                  )}
                </Field>
              </div>
            ))}
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
            <Field label="Location" {...form.of(`${prefix}.roomId`)}>
              {(control) => (
                <Select
                  {...control}
                  name="roomId"
                  value={room}
                  onChange={(event) => setRoom(event.currentTarget.value)}
                >
                  <option value="">Whole event</option>
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
