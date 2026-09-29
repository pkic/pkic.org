import type { ValidatedData } from "chanfana";
import {
  eventRegistrationAdmissionResponseSchema,
  eventRegistrationAdmissionsCreateRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts-event-registration-management";
import { omitCapabilitySecrets } from "../../../../../../_lib/auth/capability-links";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { requestDb } from "../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { admitRegistration } from "../../../../../../_lib/services/registrations";
import { requireEventRegistrationManagement } from "../authorization";

async function handleEventRegistrationAdmission(
  c: AdminContext,
  data: ValidatedData<typeof eventRegistrationAdmissionsCreateRouteSchema>,
): Promise<Response> {
  const { actor, db, event } = await requireEventRegistrationManagement(c, data.params.eventSlug);
  const admitted = await admitRegistration(db, {
    registrationId: data.params.registrationId,
    event,
    dayDates: data.body.dayDates,
    mode: data.body.mode,
    reason: data.body.reason,
    actorUserId: actor.id,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  if (admitted.outboxId) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, admitted.outboxId));
  }
  return json(
    eventRegistrationAdmissionResponseSchema.parse({
      success: true,
      registration: omitCapabilitySecrets(admitted.registration),
      admittedDayDates: admitted.admittedDayDates,
    }),
  );
}

export const EventRegistrationAdmissionsCreate = openApiRoute(
  eventRegistrationAdmissionsCreateRouteSchema,
  handleEventRegistrationAdmission,
);
