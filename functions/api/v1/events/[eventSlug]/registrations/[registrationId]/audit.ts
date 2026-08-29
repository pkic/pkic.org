import type { ValidatedData } from "chanfana";
import { eventRegistrationAuditRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts-event-registration-management";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { listRegistrationAuditLog } from "../../../../../../_lib/services/audit-log-read";
import { requireEventRegistrationManagement } from "../authorization";

async function handleEventRegistrationAudit(
  c: AdminContext,
  data: ValidatedData<typeof eventRegistrationAuditRouteSchema>,
): Promise<Response> {
  const { db, event } = await requireEventRegistrationManagement(c, data.params.eventSlug);
  return json(await listRegistrationAuditLog(db, event.id, data.params.registrationId, data.query));
}

export const EventRegistrationAuditGet = openApiRoute(eventRegistrationAuditRouteSchema, handleEventRegistrationAudit);
