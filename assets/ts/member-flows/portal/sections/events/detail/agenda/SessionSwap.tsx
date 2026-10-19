import { scheduleSwap } from "./schedule-proposals";
import { agendaScheduleSwapSelectionSchema } from "../../../../../../../shared/schemas/event-agenda-schedule";
import { useEditorFocus } from "./useEditorFocus";
import { useState } from "preact/hooks";
import type { AgendaSnapshot, AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { Dialog } from "../../../../../../ui/Dialog";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import type { useAgendaScheduling } from "./useAgendaScheduling";

/** Swap the selected pair through the same reviewed atomic scheduling command. */
export function SessionSwap({
  snapshot,
  first,
  onApply,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  first: AgendaOccurrence;
  onApply: ReturnType<typeof useAgendaScheduling>["apply"];
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const [secondId, setSecond] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(agendaScheduleSwapSelectionSchema, {
    expectedRevision: snapshot.revision,
    firstId: first.id,
    secondId,
  });
  async function swap(event: Event) {
    event.preventDefault();
    if (busy) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    const second = snapshot.occurrences.find((item) => item.id === checked.data.secondId);
    if (!second) {
      setError("Choose a session from the agenda.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await onApply(scheduleSwap(snapshot, first, second));
      if (result.saved) onClose();
      else setError(result.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The sessions could not be swapped.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={`Swap ${first.title}`}
      confirmLabel={busy ? "Swapping…" : "Swap sessions"}
      confirmDisabled={busy}
      onConfirm={() => focus.current?.requestSubmit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        Exchange the start time and locations. Each session keeps its duration; both moves must pass conflict checks.
      </p>
      {error && <ErrorAlert error={error} />}
      <form ref={focus} noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => void swap(event)}>
        <Field label="Swap with session" required {...form.of("secondId")}>
          {(control) => (
            <Select
              {...control}
              name="secondId"
              disabled={busy}
              value={secondId}
              onChange={(event) => setSecond(event.currentTarget.value)}
            >
              <option value="">Choose a session</option>
              {snapshot.occurrences
                .filter((value) => value.id !== first.id && value.startAt && value.endAt)
                .map((value) => (
                  <option value={value.id}>{value.title}</option>
                ))}
            </Select>
          )}
        </Field>
      </form>
    </Dialog>
  );
}
