import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
export function ScannerPacing({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <Field
      label="Feedback pause"
      help="Hold each result briefly before accepting the next badge. Skip the pause from the scanning screen."
    >
      {(control) => (
        <Select {...control} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))}>
          {[0, 300, 600, 1000].map((duration) => (
            <option value={duration}>{duration === 0 ? "No pause" : `${(duration / 1000).toFixed(1)} seconds`}</option>
          ))}
        </Select>
      )}
    </Field>
  );
}
