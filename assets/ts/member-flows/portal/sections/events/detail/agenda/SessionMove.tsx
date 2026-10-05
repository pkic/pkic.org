import { AgendaTimeStep } from "./AgendaTimeStep";
import { adjustAgendaStart, snapAgendaStart } from "./schedule-time-controls";
import { formatNumber } from "../../../../../../../shared/format-number";
import { AgendaSchedulePreview } from "./AgendaSchedulePreview";
import {
  agendaScheduleProposalSchema,
  type AgendaScheduleProposal,
} from "../../../../../../../shared/schemas/event-agenda-schedule";
import { agendaMovedAdditionalRoomIds } from "../../../../../../../shared/event-agenda-rooms";
import { useEditorFocus } from "./useEditorFocus";
import { useState } from "preact/hooks";
import {
  agendaOccurrencePatchSchema,
  type AgendaSnapshot,
  type AgendaOccurrence,
} from "../../../../../../../shared/schemas/event-agenda";
import { instantToDateTimeLocal, dateTimeLocalToIso } from "../../../../../../../shared/timezone";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
export function SessionMove({
  snapshot,
  session,
  onSaved,
  onClose,
  timeStep: configuredStep,
  onTimeStep,
}: {
  timeStep?: number;
  onTimeStep?: (minutes: number) => void;
  snapshot: AgendaSnapshot;
  session: AgendaOccurrence;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const [start, setStart] = useState(session.startAt ? instantToDateTimeLocal(session.startAt, snapshot.timeZone) : "");
  const [localStep, setLocalStep] = useState<number>(5);
  const timeStep = configuredStep ?? localStep;
  const setTimeStep = onTimeStep ?? setLocalStep;
  const [room, setRoom] = useState(session.roomId ?? "");
  const [proposal, setProposal] = useState<AgendaScheduleProposal | null>(null);
  const [error, setError] = useState("");
  const duration = session.startAt && session.endAt ? Date.parse(session.endAt) - Date.parse(session.startAt) : 1800000;
  let startAt = "";
  let endAt = "";
  try {
    if (start) {
      startAt = dateTimeLocalToIso(start, snapshot.timeZone);
      endAt = new Date(Date.parse(startAt) + duration).toISOString();
    }
  } catch {
    startAt = start;
    endAt = start;
  }
  const form = useContractForm(agendaOccurrencePatchSchema, {
    expectedRevision: snapshot.revision,
    startAt,
    endAt,
    roomId: room || null,
    additionalRoomIds: agendaMovedAdditionalRoomIds(session, room || null),
  });
  function adjustTime(direction: -1 | 0 | 1) {
    try {
      setStart(
        direction === 0
          ? snapAgendaStart(start, snapshot.timeZone, timeStep)
          : adjustAgendaStart(start, snapshot.timeZone, direction * timeStep),
      );
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Enter a valid start time first.");
    }
  }
  async function move(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setProposal(
      agendaScheduleProposalSchema.parse({
        expectedRevision: snapshot.revision,
        changes: [
          {
            id: session.id,
            startAt: checked.data.startAt,
            endAt: checked.data.endAt,
            roomId: checked.data.roomId,
            additionalRoomIds: checked.data.additionalRoomIds,
          },
        ],
      }),
    );
  }
  if (proposal)
    return (
      <AgendaSchedulePreview
        snapshot={snapshot}
        proposal={proposal}
        onSaved={onSaved}
        onClose={() => {
          setProposal(null);
          onClose();
        }}
      />
    );
  return (
    <Panel>
      <PanelHeader title={`Move ${session.title}`} />
      <PanelBody>
        <p>
          Choose any day, start time, and location. This session keeps its {formatNumber(duration / 60000)}-minute
          duration. Times in {snapshot.timeZone}.
        </p>
        {error && <ErrorAlert error={error} />}
        <form ref={focus} noValidate {...form.handlers} onSubmit={(event) => void move(event)} class="pk-stack">
          <Field label="New day and start time" required {...form.of("startAt")}>
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
          <AgendaTimeStep value={timeStep} onChange={setTimeStep} />
          <div class="pk-cluster">
            <Button type="button" disabled={!start} onClick={() => adjustTime(-1)}>
              Earlier by {formatNumber(timeStep)} minutes
            </Button>
            <Button type="button" disabled={!start} onClick={() => adjustTime(1)}>
              Later by {formatNumber(timeStep)} minutes
            </Button>
            <Button type="button" disabled={!start} onClick={() => adjustTime(0)}>
              Snap start to {formatNumber(timeStep)}-minute grid
            </Button>
          </div>
          <Field label="New location" {...form.of("roomId")}>
            {(control) => (
              <Select {...control} name="roomId" value={room} onChange={(event) => setRoom(event.currentTarget.value)}>
                <option value="">Across all locations</option>
                {snapshot.rooms.map((value) => (
                  <option value={value.id}>{value.name}</option>
                ))}
              </Select>
            )}
          </Field>
          <div class="pk-cluster pk-cluster--end">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary">
              Review move
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
