import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { formatNumber } from "../../../../../../../shared/format-number";
import { agendaTimeSteps } from "./schedule-time-controls";
export function AgendaTimeStep({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  return (
    <Field
      label="Calendar grid spacing"
      help="Sets the visible grid and snapping for moves and resizing. Existing session times stay unchanged."
    >
      {(control) => (
        <Select
          {...control}
          name="timeStep"
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        >
          {agendaTimeSteps.map((minutes) => (
            <option value={minutes}>{formatNumber(minutes)} minutes</option>
          ))}
        </Select>
      )}
    </Field>
  );
}
