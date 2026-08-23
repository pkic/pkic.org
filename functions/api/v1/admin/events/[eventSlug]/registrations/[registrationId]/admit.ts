import { parseJsonBody } from "../../../../../../../_lib/validation";
import { dispatchPostOnly, json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { admitRegistration } from "../../../../../../../_lib/services/registrations";
import { adminRegistrationAdmitSchema } from "../../../../../../../../assets/shared/schemas/admin-events";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { omitCapabilitySecrets } from "../../../../../../../_lib/services/capability-links";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminRegistrationAdmitSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const admitted = await admitRegistration(requestDb(c), {
    registrationId: c.req.param("registrationId"),
    event,
    dayDates: body.dayDates,
    mode: body.mode,
    reason: body.reason,
    actorUserId: admin.id,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  if (admitted.outboxId) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, admitted.outboxId));
  }

  return json({
    success: true,
    registration: omitCapabilitySecrets(admitted.registration),
    admittedDayDates: admitted.admittedDayDates,
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
