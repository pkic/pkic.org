import type { z } from "zod";
import {
  agendaShiftsListSchema,
  agendaShiftsQuerySchema,
} from "../../../../assets/shared/schemas/event-agenda-shift-list";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";

interface BlockRow {
  id: string;
  name: string;
  start_at: string;
  end_at: string;
  room_id: string | null;
  track: string | null;
  roles_json: string;
  role_requirements_json: string;
  compatible_roles_json: string;
  boundaries_json: string;
}

export async function listAgendaShifts(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof agendaShiftsQuerySchema>,
) {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["shift.name"]) : null;
  const { rows, total } = await queryPage<BlockRow>(db, {
    source: {
      selectSql:
        "SELECT shift.id,shift.name,shift.start_at,shift.end_at,shift.room_id,shift.track,shift.roles_json,shift.role_requirements_json,shift.compatible_roles_json,shift.boundaries_json",
      fromSql: `FROM event_agenda_shifts shift WHERE shift.event_id=?${search ? ` AND ${search.sql}` : ""}${query.roomId ? " AND shift.room_id=?" : ""}`,
      bindings: [eventId, ...(search?.bindings ?? []), ...(query.roomId ? [query.roomId] : [])],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { name: "shift.name COLLATE NOCASE", startAt: "shift.start_at", endAt: "shift.end_at" },
      "shift.start_at ASC",
      "shift.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return agendaShiftsListSchema.parse({
    shifts: rows.map((shift) => ({
      id: shift.id,
      name: shift.name,
      startAt: shift.start_at,
      endAt: shift.end_at,
      roomId: shift.room_id,
      track: shift.track,
      roles: JSON.parse(shift.roles_json),
      roleRequirements: JSON.parse(shift.role_requirements_json),
      compatibleRolePairs: JSON.parse(shift.compatible_roles_json),
      boundaries: JSON.parse(shift.boundaries_json),
    })),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
