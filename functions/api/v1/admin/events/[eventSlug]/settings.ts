import { adminEventSettingsSchema } from "../../../../../../assets/shared/schemas/admin-events";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { dispatchRequestMethod, json } from "../../../../../_lib/http";
import { updateEventSettings } from "../../../../../_lib/services/events/settings";
import { parseJsonBody } from "../../../../../_lib/validation";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const settings = await parseJsonBody(c.req, adminEventSettingsSchema);
  const event = await updateEventSettings(requestDb(c), {
    eventSlug: c.req.param("eventSlug"),
    actorId: actor.id,
    settings,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  return json({ success: true, event });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { PATCH: onRequestPatch });
}
