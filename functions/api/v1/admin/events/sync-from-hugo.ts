import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { syncEventFromHugo } from "../../../../_lib/services/events";
import { adminEventSyncSchema } from "../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "events:write");
  const body = await parseJsonBody(c.req, adminEventSyncSchema);

  const settings = {
    ...(body.event.settings ?? {}),
    ...(body.event.frontend ? { frontend: body.event.frontend } : {}),
  };

  const event = await syncEventFromHugo(requestDb(c), { ...body.event, settings }, body.terms, admin.id);

  return json({ success: true, event });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
