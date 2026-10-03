import { StaffingSetup } from "./StaffingSetup";
import { useState } from "preact/hooks";
import {
  agendaAllocationSchema,
  agendaStaffingSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { postJson } from "../../../../../../shared/api-client";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Button } from "../../../../../../ui/Button";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { formatTimeRangeInZone } from "../../../../../../../shared/format-date";

export function StaffingEditor({
  snapshot,
  canEdit,
  onSaved,
}: {
  snapshot: AgendaSnapshot;
  canEdit: boolean;
  onSaved: (value: AgendaSnapshot) => void;
}) {
  const [setup, setSetup] = useState<"block" | "person" | null>(null);
  const [seed, setSeed] = useState("");
  const [strategy, setStrategy] = useState<"balanced" | "random">("balanced");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(agendaAllocationSchema, { expectedRevision: snapshot.revision, seed, strategy });
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
    } catch (e) {
      setError(form.refuse(e));
    } finally {
      setBusy(false);
    }
  }
  async function pin(blockId: string, role: string, userId: string, pinned = true) {
    setBusy(true);
    try {
      const assignments = snapshot.assignments.filter((value) => value.blockId !== blockId || value.role !== role);
      if (userId) assignments.push({ blockId, role, userId, pinned });
      onSaved(
        await postJson(
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/staffing`,
          agendaStaffingSchema.parse({
            expectedRevision: snapshot.revision,
            blocks: snapshot.blocks,
            roleMembers: snapshot.roleMembers,
            assignments,
          }),
          agendaSnapshotSchema,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to pin assignment");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title="Block roles">
        {canEdit && (
          <div class="pk-cluster">
            <Button onClick={() => setSetup("block")}>New block</Button>
            <Button onClick={() => setSetup("person")}>Add eligible person</Button>
          </div>
        )}
      </PanelHeader>
      <PanelBody>
        {setup && (
          <StaffingSetup
            key={setup}
            kind={setup}
            snapshot={snapshot}
            onSaved={onSaved}
            onClose={() => setSetup(null)}
          />
        )}
        <p>
          Allocate MC and Q&amp;A duties across the event. Pinned assignments stay fixed when generating a new rotation.
        </p>
        {error && <ErrorAlert error={error} />}{" "}
        {canEdit && (
          <form noValidate {...form.handlers} onSubmit={(event) => void allocate(event)} class="pk-cluster">
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
            <Button variant="primary" type="submit" disabled={busy}>
              Generate assignments
            </Button>
          </form>
        )}
        {!snapshot.blocks.length && (
          <p>No staffing blocks yet. Blocks and eligible people must be configured before allocation.</p>
        )}
        {snapshot.blocks.map((block) => (
          <section class="pk-stack">
            <h4>
              {block.name} · {formatTimeRangeInZone(block.startAt, block.endAt, snapshot.timeZone)}
            </h4>
            <div class="pk-grid">
              {block.roles.map((role) => {
                const assigned = snapshot.assignments.find(
                  (value) => value.blockId === block.id && value.role === role,
                );
                return (
                  <div class="pk-stack" key={`${block.id}-${role}`}>
                    <Field
                      label={role.replaceAll("_", " ")}
                      help={assigned?.pinned ? "Pinned · preserved during allocation" : "Generated assignment"}
                    >
                      {(control) => (
                        <Select
                          {...control}
                          disabled={!canEdit || busy}
                          value={assigned?.userId ?? ""}
                          onChange={(event) => void pin(block.id, role, event.currentTarget.value)}
                        >
                          <option value="">Unassigned</option>
                          {snapshot.roleMembers
                            .filter((person) => person.roles.includes(role))
                            .map((person) => (
                              <option value={person.userId}>{person.displayName}</option>
                            ))}
                        </Select>
                      )}
                    </Field>
                    {canEdit && assigned && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void pin(block.id, role, assigned.userId, !assigned.pinned)}
                      >
                        {assigned.pinned ? "Unpin assignment" : "Pin assignment"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </PanelBody>
    </Panel>
  );
}
