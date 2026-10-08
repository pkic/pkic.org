import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
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
  params,
  timeZone,
  disabled = false,
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
  params?: Record<string, string>;
  timeZone?: string;
  disabled?: boolean;
  onTimeZone?: (timeZone: string) => void;
}) {
  return (
    <>
      <Field label="Session" {...targetField}>
        {(control) => (
          <ServerSearchSelect<ScannerTarget, ScannerTargetsResponse>
            {...control}
            searchLabel="Session"
            value={targetId}
            selectedLabel={label}
            placeholder="Event entrance"
            searchPlaceholder="Event entrance"
            disabled={disabled}
            allowEmpty
            onChange={onTarget}
            catalog={{
              endpoint: `/api/v1/events/${encodeURIComponent(slug)}/scans/targets`,
              responseSchema: scannerTargetsResponseSchema,
              resolveItems: (value) => value.sessions,
              resolvePage: (value) => value.page,
              itemKey: (item) => item.id,
              itemLabel: (item) =>
                [
                  item.title,
                  item.startAt && timeZone ? formatDateTimeInZone(item.startAt, timeZone) : "Time not scheduled",
                  item.rooms?.map((room) => room.name).join(" / "),
                ]
                  .filter(Boolean)
                  .join(" · "),
              params,
              sort: "startAt",
            }}
          />
        )}
      </Field>
      {rooms.length > 0 && (
        <Field label="Physical room" {...roomField} required={rooms.length > 1}>
          {(control) => (
            <Select
              {...control}
              disabled={disabled}
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
