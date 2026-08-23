/**
 * GET /api/v1/admin/events/:eventSlug/registrations/:registrationId/audit-log
 *
 * Returns the audit log entries for a specific registration, most recent first.
 * Includes all rows where entity_type = 'registration' and entity_id matches,
 * joined with the users table to surface actor display names.
 */
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { listRegistrationAuditLog } from "../../../../../../../_lib/services/audit-log-read";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { adminRegistrationAuditLogRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts";
import type { ValidatedData } from "chanfana";

export async function onRequestGet(
  c: AdminContext,
  data?: ValidatedData<typeof adminRegistrationAuditLogRouteSchema>,
): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), data?.params.eventSlug ?? c.req.param("eventSlug"));
  const registrationId = data?.params.registrationId ?? c.req.param("registrationId");
  const query = data?.query ?? adminRegistrationAuditLogRouteSchema.request.query.parse({});
  return json(await listRegistrationAuditLog(requestDb(c), event.id, registrationId, query));
}
