import { SCREEN_STATUS_PERMISSIONS } from "../../../../assets/shared/event-screen-permissions";
import { eventScreensListSchema, type EventScreensQuery } from "../../../../assets/shared/schemas/event-screens";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike, Env } from "../../types";
import { readEventAdminResource } from "../events/authorized-context";
import { eventReadIdSql } from "../events/selection";
import { SCREEN_RECORD_FROM, SCREEN_RECORD_SELECT, toScreenRecord, type ScreenRecordRow } from "./screen-record";

/** One page of the event's screens, authenticated and counted in the same batch. */
export function listEventScreens(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  query: EventScreensQuery,
) {
  return readEventAdminResource(db, request, env, eventSlug, SCREEN_STATUS_PERMISSIONS, (event) => {
    const eventId = eventReadIdSql(event);
    const search = query.q ? buildD1TextSearchFilter(query.q, ["screen.name", "screen.id"]) : null;
    const where = `WHERE screen.event_id=${eventId.sql}${query.roomId ? " AND screen.room_id=?" : ""}${
      query.screenIds ? " AND screen.id IN (SELECT value FROM json_each(?))" : ""
    }${search ? ` AND ${search.sql}` : ""}`;
    const bindings = [
      ...eventId.bindings,
      ...(query.roomId ? [query.roomId] : []),
      ...(query.screenIds ? [JSON.stringify(query.screenIds)] : []),
      ...(search?.bindings ?? []),
    ];
    const statements = buildOffsetPageStatements(db, {
      source: {
        selectSql: SCREEN_RECORD_SELECT,
        fromSql: `${SCREEN_RECORD_FROM} ${where}`,
        bindings,
        countFromSql: `FROM screens screen ${where}`,
      },
      orderBy: resolveMappedOrderBy(
        query.sort,
        { name: "screen.name", lastSeenAt: "session.last_seen_at" },
        "screen.name ASC",
        "screen.id ASC",
      ),
      limit: query.limit,
      offset: query.offset,
    });
    return {
      statements,
      decode(loaded) {
        const { rows, total } = decodeOffsetPageResults<ScreenRecordRow>(loaded[0], loaded[1]);
        return eventScreensListSchema.parse({
          screens: rows.map(toScreenRecord),
          page: buildPageInfo(query.limit, query.offset, total, rows.length),
        });
      },
    };
  });
}
