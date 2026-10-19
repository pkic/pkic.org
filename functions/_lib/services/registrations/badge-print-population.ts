import {
  eventBadgePrintPopulationResponseSchema,
  type EventBadgePrintPopulationQuery,
} from "../../../../assets/shared/schemas/event-badge-printing";
import { queryKeysetPage } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import { badgeAttendeeEligibilitySql } from "../event-participation/badge-attendees";
import { registrationPopulationFilter } from "./registration-population-filter";

/** Every page uses the caller's live management guard; metadata carries no credential or contact payload. */
export async function listBadgePrintPopulation(
  db: DatabaseLike,
  eventId: string,
  query: EventBadgePrintPopulationQuery,
) {
  const population = registrationPopulationFilter(eventId, query);
  const { rows, total, hasMore } = await queryKeysetPage<{
    id: string;
    user_id: string;
    display_name: string | null;
    status: "registered";
  }>(db, {
    source: {
      selectSql:
        "SELECT r.id, r.user_id, COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name, r.status",
      ...population,
      fromSql: `${population.fromSql} AND ${badgeAttendeeEligibilitySql("r", "u")}`,
    },
    keyColumn: "r.id",
    cursor: query.cursor,
    limit: query.limit,
  });
  return eventBadgePrintPopulationResponseSchema.parse({
    registrations: rows,
    page: {
      limit: query.limit,
      total,
      nextCursor: hasMore ? rows.at(-1)!.id : null,
    },
  });
}
