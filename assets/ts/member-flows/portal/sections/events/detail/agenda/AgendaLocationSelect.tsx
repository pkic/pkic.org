import { useLayoutEffect, useRef } from "preact/hooks";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { formatNumber } from "../../../../../../../shared/format-number";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";

/** Use the same native location selection for session and break dialogs. */
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
  const controls = useRef<HTMLDivElement>(null);
  const all = value === null || (rooms.length > 0 && rooms.every((room) => value.includes(room.id)));
  useLayoutEffect(() => {
    // Native selection mutates options even when their rendered props stay unchanged.
    for (const option of controls.current?.querySelector("select")?.options ?? []) {
      option.selected = option.value === "" ? all : !all && Boolean(value?.includes(option.value));
    }
  }, [all, value, rooms]);
  return (
    <Field label="Locations" help={help} {...validation}>
      {(control) => (
        <div ref={controls} class="pk-stack">
          <Select
            {...control}
            name={name}
            multiple
            size={Math.min(6, Math.max(2, rooms.length + 1))}
            onChange={(event) => {
              const selected = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
              if (all && selected.length > 1 && selected.includes("")) onChange(selected.filter((id) => id !== ""));
              else if (selected.includes("")) onChange(globalAll ? null : rooms.map((room) => room.id));
              else onChange(selected);
            }}
          >
            <option value="" selected={all}>
              All locations
            </option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id} selected={!all && Boolean(value?.includes(room.id))}>
                {room.name}
              </option>
            ))}
          </Select>
          <p class="pk-muted">{all ? "All locations" : `${formatNumber(value?.length ?? 0)} selected`}</p>
        </div>
      )}
    </Field>
  );
}
