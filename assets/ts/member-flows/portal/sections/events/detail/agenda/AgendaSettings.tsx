import { resolveAgendaDurationRules } from "../../../../../../../shared/event-agenda-duration";
import { AgendaTimeStep } from "./AgendaTimeStep";
import { useEditorFocus } from "./useEditorFocus";
import { useState } from "preact/hooks";
import {
  agendaSettingsSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { Dialog } from "../../../../../../ui/Dialog";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
export function AgendaSettings({
  snapshot,
  timeStep,
  onTimeStepChange,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  timeStep: number;
  onTimeStepChange: (minutes: number) => void;
  onSaved: (value: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const focus = useEditorFocus();
  const durationRules = resolveAgendaDurationRules(snapshot.durationRules);
  const [gridStep, setGridStep] = useState(timeStep);
  const [travel, setTravel] = useState(snapshot.travelMinutes.toString());
  const [duration, setDuration] = useState(String(durationRules.defaultMinutes));
  const [quick, setQuick] = useState(durationRules.quickMinutes.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(agendaSettingsSchema, {
    expectedRevision: snapshot.revision,
    travelMinutes: Number(travel),
    durationRules: {
      defaultMinutes: Number(duration),
      quickMinutes: quick.split(",").map((value) => Number(value.trim())),
    },
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
      const changesEventRules =
        checked.data.travelMinutes !== snapshot.travelMinutes ||
        JSON.stringify(checked.data.durationRules) !== JSON.stringify(durationRules);
      if (changesEventRules)
        onSaved(
          await postJson(
            `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/settings`,
            checked.data,
            agendaSnapshotSchema,
          ),
        );
      onTimeStepChange(gridStep);
      onClose();
    } catch (e) {
      setError(form.refuse(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title="Scheduling rules"
      confirmLabel={busy ? "Saving…" : "Save rules"}
      confirmDisabled={busy}
      onConfirm={() => focus.current?.requestSubmit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      {error && <ErrorAlert error={error} />}
      <form ref={focus} noValidate {...form.handlers} class="pk-stack" onSubmit={(event) => void save(event)}>
        <fieldset class="pk-fieldset pk-stack" disabled={busy}>
          <AgendaTimeStep value={gridStep} onChange={setGridStep} />
          <Field
            label="Speaker and staff travel time (minutes)"
            help="Required time for the same speaker or assigned staff member to change rooms. This does not set the attendee room-change allowance."
            {...form.of("travelMinutes")}
          >
            {(control) => (
              <TextInput
                {...control}
                name="travelMinutes"
                type="number"
                value={travel}
                onInput={(event) => setTravel(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field
            label="Default session duration (minutes)"
            help="Used when a proposal type has no duration configured."
            {...form.of("durationRules.defaultMinutes")}
          >
            {(control) => (
              <TextInput
                {...control}
                name="durationRules.defaultMinutes"
                type="number"
                value={duration}
                onInput={(event) => setDuration(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field
            label="Quick duration choices (minutes)"
            help="Separate choices with commas. These appear when you click a session duration."
            {...form.of("durationRules.quickMinutes")}
          >
            {(control) => (
              <TextInput
                {...control}
                name="durationRules.quickMinutes"
                value={quick}
                onInput={(event) => setQuick(event.currentTarget.value)}
              />
            )}
          </Field>
        </fieldset>
      </form>
    </Dialog>
  );
}
