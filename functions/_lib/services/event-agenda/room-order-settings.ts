import { agendaRoomOrderIdsSchema } from "../../../../assets/shared/schemas/event-agenda-room-order";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { parseJsonSafe } from "../../utils/json";
import { agendaSettingsObject, agendaSettingsWriteSql } from "./settings-object";

/** Legacy rooms arrive in deterministic name/id order; stored IDs retain position across renames. */
export function orderedAgendaRooms<T extends { id: string }>(rooms: T[], settingsJson: string): T[] {
  const settings = agendaSettingsObject(parseJsonSafe<unknown>(settingsJson, {}));
  const agenda = settings.agenda;
  const parsed = agendaRoomOrderIdsSchema.safeParse(
    typeof agenda === "object" && agenda !== null && "roomOrder" in agenda ? agenda.roomOrder : undefined,
  );
  if (!parsed.success) return rooms;
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const ordered = parsed.data.flatMap((id) => {
    const room = byId.get(id);
    byId.delete(id);
    return room ? [room] : [];
  });
  return [...ordered, ...byId.values()];
}

/** Exact settings CAS and exact owned room set are rechecked inside the agenda revision batch. */
export async function prepareAgendaRoomOrder(db: DatabaseLike, eventId: string, roomIds: string[]) {
  const ids = agendaRoomOrderIdsSchema.parse(roomIds);
  const event = await first<{ settings_json: string }>(db, "SELECT settings_json FROM events WHERE id=?", [eventId]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const agenda = agendaSettingsObject(agendaSettingsObject(JSON.parse(event.settings_json)).agenda);
  agenda.roomOrder = ids;
  const json = JSON.stringify(ids);
  return [
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM events WHERE id=? AND settings_json=? AND json_array_length(?)=(SELECT COUNT(*) FROM event_agenda_rooms WHERE event_id=?) AND NOT EXISTS(SELECT 1 FROM json_each(?) requested WHERE NOT EXISTS(SELECT 1 FROM event_agenda_rooms room WHERE room.event_id=? AND room.id=requested.value))",
      bindings: [eventId, event.settings_json, json, eventId, json, eventId],
    }),
    db
      .prepare(`UPDATE events SET settings_json=${agendaSettingsWriteSql},updated_at=? WHERE id=? AND settings_json=?`)
      .bind(JSON.stringify(agenda), nowIso(), eventId, event.settings_json),
  ];
}

/** Same canonical stored positions for SQL list and approval-freshness projections. */
export function agendaRoomOrderPositionSql(roomId: string, settingsJson: string) {
  return `COALESCE((SELECT CAST(position.key AS INTEGER) FROM json_each(${settingsJson},'$.agenda.roomOrder') position WHERE position.value=${roomId}),2147483647)`;
}
