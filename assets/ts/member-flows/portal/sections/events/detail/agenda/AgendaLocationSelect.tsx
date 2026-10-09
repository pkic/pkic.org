import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Checkbox } from "../../../../../../ui/Checkbox";

/**
 * Session, break and location dialogs choose locations from one compact checkbox list.
 *
 * `null` is the global "all locations" scope a break may keep, including locations added later;
 * every other choice is the fixed list of ticked rooms, in the event's room order.
 */
export function AgendaLocationSelect({
  rooms,
  value,
  onChange,
  globalAll = false,
  name = "roomIds",
  help,
  ...validation
}: FieldPresentation & {
  rooms: AgendaSnapshot["rooms"];
  value: string[] | null;
  onChange: (roomIds: string[] | null) => void;
  globalAll?: boolean;
  name?: string;
  help?: string;
}) {
  const chosen = value ?? rooms.map((room) => room.id);
  const all = value === null || (rooms.length > 0 && rooms.every((room) => chosen.includes(room.id)));
  return (
    <Field group label="Locations" help={help} {...validation}>
      {(control) => (
        <div class="pk-agenda-editor__locations">
          <Checkbox
            label="All locations"
            name={name}
            value=""
            checked={all}
            aria-describedby={control["aria-describedby"]}
            aria-invalid={control["aria-invalid"]}
            onChange={(event) =>
              onChange(event.currentTarget.checked ? (globalAll ? null : rooms.map((room) => room.id)) : [])
            }
          />
          {rooms.map((room) => (
            <Checkbox
              key={room.id}
              label={room.name}
              name={name}
              value={room.id}
              checked={chosen.includes(room.id)}
              aria-describedby={control["aria-describedby"]}
              aria-invalid={control["aria-invalid"]}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                onChange(rooms.map((item) => item.id).filter((id) => (id === room.id ? checked : chosen.includes(id))));
              }}
            />
          ))}
        </div>
      )}
    </Field>
  );
}
