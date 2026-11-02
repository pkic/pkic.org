import { useState } from "preact/hooks";
import { eventAttendanceRegistrationsQuerySchema } from "../../../shared/schemas/event-registrations";
import { useContractForm } from "../../hooks/useContractForm";
import { viewerTimeZone } from "../../../shared/timezone";
import { instantFromLocal, localFromInstant } from "../forms/SubmissionWindowFields";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";

const sinceSchema = eventAttendanceRegistrationsQuerySchema.pick({ created_since: true }).required();

export function RegistrationSinceDialog({
  value,
  onApply,
  onClose,
}: {
  value?: string;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const zone = viewerTimeZone();
  const [local, setLocal] = useState(() => localFromInstant(value ?? null, zone));
  const form = useContractForm(sinceSchema, { created_since: instantFromLocal(local, zone) ?? "" });
  function apply() {
    const result = form.submit();
    if (!result.data) return;
    onApply(result.data.created_since);
    onClose();
  }
  return (
    <Dialog open title="Registered since" confirmLabel="Apply filter" onConfirm={apply} onCancel={onClose}>
      <form
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <Field label="Start date and time" help={`Your time (${zone})`} {...form.of("created_since")}>
          {(control) => (
            <TextInput
              {...control}
              name="created_since"
              type="datetime-local"
              value={local}
              onInput={(event) => setLocal(event.currentTarget.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
