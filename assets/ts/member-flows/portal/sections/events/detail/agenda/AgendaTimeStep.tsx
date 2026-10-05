import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { formatNumber } from "../../../../../../../shared/format-number";
import { agendaTimeSteps } from "./schedule-time-controls";
export function AgendaTimeStep({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  return (
    <Field
      label="Scheduling time step"
      help="Board targets snap to this grid. Move and resize actions use this step; precisely typed times remain exact until you explicitly snap them."
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
