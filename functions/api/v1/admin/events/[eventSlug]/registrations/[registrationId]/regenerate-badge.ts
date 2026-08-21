import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import {
  processBadgeRenderJobById,
  requestRegistrationBadgeRegeneration,
} from "../../../../../../../_lib/services/registration-badge-regeneration";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, c.req.param("eventSlug"));
  const result = await requestRegistrationBadgeRegeneration(db, {
    actor,
    event,
    registrationId: c.req.param("registrationId"),
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  c.executionCtx.waitUntil(processBadgeRenderJobById(db, c.env, result.jobId));
  return json({ success: true, status: "queued", ...result });
}
