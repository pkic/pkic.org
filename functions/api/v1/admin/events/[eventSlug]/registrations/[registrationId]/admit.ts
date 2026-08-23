import { parseJsonBody } from "../../../../../../../_lib/validation";
import { dispatchPostOnly, json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { admitRegistration } from "../../../../../../../_lib/services/registrations";
import { adminRegistrationAdmitSchema } from "../../../../../../../../assets/shared/schemas/admin-events";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { omitCapabilitySecrets } from "../../../../../../../_lib/auth/capability-links";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import {
  adminRegistrationAdmitResponseSchema,
  adminRegistrationAdmitRouteSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts-admin-registrations";
import type { ValidatedData } from "chanfana";

export async function onRequestPost(
  c: AdminContext,
  data?: ValidatedData<typeof adminRegistrationAdmitRouteSchema>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = data?.body ?? (await parseJsonBody(c.req, adminRegistrationAdmitSchema));
  const eventSlug = data?.params.eventSlug ?? c.req.param("eventSlug");
  const registrationId = data?.params.registrationId ?? c.req.param("registrationId");
  const event = await getEventBySlug(requestDb(c), eventSlug);
  const admitted = await admitRegistration(requestDb(c), {
    registrationId,
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

  return json(
    adminRegistrationAdmitResponseSchema.parse({
      success: true,
      registration: omitCapabilitySecrets(admitted.registration),
      admittedDayDates: admitted.admittedDayDates,
    }),
  );
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
