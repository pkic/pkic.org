import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { admitRegistration } from "../../../../../../../_lib/services/registrations";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { omitCapabilitySecrets } from "../../../../../../../_lib/auth/capability-links";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import {
  adminRegistrationAdmitResponseSchema,
  adminRegistrationAdmitRouteSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts-admin-registrations";
import type { ValidatedData } from "chanfana";

async function handleAdminRegistrationAdmit(
  c: AdminContext,
  data: ValidatedData<typeof adminRegistrationAdmitRouteSchema>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = data.body;
  const eventSlug = data.params.eventSlug;
  const registrationId = data.params.registrationId;
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

export const AdminRegistrationAdmit = openApiRoute(adminRegistrationAdmitRouteSchema, handleAdminRegistrationAdmit);
