import { adminManageDayAttendanceSchema } from "../../../../../../../../assets/shared/schemas/admin-events";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { dispatchRequestMethod, json } from "../../../../../../../_lib/http";
import { updateAdminRegistrationDayAttendance } from "../../../../../../../_lib/services/registrations/admin-day-attendance";
import { parseJsonBody } from "../../../../../../../_lib/validation";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const change = await parseJsonBody(c.req, adminManageDayAttendanceSchema);
  const result = await updateAdminRegistrationDayAttendance(requestDb(c), actor, {
    eventSlug: c.req.param("eventSlug"),
    registrationId: c.req.param("registrationId"),
    change,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  if (result.outboxId) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, result.outboxId));
  }
  return json({ success: true });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { PATCH: onRequestPatch });
}
