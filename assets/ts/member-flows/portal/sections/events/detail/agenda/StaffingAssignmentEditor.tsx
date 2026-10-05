import { useState } from "preact/hooks";
import {
  agendaSnapshotSchema,
  agendaStaffingSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { formatNumber } from "../../../../../../../shared/format-number";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { DescriptionList } from "../../../../../../ui/DescriptionList";

export function StaffingAssignmentEditor({
  snapshot,
  positionId,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  positionId: string;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const position = snapshot.staffingPositions.find((row) => row.id === positionId)!;
  const requirement = snapshot.staffingRequirements.find((row) => row.id === position.requirementId)!;
  const existing = snapshot.assignments.find((row) => row.positionId === positionId);
  const [userId, setUser] = useState(existing?.userId ?? "");
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const assignments = snapshot.assignments.filter((row) => row.positionId !== positionId);
  if (userId)
    assignments.push({
      positionId,
      blockId: requirement.blockId,
      role: requirement.roleId,
      postId: requirement.postId,
      userId,
      pinned,
      origin: existing?.userId === userId ? existing.origin : "manual",
    });
  const form = useContractForm(agendaStaffingSchema, {
    expectedRevision: snapshot.revision,
    blocks: snapshot.blocks,
    roleMembers: snapshot.roleMembers,
    assignments,
    staffingRoles: snapshot.staffingRoles,
    staffingPosts: snapshot.staffingPosts,
    staffingRequirements: snapshot.staffingRequirements,
    staffingPositions: snapshot.staffingPositions,
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
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/staffing`,
          checked.data,
          agendaSnapshotSchema,
        ),
      );
      onClose();
    } catch (failure) {
      setError(form.refuse(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title={`Edit assignment · position ${formatNumber(position.index)}`}>
        <Button disabled={busy} onClick={onClose}>
          Back to staffing
        </Button>
      </PanelHeader>
      <PanelBody>
        <DescriptionList
          items={[
            { term: "Block", value: snapshot.blocks.find((row) => row.id === requirement.blockId)?.name },
            { term: "Role", value: snapshot.staffingRoles.find((row) => row.id === requirement.roleId)?.name },
            {
              term: "Post",
              value: snapshot.staffingPosts.find((row) => row.id === requirement.postId)?.name ?? "Event",
            },
          ]}
        />
        <form noValidate {...form.handlers} onSubmit={save} class="pk-stack">
          <Field label="Assigned person" {...form.of("assignments")}>
            {(control) => (
              <Select
                {...control}
                name="assignedPerson"
                value={userId}
                disabled={busy}
                onChange={(event) => setUser(event.currentTarget.value)}
              >
                <option value="">Unassigned</option>
                {snapshot.roleMembers
                  .filter((person) => person.roles.includes(requirement.roleId))
                  .map((person) => (
                    <option value={person.userId}>{person.displayName}</option>
                  ))}
              </Select>
            )}
          </Field>
          <Checkbox
            name="pinned"
            label="Pin assignment during rotation"
            checked={pinned}
            disabled={busy || !userId}
            onChange={(event) => setPinned(event.currentTarget.checked)}
          />
          {error && <ErrorAlert error={error} />}
          <div class="pk-cluster pk-cluster--end">
            <Button disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Save assignment
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
