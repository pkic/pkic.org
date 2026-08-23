import {
  adminRegistrationDayAttendancePatchRouteSchema,
  adminRegistrationDayAttendanceResponseSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { updateAdminRegistrationDayAttendance } from "../../../../../../../_lib/services/registrations/admin-day-attendance";

export const AdminRegistrationDayAttendancePatch = openApiRoute(
  adminRegistrationDayAttendancePatchRouteSchema,
  async (c: AdminContext, data) => {
    const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const result = await updateAdminRegistrationDayAttendance(requestDb(c), actor, {
      eventSlug: data.params.eventSlug,
      registrationId: data.params.registrationId,
      change: data.body,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    });
    if (result.outboxId) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, result.outboxId));
    }
    return json(adminRegistrationDayAttendanceResponseSchema.parse({ success: true }));
  },
);
