import { Checkbox } from "../../../../../../ui/Checkbox";
import { useState } from "preact/hooks";
import {
  eventScanRequestSchema,
  type EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
export function ScannerExceptionReview({
  request,
  canRecordAttendance = true,
  onConfirm,
  onCancel,
}: {
  request: EventScanRequest;
  canRecordAttendance?: boolean;
  onConfirm: (request: EventScanRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<NonNullable<EventScanRequest["exceptionReason"]>>("organizer_approval");
  const [recordAttendance, setRecordAttendance] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const form = useContractForm(eventScanRequestSchema, { ...request, exceptionReason: reason, recordAttendance });
  async function submit(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm(checked.data);
      onCancel();
    } catch {
      setError("The exception observation could not be saved. Retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form noValidate {...form.handlers} onSubmit={submit} class="pk-stack">
      <p>
        Review the last badge and submit an admission exception for a server decision.{" "}
        {canRecordAttendance ? "Attendance is recorded only if you select it below." : "Attendance is not recorded."}{" "}
        This does not reserve a place.
      </p>
      <Field label="Exception reason" {...form.of("exceptionReason")}>
        {(control) => (
          <Select
            {...control}
            name="exceptionReason"
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value as typeof reason)}
          >
            {eventScanRequestSchema.shape.exceptionReason.unwrap().options.map((value) => (
              <option value={value}>{value.replaceAll("_", " ")}</option>
            ))}
          </Select>
        )}
      </Field>
      {canRecordAttendance && (
        <Field label="Attendance" {...form.of("recordAttendance")} group>
          {(control) => (
            <Checkbox
              {...control}
              name="recordAttendance"
              checked={recordAttendance}
              onChange={(event) => setRecordAttendance(event.currentTarget.checked)}
              label="Also record observed attendance"
            />
          )}
        </Field>
      )}
      {error && <ErrorAlert error={error} />}
      <div class="pk-cluster">
        <Button type="submit" disabled={busy}>
          Confirm admission exception
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
export function scannerExceptionRequest(
  context: {
    operatorUserId: string;
    deviceId: string;
    targetId: string | null;
    roomId: string | null;
  },
  badgeId: string,
): EventScanRequest | null {
  const parsed = eventScanRequestSchema.safeParse({
    operatorUserId: context.operatorUserId,
    deviceId: context.deviceId,
    occurrenceId: context.targetId,
    roomId: context.roomId,
    badgeId,
    operationId: crypto.randomUUID(),
    action: "exception",
    exceptionReason: "organizer_approval",
    observedAt: new Date().toISOString(),
  });
  return parsed.success ? parsed.data : null;
}
