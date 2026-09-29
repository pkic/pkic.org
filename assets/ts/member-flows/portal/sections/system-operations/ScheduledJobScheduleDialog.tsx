import { useState } from "preact/hooks";
import {
  schedulerJobScheduleUpdateSchema,
  schedulerJobStateResponseSchema,
  type ScheduledJobResource,
} from "../../../../../shared/schemas/scheduler";
import { useContractForm } from "../../../../hooks/useContractForm";
import { patchJson } from "../../../../shared/api-client";
import { Dialog } from "../../../../ui/Dialog";
import { Field } from "../../../../ui/Field";
import { TextInput } from "../../../../ui/TextControl";
import { Alert } from "../../../../ui/Alert";

export function ScheduledJobScheduleDialog({
  job,
  onCancel,
  onSaved,
}: {
  job: ScheduledJobResource;
  onCancel: () => void;
  onSaved: (job: ScheduledJobResource) => void;
}) {
  const [minutes, setMinutes] = useState(String(job.intervalSeconds / 60));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(schedulerJobScheduleUpdateSchema, {
    intervalSeconds: Number(minutes) * 60,
    expectedIntervalSeconds: job.intervalSeconds,
  });
  async function save() {
    if (busy) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    try {
      const result = await patchJson(
        `/api/v1/scheduler/jobs/${encodeURIComponent(job.jobKey)}/schedule`,
        checked.data,
        schedulerJobStateResponseSchema,
      );
      onSaved(result.job);
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title="Edit job schedule"
      description="The interval applies after the next run. Domain deadlines and retry backoff still control when work is due."
      confirmLabel="Save schedule"
      confirmDisabled={busy}
      onConfirm={() => void save()}
      onCancel={onCancel}
    >
      <form
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Interval (minutes)" help="From 1 minute to 30 days." {...form.of("intervalSeconds")}>
          {(control) => (
            <TextInput
              {...control}
              name="intervalSeconds"
              type="number"
              value={minutes}
              disabled={busy}
              onInput={(event) => setMinutes(event.currentTarget.value)}
            />
          )}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
