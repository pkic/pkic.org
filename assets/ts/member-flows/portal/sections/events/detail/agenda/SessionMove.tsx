import { resolveAgendaDurationRules } from "../../../../../../../shared/event-agenda-duration";
import { formatNumber } from "../../../../../../../shared/format-number";
import { agendaScheduleProposalSchema } from "../../../../../../../shared/schemas/event-agenda-schedule";
import { agendaMovedAdditionalRoomIds } from "../../../../../../../shared/event-agenda-rooms";
import { useEditorFocus } from "./useEditorFocus";
import { useState } from "preact/hooks";
import type { AgendaSnapshot, AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import { instantToDateTimeLocal, dateTimeLocalToIso } from "../../../../../../../shared/timezone";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Select } from "../../../../../../ui/TextControl";
import { Dialog } from "../../../../../../ui/Dialog";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import type { useAgendaScheduling } from "./useAgendaScheduling";

/** Choose a destination, then commit the guarded move without leaving the calendar. */
export function SessionMove({
  snapshot,
  session,
  onApply,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  session: AgendaOccurrence;
  onApply: ReturnType<typeof useAgendaScheduling>["apply"];
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const [start, setStart] = useState(session.startAt ? instantToDateTimeLocal(session.startAt, snapshot.timeZone) : "");
  const [room, setRoom] = useState(session.roomId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const duration =
    session.startAt && session.endAt
      ? Date.parse(session.endAt) - Date.parse(session.startAt)
      : resolveAgendaDurationRules(snapshot.durationRules).defaultMinutes * 60000;
  let startAt = start,
    endAt = start;
  try {
    startAt = dateTimeLocalToIso(start, snapshot.timeZone);
    endAt = new Date(Date.parse(startAt) + duration).toISOString();
  } catch {
    /* The canonical form reports invalid local times. */
  }
  const form = useContractForm(agendaScheduleProposalSchema, {
    expectedRevision: snapshot.revision,
    changes: [
      {
        id: session.id,
        startAt,
        endAt,
        roomId: room || null,
        additionalRoomIds: agendaMovedAdditionalRoomIds(session, room || null),
      },
    ],
  });
  async function move(event: Event) {
    event.preventDefault();
    if (busy) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await onApply(checked.data);
      if (result.saved) onClose();
      else setError(result.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The session could not be moved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={`Move ${session.title}`}
      confirmLabel={busy ? "Moving…" : "Move session"}
      confirmDisabled={busy}
      onConfirm={() => focus.current?.requestSubmit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        Choose the day, time and location. The {formatNumber(duration / 60000)}-minute duration stays the same. Times in{" "}
        {snapshot.timeZone}.
      </p>
      {error && <ErrorAlert error={error} />}
      <form ref={focus} noValidate {...form.handlers} onSubmit={(event) => void move(event)} class="pk-stack">
        <fieldset disabled={busy} class="pk-fieldset pk-stack">
          <Field label="New day and start time" required {...form.of("changes.0.startAt")}>
            {(control) => (
              <TextInput
                {...control}
                name="changes.0.startAt"
                type="datetime-local"
                value={start}
                onInput={(event) => setStart(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="New location" {...form.of("changes.0.roomId")}>
            {(control) => (
              <Select
                {...control}
                name="changes.0.roomId"
                value={room}
                onChange={(event) => setRoom(event.currentTarget.value)}
              >
                <option value="">{session.kind === "break" ? "All locations" : "No location assigned"}</option>
                {snapshot.rooms.map((value) => (
                  <option value={value.id}>{value.name}</option>
                ))}
              </Select>
            )}
          </Field>
        </fieldset>
      </form>
    </Dialog>
  );
}
