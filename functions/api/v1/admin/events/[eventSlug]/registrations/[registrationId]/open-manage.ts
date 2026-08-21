import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { createAdminRegistrationManageUrl } from "../../../../../../../_lib/services/admin-registration-manage-access";
import { getEventBySlug } from "../../../../../../../_lib/services/events";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const signingSecret = c.env.INTERNAL_SIGNING_SECRET;
  if (!signingSecret) {
    return json({ error: { code: "SERVER_ERROR", message: "Signing secret not configured" } }, 500);
  }

  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, c.req.param("eventSlug"));
  const ip =
    c.req.raw.headers.get("cf-connecting-ip") ?? c.req.raw.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const manageUrl = await createAdminRegistrationManageUrl(db, {
    actor,
    event,
    registrationId: c.req.param("registrationId"),
    signingSecret,
    ip,
    userAgent: c.req.raw.headers.get("user-agent") ?? "",
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  return json({ manageUrl });
}
