import { RowActions } from "../../../../../../ui/RowActions";
import { StaffingOverview } from "./StaffingOverview";
import { StaffingAssignmentEditor } from "./StaffingAssignmentEditor";
import { StaffingCatalog } from "./StaffingCatalog";
import { StaffingRequirements } from "./StaffingRequirements";
import { formatNumber } from "../../../../../../../shared/format-number";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { StaffingSetup } from "./StaffingSetup";
import { useState } from "preact/hooks";
import {
  agendaAllocationSchema,
  agendaAllocationDiagnosticsSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { agendaStaffingReasonLabels } from "../../../../../../../shared/event-agenda-staffing";
import { postJson, ApiClientError } from "../../../../../../shared/api-client";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Button } from "../../../../../../ui/Button";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";

export function StaffingEditor({
  snapshot,
  canEdit,
  onSaved,
}: {
  snapshot: AgendaSnapshot;
  canEdit: boolean;
  onSaved: (value: AgendaSnapshot) => void;
}) {
  const [assignment, setAssignment] = useState<string | null>(null);
  const [catalog, setCatalog] = useState(false);
  const [rotation, setRotation] = useState(false);
  const [message, setMessage] = useState("");
  const [needs, setNeeds] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ kind: "block" | "person"; editId?: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<import("zod").infer<typeof agendaAllocationDiagnosticsSchema> | null>(
    null,
  );
  const [seed, setSeed] = useState("");
  const [strategy, setStrategy] = useState<"balanced" | "random">("balanced");
  const [selectedBlockIds, setSelectedBlocks] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(agendaAllocationSchema, {
    expectedRevision: snapshot.revision,
    seed,
    strategy,
    blockIds: selectedBlockIds ?? undefined,
  });
  async function allocate(event: Event) {
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
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/allocations`,
          checked.data,
          agendaSnapshotSchema,
        ),
      );
      setError("");
      setDiagnostics(null);
      setRotation(false);
      setMessage("Assignments generated. Review the staffing plan and any unfilled positions below.");
    } catch (e) {
      const details = agendaAllocationDiagnosticsSchema.safeParse(e instanceof ApiClientError ? e.details : null);
      setDiagnostics(details.success ? details.data : null);
      setError(form.refuse(e));
    } finally {
      setBusy(false);
    }
  }
  const allocationDiagnostics = diagnostics && (
    <ul>
      {diagnostics.uncovered.map((item) => (
        <li>
          {snapshot.blocks.find((block) => block.id === item.blockId)?.name} ·{" "}
          {snapshot.staffingRoles.find((role) => role.id === item.role)?.name ?? item.role}:{" "}
          {item.reasons.length
            ? item.reasons
                .map((reason) => `${agendaStaffingReasonLabels[reason.reason]} (${formatNumber(reason.people)})`)
                .join("; ")
            : "No eligible people configured"}
        </li>
      ))}
    </ul>
  );
  if (assignment && canEdit)
    return (
      <StaffingAssignmentEditor
        key={assignment}
        snapshot={snapshot}
        positionId={assignment}
        onSaved={onSaved}
        onClose={() => setAssignment(null)}
      />
    );
  if (catalog) return <StaffingCatalog snapshot={snapshot} onSaved={onSaved} onClose={() => setCatalog(false)} />;
  if (needs)
    return (
      <StaffingRequirements snapshot={snapshot} blockId={needs} onSaved={onSaved} onClose={() => setNeeds(null)} />
    );
  if (setup)
    return (
      <StaffingSetup
        key={`${setup.kind}:${setup.editId ?? "new"}`}
        kind={setup.kind}
        editId={setup.editId}
        snapshot={snapshot}
        onSaved={onSaved}
        onClose={() => setSetup(null)}
      />
    );
  if (rotation && canEdit)
    return (
      <Panel>
        <PanelHeader title="Configure rotation" />
        <PanelBody>
          <p>
            Choose a repeatable rotation and the blocks to regenerate. Generating applies the new assignments to the
            staffing plan.
          </p>
          {error && <ErrorAlert error={error} />}
          {diagnostics && (
            <p>
              {formatNumber(diagnostics.uncovered.length)} positions could not be assigned. Review eligible people and
              pinned duties.
            </p>
          )}
          {allocationDiagnostics}
          <form noValidate {...form.handlers} onSubmit={(event) => void allocate(event)} class="pk-stack">
            <Field label="Allocation style" {...form.of("strategy")}>
              {(control) => (
                <Select
                  {...control}
                  name="strategy"
                  value={strategy}
                  onChange={(event) =>
                    setStrategy(agendaAllocationSchema.shape.strategy.parse(event.currentTarget.value))
                  }
                >
                  {agendaAllocationSchema.shape.strategy.unwrap().options.map((value) => (
                    <option value={value}>
                      {value === "balanced" ? "Balanced rotation" : "Fair randomized rotation"}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Rotation seed"
              help="Use a different value to generate another saved rotation."
              {...form.of("seed")}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="seed"
                  value={seed}
                  onInput={(event) => setSeed(event.currentTarget.value)}
                />
              )}
            </Field>
            <fieldset>
              <legend>Blocks to regenerate</legend>
              <p>Pinned assignments stay fixed. Other blocks retain their current assignments.</p>
              {snapshot.blocks.map((block) => (
                <Checkbox
                  label={`Regenerate ${block.name}`}
                  checked={selectedBlockIds === null || selectedBlockIds.includes(block.id)}
                  disabled={busy}
                  onChange={(event) => {
                    const current = selectedBlockIds ?? snapshot.blocks.map((value) => value.id);
                    setSelectedBlocks(
                      event.currentTarget.checked ? [...current, block.id] : current.filter((id) => id !== block.id),
                    );
                  }}
                />
              ))}
            </fieldset>
            <div class="pk-cluster pk-cluster--end">
              <Button disabled={busy} onClick={() => setRotation(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={busy}>
                Generate assignments
              </Button>
            </div>
          </form>
        </PanelBody>
      </Panel>
    );
  return (
    <Panel>
      <PanelHeader title="Event staffing">
        {canEdit && (
          <RowActions
            subject="Event staffing"
            actions={[
              {
                id: "rotation",
                label: "Configure rotation",
                onSelect: () => {
                  setRotation(true);
                  setError("");
                  setDiagnostics(null);
                  setMessage("");
                },
              },
              { id: "catalog", label: "Roles and posts", onSelect: () => setCatalog(true) },
              { id: "block", label: "New block", onSelect: () => setSetup({ kind: "block" }) },
              { id: "person", label: "Add eligible person", onSelect: () => setSetup({ kind: "person" }) },
            ]}
          />
        )}
      </PanelHeader>
      <PanelBody>
        <p>
          Allocate configured duties and posts across the event. Pinned assignments stay fixed when generating a new
          rotation.
        </p>
        {error && <ErrorAlert error={error} />}
        {message && <p role="status">{message}</p>}
        {allocationDiagnostics}
        <StaffingOverview
          snapshot={snapshot}
          canEdit={canEdit}
          editBlock={(editId) => setSetup({ kind: "block", editId })}
          editPerson={(editId) => setSetup({ kind: "person", editId })}
          editNeeds={setNeeds}
          editAssignment={setAssignment}
        />
      </PanelBody>
    </Panel>
  );
}
