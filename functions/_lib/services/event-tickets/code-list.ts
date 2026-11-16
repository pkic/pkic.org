/** The event's codes as a searched, sorted and paged collection. */
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  eventTicketCodeListSchema,
  type EventTicketCodeListQuery,
} from "../../../../assets/shared/schemas/event-tickets";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { normalizeTicketCode } from "./assignment";
import { CODE_COLUMNS, decodeCode, type CodeRow } from "./configuration";

export async function listEventTicketCodes(db: DatabaseLike, eventId: string, query: EventTicketCodeListQuery) {
  // A code is found by who it is for, or by the code itself however it was typed.
  const search = query.q ? buildD1TextSearchFilter(query.q, ["label"]) : null;
  const typed = query.q ? normalizeTicketCode(query.q) : "";
  const { rows, total } = await queryPage<CodeRow>(db, {
    source: {
      selectSql: `SELECT ${CODE_COLUMNS}`,
      fromSql: `FROM event_ticket_codes WHERE event_id = ?${search ? ` AND ((${search.sql}) OR code = ?)` : ""}`,
      bindings: [eventId, ...(search ? [...search.bindings, typed] : [])],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { label: "label COLLATE NOCASE", used: "used_count", created: "created_at" },
      "created_at DESC",
      "id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return eventTicketCodeListSchema.parse({
    codes: rows.map(decodeCode),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
