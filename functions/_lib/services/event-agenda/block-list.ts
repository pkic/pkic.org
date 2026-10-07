import type { z } from "zod";
import {
  agendaBlocksListSchema,
  agendaBlocksQuerySchema,
} from "../../../../assets/shared/schemas/event-agenda-block-list";
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

export async function listAgendaBlocks(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof agendaBlocksQuerySchema>,
) {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["block.name"]) : null;
  const { rows, total } = await queryPage<BlockRow>(db, {
    source: {
      selectSql:
        "SELECT block.id,block.name,block.start_at,block.end_at,block.room_id,block.track,block.roles_json,block.role_requirements_json,block.compatible_roles_json,block.boundaries_json",
      fromSql: `FROM event_agenda_blocks block WHERE block.event_id=?${search ? ` AND ${search.sql}` : ""}${query.roomId ? " AND block.room_id=?" : ""}`,
      bindings: [eventId, ...(search?.bindings ?? []), ...(query.roomId ? [query.roomId] : [])],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { name: "block.name COLLATE NOCASE", startAt: "block.start_at", endAt: "block.end_at" },
      "block.start_at ASC",
      "block.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return agendaBlocksListSchema.parse({
    blocks: rows.map((block) => ({
      id: block.id,
      name: block.name,
      startAt: block.start_at,
      endAt: block.end_at,
      roomId: block.room_id,
      track: block.track,
      roles: JSON.parse(block.roles_json),
      roleRequirements: JSON.parse(block.role_requirements_json),
      compatibleRolePairs: JSON.parse(block.compatible_roles_json),
      boundaries: JSON.parse(block.boundaries_json),
    })),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
