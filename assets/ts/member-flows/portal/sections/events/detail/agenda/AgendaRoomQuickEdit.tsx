import { Menu } from "../../../../../../ui/Menu";
import { useState } from "preact/hooks";
import {
  agendaRoomCreateSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { formatNumber } from "../../../../../../../shared/format-number";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson, putJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useAgendaRoomOrder } from "./useAgendaRoomOrder";

function nextRoomName(rooms: AgendaSnapshot["rooms"]) {
  const names = new Set(rooms.map((room) => room.name.toLowerCase()));
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (!names.has(`room ${letter.toLowerCase()}`)) return `Room ${letter}`;
  }
  let number = 1;
  while (names.has(`room ${formatNumber(number)}`)) number++;
  return `Room ${formatNumber(number)}`;
}

/** Create and rename at the column header; advanced room settings retain their dedicated editor. */
export function AgendaRoomQuickEdit({
  snapshot,
  room,
  onSaved,
  onEdit,
}: {
  snapshot: AgendaSnapshot;
  room?: AgendaSnapshot["rooms"][number];
  onSaved: (snapshot: AgendaSnapshot) => void;
  onEdit?: (room: AgendaSnapshot["rooms"][number]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(room?.name ?? nextRoomName(snapshot.rooms));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const order = useAgendaRoomOrder(snapshot, onSaved);
  const form = useContractForm(agendaRoomCreateSchema, {
    expectedRevision: snapshot.revision,
    name,
    capacity: room?.capacity ?? null,
    setupMinutes: room?.setupMinutes ?? 0,
    equipment: room?.equipment ?? [],
    availablePeriods: room?.availablePeriods ?? [],
  });
  async function save(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    try {
      onSaved(
        await (room ? putJson : postJson)(
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/rooms${room ? `/${encodeURIComponent(room.id)}` : ""}`,
          checked.data,
          agendaSnapshotSchema,
        ),
      );
      setEditing(false);
      setError("");
    } catch (failure) {
      setError(form.refuse(failure));
    } finally {
      setBusy(false);
    }
  }
  if (!editing)
    return (
      <div class={`pk-agenda-room-heading${room ? "" : " pk-agenda-room-heading--add"}`}>
        <Button
          variant="ghost"
          size="sm"
          title={room ? `Rename ${room.name}` : "Add room"}
          aria-label={room ? `Rename ${room.name}` : "Add room"}
          disabled={order.busy}
          onClick={() => {
            setName(room?.name ?? nextRoomName(snapshot.rooms));
            setError("");
            setEditing(true);
          }}
        >
          {room ? room.name : <span aria-hidden="true">+</span>}
        </Button>
        {room && (
          <Menu
            label={`Actions for ${room.name}`}
            align="end"
            items={[
              ...(onEdit
                ? [
                    {
                      id: "edit-location",
                      label: "Edit location",
                      onSelect: () => onEdit(room),
                      disabled: order.busy,
                    },
                  ]
                : []),
              {
                id: "move-left",
                label: "Move left",
                disabled: order.busy || !order.canMove(room.id, -1),
                onSelect: () => void order.move(room.id, -1),
              },
              {
                id: "move-right",
                label: "Move right",
                disabled: order.busy || !order.canMove(room.id, 1),
                onSelect: () => void order.move(room.id, 1),
              },
            ]}
          />
        )}
        {order.error && <ErrorAlert error={order.error} />}
      </div>
    );
  return (
    <form
      class="pk-agenda-editor__room-name pk-stack"
      noValidate
      {...form.handlers}
      onSubmit={(event) => void save(event)}
    >
      {error && <ErrorAlert error={error} />}
      <Field label="Room name" required {...form.of("name")}>
        {(control) => (
          <TextInput {...control} name="name" value={name} onInput={(event) => setName(event.currentTarget.value)} />
        )}
      </Field>
      <div class="pk-cluster">
        <Button type="submit" variant="primary" disabled={busy}>
          Done
        </Button>
        <Button type="button" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
