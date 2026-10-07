import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { AgendaLocationSelect } from "./AgendaLocationSelect";

/** One session occupies its selected locations; global breaks retain their all-location scope. */
export function SessionLocationFields({
  rooms,
  roomId,
  additionalRoomIds,
  of,
  onChange,
  globalAll = false,
}: {
  rooms: AgendaSnapshot["rooms"];
  roomId: string;
  additionalRoomIds: string[];
  of: (name: string) => FieldPresentation;
  onChange: (roomIds: string[]) => void;
  globalAll?: boolean;
}) {
  const selected = [roomId, ...additionalRoomIds].filter(Boolean);
  const validation = of("roomId").state === "invalid" ? of("roomId") : of("additionalRoomIds");
  return (
    <div class="pk-agenda-editor__form-wide">
      <AgendaLocationSelect
        rooms={rooms}
        value={globalAll && !selected.length ? null : selected}
        globalAll={globalAll}
        name="additionalRoomIds"
        onChange={(ids) => onChange(ids ?? [])}
        {...validation}
        help="Choose one or more locations. Use Ctrl or Command to select several; leave none selected to assign locations later."
      />
    </div>
  );
}
