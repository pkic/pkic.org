import { scannerFeedbackPauses } from "../../../../../../../shared/schemas/event-scanner-preferences";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
export function ScannerPacing({
  value,
  onChange,
  field = {},
}: {
  value: number;
  onChange: (value: (typeof scannerFeedbackPauses)[number]) => void;
  field?: FieldPresentation;
}) {
  return (
    <Field
      {...field}
      label="Feedback pause"
      help="Hold each result briefly before accepting the next badge. Skip the pause from the scanning screen."
    >
      {(control) => (
        <Select
          {...control}
          value={value}
          onChange={(event) =>
            onChange(scannerFeedbackPauses.find((duration) => String(duration) === event.currentTarget.value) ?? 1000)
          }
        >
          {scannerFeedbackPauses.map((duration) => (
            <option value={duration}>{duration === 0 ? "No pause" : `${(duration / 1000).toFixed(1)} seconds`}</option>
          ))}
        </Select>
      )}
    </Field>
  );
}
