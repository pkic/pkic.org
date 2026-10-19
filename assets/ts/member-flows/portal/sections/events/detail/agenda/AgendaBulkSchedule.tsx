import { useState } from "preact/hooks";
import {
  agendaScheduleProposalSchema,
  type AgendaScheduleProposal,
} from "../../../../../../../shared/schemas/event-agenda-schedule";
import { canonicalAgendaOrder } from "../../../../../../../shared/event-agenda-order";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { agendaMovedAdditionalRoomIds } from "../../../../../../../shared/event-agenda-rooms";
import { instantToDateTimeLocal, dateTimeLocalToIso } from "../../../../../../../shared/timezone";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
export function AgendaBulkSchedule({
  snapshot,
  selected,
  onProposal,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  selected: ReadonlySet<string>;
  onProposal: (proposal: AgendaScheduleProposal) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState("time"),
    [start, setStart] = useState(""),
    [day, setDay] = useState(""),
    [room, setRoom] = useState<string | null>(null),
    [error, setError] = useState("");
  const chosen = snapshot.occurrences.filter((item) => selected.has(item.id));
  const ordered = [...canonicalAgendaOrder(chosen), ...chosen.filter((item) => !item.startAt)];
  let nextStart: string | null = null;
  try {
    if (start) nextStart = dateTimeLocalToIso(start, snapshot.timeZone);
  } catch {
    /* Shared proposal validation reports an invalid instant. */
  }
  const firstStart = ordered[0]?.startAt;
  let cursor = nextStart ? Date.parse(nextStart) : 0;
  const changes = ordered.map((item) => {
    const duration = item.startAt && item.endAt ? Date.parse(item.endAt) - Date.parse(item.startAt) : 1800000;
    let startAt = item.startAt,
      endAt = item.endAt;
    if (mode === "time") {
      if (nextStart) {
        const instant =
          item.startAt && firstStart
            ? Date.parse(nextStart) + Date.parse(item.startAt) - Date.parse(firstStart)
            : cursor;
        startAt = new Date(instant).toISOString();
        endAt = new Date(instant + duration).toISOString();
        cursor = instant + duration;
      } else {
        startAt = start;
        endAt = start;
      }
    } else if (mode === "day") {
      try {
        startAt = dateTimeLocalToIso(
          `${day}T${item.startAt ? instantToDateTimeLocal(item.startAt, snapshot.timeZone).slice(11) : "09:00"}`,
          snapshot.timeZone,
        );
        endAt = new Date(Date.parse(startAt) + duration).toISOString();
      } catch {
        startAt = day;
        endAt = day;
      }
    }
    return {
      id: item.id,
      startAt,
      endAt,
      roomId: mode === "location" ? room : item.roomId,
      additionalRoomIds:
        mode === "location" ? agendaMovedAdditionalRoomIds(item, room) : (item.additionalRoomIds ?? []),
    };
  });
  const form = useContractForm(agendaScheduleProposalSchema, { expectedRevision: snapshot.revision, changes });
  return (
    <Panel>
      <PanelHeader title={`Move ${chosen.length} selected sessions`} />
      <PanelBody>
        <p>
          Selections remain stable across pages and filters. Review all affected sessions before applying. Times in{" "}
          {snapshot.timeZone}.
        </p>
        {error && <ErrorAlert error={error} />}
        <form
          noValidate
          {...form.handlers}
          class="pk-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const checked = form.submit();
            if (checked.data) onProposal(checked.data);
            else setError(checked.message);
          }}
        >
          <Field label="Bulk change">
            {(control) => (
              <Select
                {...control}
                name="bulkMode"
                value={mode}
                onChange={(event) => setMode(event.currentTarget.value)}
              >
                <option value="time">Move start time, preserving spacing</option>
                <option value="day">Move to another day, preserving local times</option>
                <option value="location">Change primary location</option>
              </Select>
            )}
          </Field>
          {mode === "time" && (
            <Field label="First session starts" required {...form.of("changes")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="changes"
                  type="datetime-local"
                  value={start}
                  onInput={(event) => setStart(event.currentTarget.value)}
                />
              )}
            </Field>
          )}
          {mode === "day" && (
            <Field label="New day" required {...form.of("changes")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="changes"
                  type="date"
                  value={day}
                  onInput={(event) => setDay(event.currentTarget.value)}
                />
              )}
            </Field>
          )}
          {mode === "location" && (
            <Field label="New location" {...form.of("changes")}>
              {(control) => (
                <Select
                  {...control}
                  name="changes"
                  value={room ?? ""}
                  onChange={(event) => setRoom(event.currentTarget.value || null)}
                >
                  <option value="">Across all locations</option>
                  {snapshot.rooms.map((item) => (
                    <option value={item.id}>{item.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <div class="pk-cluster pk-cluster--end">
            <Button type="button" onClick={onClose}>
              Cancel bulk move
            </Button>
            <Button type="submit" variant="primary">
              Review selected sessions
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
