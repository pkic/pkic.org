import { useState } from "preact/hooks";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { agendaStaffingSchema } from "../../../../../../../shared/schemas/event-agenda";
import { agendaStaffingRequirementSchema } from "../../../../../../../shared/schemas/event-agenda-staffing-positions";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useStaffingSave } from "./useStaffingSave";
import type { z } from "zod";

const experienceLabels: Record<z.infer<typeof agendaStaffingRequirementSchema>["seniority"], string> = {
  any: "Any experience",
  senior: "Senior required",
};
const attendanceLabels: Record<z.infer<typeof agendaStaffingRequirementSchema>["attendanceMode"], string> = {
  any: "Any attendance mode",
  physical: "Physical",
  remote: "Remote",
};

export function StaffingRequirements({
  snapshot,
  shiftId,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  shiftId: string;
  onSaved: (next: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const [requirements, setRequirements] = useState(
    snapshot.staffingRequirements.filter((row) => row.shiftId === shiftId),
  );
  const [positions, setPositions] = useState(snapshot.staffingPositions);
  const other = snapshot.staffingRequirements.filter((row) => row.shiftId !== shiftId);
  const all = [...other, ...requirements];
  const kept = new Set(positions.map((row) => row.id));
  const body = {
    expectedRevision: snapshot.revision,
    shifts: snapshot.shifts.map((shift) =>
      shift.id === shiftId ? { ...shift, roles: [...new Set(requirements.map((row) => row.roleId))] } : shift,
    ),
    roleMembers: snapshot.roleMembers,
    assignments: snapshot.assignments
      .filter((row) => kept.has(row.positionId))
      .map((row) => {
        const position = positions.find((item) => item.id === row.positionId);
        const requirement = all.find((item) => item.id === position?.requirementId);
        return requirement
          ? { ...row, shiftId: requirement.shiftId, role: requirement.roleId, postId: requirement.postId }
          : row;
      }),
    staffingRoles: snapshot.staffingRoles,
    staffingPosts: snapshot.staffingPosts,
    staffingRequirements: all,
    staffingPositions: positions,
  };
  const form = useContractForm(agendaStaffingSchema, body);
  function update(id: string, patch: Partial<z.infer<typeof agendaStaffingRequirementSchema>>) {
    setRequirements(requirements.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    if (
      patch.idealCount !== undefined &&
      Number.isInteger(patch.idealCount) &&
      patch.idealCount >= 1 &&
      patch.idealCount <= 50
    ) {
      const current = positions.filter((row) => row.requirementId === id);
      const wanted = Array.from(
        { length: patch.idealCount },
        (_, index) =>
          current.find((row) => row.index === index + 1) ?? {
            id: crypto.randomUUID(),
            requirementId: id,
            index: index + 1,
          },
      );
      setPositions([...positions.filter((row) => row.requirementId !== id), ...wanted]);
    }
  }
  const { busy, error, save } = useStaffingSave(snapshot.eventSlug, form, onSaved, onClose);
  return (
    <Panel>
      <PanelHeader
        title={`Staffing needs · ${snapshot.shifts.find((shift) => shift.id === shiftId)?.name ?? "Shift"}`}
      />
      <PanelBody>
        <p>
          Choose an ideal number of people for each duty and post. Unfilled positions remain visible while planning.
          Reducing a count removes assignments in the removed positions.
        </p>
        {error && <ErrorAlert error={error} />}
        <form noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => void save(event)}>
          {requirements.map((row, localIndex) => {
            const prefix = `staffingRequirements.${other.length + localIndex}`;
            return (
              <div class="pk-grid" key={row.id}>
                <Field label="Duty role" {...form.of(`${prefix}.roleId`)}>
                  {(control) => (
                    <Select
                      {...control}
                      name={`${prefix}.roleId`}
                      value={row.roleId}
                      onChange={(event) => update(row.id, { roleId: event.currentTarget.value })}
                    >
                      {snapshot.staffingRoles.map((role) => (
                        <option value={role.id}>{role.name}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Duty post" {...form.of(`${prefix}.postId`)}>
                  {(control) => (
                    <Select
                      {...control}
                      name={`${prefix}.postId`}
                      value={row.postId ?? ""}
                      onChange={(event) => update(row.id, { postId: event.currentTarget.value || null })}
                    >
                      <option value="">Shift location</option>
                      {snapshot.staffingPosts.map((post) => (
                        <option value={post.id}>{post.name}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Ideal headcount" {...form.of(`${prefix}.idealCount`)}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name={`${prefix}.idealCount`}
                      type="number"
                      min={1}
                      max={50}
                      value={row.idealCount}
                      onInput={(event) => update(row.id, { idealCount: Number(event.currentTarget.value) })}
                    />
                  )}
                </Field>
                <Field label="Required experience" {...form.of(`${prefix}.seniority`)}>
                  {(control) => (
                    <Select
                      {...control}
                      name={`${prefix}.seniority`}
                      value={row.seniority}
                      onChange={(event) =>
                        update(row.id, {
                          seniority: agendaStaffingRequirementSchema.shape.seniority.parse(event.currentTarget.value),
                        })
                      }
                    >
                      {agendaStaffingRequirementSchema.shape.seniority.unwrap().options.map((value) => (
                        <option value={value}>{experienceLabels[value]}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Duty attendance mode" {...form.of(`${prefix}.attendanceMode`)}>
                  {(control) => (
                    <Select
                      {...control}
                      name={`${prefix}.attendanceMode`}
                      value={row.attendanceMode}
                      onChange={(event) =>
                        update(row.id, {
                          attendanceMode: agendaStaffingRequirementSchema.shape.attendanceMode.parse(
                            event.currentTarget.value,
                          ),
                        })
                      }
                    >
                      {agendaStaffingRequirementSchema.shape.attendanceMode.unwrap().options.map((value) => (
                        <option value={value}>{attendanceLabels[value]}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div class="pk-cluster">
                  <Button
                    type="button"
                    onClick={() => {
                      setRequirements(requirements.filter((item) => item.id !== row.id));
                      setPositions(positions.filter((item) => item.requirementId !== row.id));
                    }}
                  >
                    Remove duty requirement
                  </Button>
                </div>
              </div>
            );
          })}
          <div class="pk-cluster">
            <Button
              type="button"
              disabled={!snapshot.staffingRoles.length}
              onClick={() => {
                const id = crypto.randomUUID();
                setRequirements([
                  ...requirements,
                  {
                    id,
                    shiftId,
                    roleId: snapshot.staffingRoles[0]!.id,
                    postId: null,
                    idealCount: 1,
                    seniority: "any",
                    attendanceMode: "any",
                  },
                ]);
                setPositions([...positions, { id: crypto.randomUUID(), requirementId: id, index: 1 }]);
              }}
            >
              Add duty requirement
            </Button>
          </div>
          {!snapshot.staffingRoles.length && <p>Configure event roles before adding a duty requirement.</p>}
          <div class="pk-cluster pk-cluster--end">
            <Button disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Save staffing needs
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
