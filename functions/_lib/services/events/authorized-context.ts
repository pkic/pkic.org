import { prepareUserBackedAdminFromRequest, requireUserBackedAdminFromRequest } from "../../auth/admin";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { getEventBySlug, prepareEventBySlug, type EventRecord } from "../events";

/** Human session context and the owning event are one snapshot; permission selection stays caller-owned. */
export async function readEventAdminContext(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
) {
  const auth = await prepareUserBackedAdminFromRequest(db, request, env);
  if (!auth) {
    const actor = await requireUserBackedAdminFromRequest(db, request, env);
    return { actor, event: await getEventBySlug(db, eventSlug) };
  }
  const loaded = await db.batch([...auth.statements, prepareEventBySlug(db, eventSlug)]);
  const actor = await auth.decode(loaded.slice(0, auth.statements.length));
  const event = batchFirst<EventRecord>(loaded[auth.statements.length]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", `Event '${eventSlug}' not found`);
  return { actor, event };
}
