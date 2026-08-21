import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { dispatchRequestMethod, json } from "../../../../../_lib/http";
import { getAdminEventStats } from "../../../../../_lib/services/admin-event-stats";
import { getEventBySlug } from "../../../../../_lib/services/events";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  await requireAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, c.req.param("eventSlug"));
  return json(await getAdminEventStats(db, event));
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet });
}
