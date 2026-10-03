import {
  badgeAttendeeQuerySchema,
  badgeAttendeesResponseSchema,
} from "../../../../assets/shared/schemas/route-contracts-event-badges";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
export async function badgeAttendees(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = badgeAttendeeQuerySchema.parse(raw);
  const from =
    "FROM registrations reg JOIN users u ON u.id=reg.user_id WHERE reg.event_id=? AND reg.status='registered' AND u.active=1 AND INSTR(LOWER(COALESCE(u.email,'')||' '||COALESCE(u.first_name,'')||' '||COALESCE(u.last_name,'')),LOWER(?))>0";
  const bindings = [eventId, query.q ?? ""];
  const count = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${from}`, bindings);
  const users = await all(
    db,
    `SELECT u.id,u.email,u.first_name,u.last_name,u.organization_name ${from} ORDER BY u.email ${query.sort === "-email" ? "DESC" : "ASC"},u.id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return badgeAttendeesResponseSchema.parse({
    users,
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, users.length),
  });
}
