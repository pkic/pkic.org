import { prepareUserBackedAdminFromRequest, requireUserBackedAdminFromRequest } from "../../auth/admin";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import { getEventBySlug, prepareEventBySlug, type EventRecord } from "../events";

/** Human session context and the owning event are one snapshot; permission selection stays caller-owned. */
export async function readEventAdminContext(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
) {
  const read = await prepareEventAdminContext(db, request, env, eventSlug);
  if (!read) {
    const actor = await requireUserBackedAdminFromRequest(db, request, env);
    return { actor, event: await getEventBySlug(db, eventSlug) };
  }
  return read.decode(await db.batch(read.statements));
}

/** Compose the same live human context with resource reads; delegated credentials keep their live resolver. */
export async function prepareEventAdminContext(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
) {
  const auth = await prepareUserBackedAdminFromRequest(db, request, env);
  if (!auth) return null;
  return {
    statements: [...auth.statements, prepareEventBySlug(db, eventSlug)],
    async decode(loaded: D1StatementResult[]) {
      const actor = await auth.decode(loaded.slice(0, auth.statements.length));
      const event = batchFirst<EventRecord>(loaded[auth.statements.length]);
      if (!event) throw new AppError(404, "EVENT_NOT_FOUND", `Event '${eventSlug}' not found`);
      return { actor, event };
    },
  };
}
