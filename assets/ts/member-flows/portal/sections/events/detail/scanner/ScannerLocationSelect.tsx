import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import {
  scannerTargetsResponseSchema,
  type ScannerTarget,
  type ScannerTargetsResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
export function ScannerLocationSelect({
  slug,
  targetId,
  label,
  roomId,
  rooms,
  targetField,
  roomField,
  onTarget,
  onRoom,
}: {
  slug: string;
  targetId: string | null;
  label: string;
  roomId: string | null;
  rooms: NonNullable<ScannerTarget["rooms"]>;
  targetField: FieldPresentation;
  roomField: FieldPresentation;
  onTarget: (item: ScannerTarget | null) => void;
  onRoom: (roomId: string | null) => void;
}) {
  return (
    <>
      <Field label="Session" {...targetField} help="Choose a session to record session attendance.">
        {(control) => (
          <ServerSearchSelect<ScannerTarget, ScannerTargetsResponse>
            {...control}
            searchLabel="Session"
            value={targetId}
            selectedLabel={label}
            placeholder="Event entrance"
            searchPlaceholder="Event entrance"
            allowEmpty
            onChange={onTarget}
            catalog={{
              endpoint: `/api/v1/events/${encodeURIComponent(slug)}/scans/targets`,
              responseSchema: scannerTargetsResponseSchema,
              resolveItems: (value) => value.sessions,
              resolvePage: (value) => value.page,
              itemKey: (item) => item.id,
              itemLabel: (item) => item.title,
              sort: "title",
            }}
          />
        )}
      </Field>
      {rooms.length > 0 && (
        <Field
          label="Physical room"
          {...roomField}
          required={rooms.length > 1}
          help="Registration feedback and attendance observations use this selected room."
        >
          {(control) => (
            <Select
              {...control}
              name="roomId"
              value={roomId ?? ""}
              onChange={(event) => onRoom(event.currentTarget.value || null)}
            >
              <option value="">Choose a room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </>
  );
}
