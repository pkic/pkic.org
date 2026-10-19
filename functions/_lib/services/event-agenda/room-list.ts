import type { z } from "zod";
import {
  agendaRoomsListSchema,
  agendaRoomsQuerySchema,
} from "../../../../assets/shared/schemas/event-agenda-room-list";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";

interface RoomRow {
  id: string;
  name: string;
  capacity: number | null;
  setup_minutes: number;
  equipment_json: string;
  available_periods_json: string;
  virtual_room_url: string | null;
}

export async function listAgendaRooms(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof agendaRoomsQuerySchema>,
) {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["room.name"]) : null;
  const order = resolveMappedOrderBy(
    query.sort,
    { name: "room.name COLLATE NOCASE", capacity: "room.capacity" },
    "room.name COLLATE NOCASE ASC",
    "room.id ASC",
  );
  const { rows, total } = await queryPage<RoomRow>(db, {
    source: {
      selectSql:
        "SELECT room.id,room.name,room.capacity,room.setup_minutes,room.equipment_json,room.available_periods_json,room.virtual_room_url",
      fromSql: `FROM event_agenda_rooms room WHERE room.event_id=?${search ? ` AND ${search.sql}` : ""}`,
      bindings: [eventId, ...(search?.bindings ?? [])],
    },
    orderBy:
      query.sort?.replace(/^-/, "") === "capacity"
        ? order.replace("ORDER BY ", "ORDER BY room.capacity IS NULL ASC, ")
        : order,
    limit: query.limit,
    offset: query.offset,
  });
  return agendaRoomsListSchema.parse({
    rooms: rows.map((room) => ({
      id: room.id,
      name: room.name,
      capacity: room.capacity,
      setupMinutes: room.setup_minutes,
      equipment: JSON.parse(room.equipment_json),
      availablePeriods: JSON.parse(room.available_periods_json),
      ...(room.virtual_room_url !== null ? { virtualRoomUrl: room.virtual_room_url } : {}),
    })),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
