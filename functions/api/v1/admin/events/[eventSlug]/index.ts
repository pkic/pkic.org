/**
 * GET /api/v1/admin/events/:eventSlug
 *
 * Returns the full event record including settings_json fields (venue,
 * virtualUrl, etc.) so the admin UI can populate the Details / Settings form.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getAdminEventDetail } from "../../../../../_lib/services/events/admin-detail";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json({ event: await getAdminEventDetail(requestDb(c), c.req.param("eventSlug")) });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
