import {
  scanActionSchema,
  type EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";

export function scannerActionLabel(action: EventScanRequest["action"]) {
  return action === "attendance"
    ? "Record attendance"
    : action === "checkout"
      ? "Record checkout"
      : action === "lead"
        ? "Capture sponsor lead"
        : action === "admission"
          ? "Admission decision"
          : action === "exception"
            ? "Admission exception"
            : "Check registration only";
}

export function ScannerModeSelect({
  action,
  allowedActions = scanActionSchema.options,
  sponsorId,
  actionField,
  onAction,
}: {
  action: EventScanRequest["action"];
  allowedActions?: readonly EventScanRequest["action"][];
  sponsorId?: string;
  actionField: FieldPresentation;
  onAction: (value: EventScanRequest["action"]) => void;
}) {
  const modes = allowedActions.filter((value) =>
    sponsorId
      ? value === "lead"
      : value === "attendance" || value === "checkout" || value === "check" || value === "admission",
  );
  if (modes.length === 1 && modes[0] === action) return <p class="pk-muted">{scannerActionLabel(action)}</p>;
  return (
    <Field label="Scan mode" {...actionField}>
      {(control) => (
        <Select
          {...control}
          name="action"
          value={action}
          onChange={(event) => onAction(event.currentTarget.value as typeof action)}
        >
          {modes.map((value) => (
            <option value={value}>{scannerActionLabel(value)}</option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** Choose the initial purpose from a bound collector or the operator's authorized modes. */
export function scannerInitialAction(
  allowedActions: readonly EventScanRequest["action"][],
  preferred: EventScanRequest["action"] | undefined,
  sponsor: boolean,
): EventScanRequest["action"] {
  return (
    preferred ??
    (sponsor
      ? "lead"
      : allowedActions.includes("attendance")
        ? "attendance"
        : (allowedActions.find((value) => value !== "lead" && value !== "exception") ?? "check"))
  );
}
