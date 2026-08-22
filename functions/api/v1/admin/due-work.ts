import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { requirePermission } from "../../../_lib/auth/permissions";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listDueWork } from "../../../_lib/services/due-work-read-model";
import { adminDueWorkListRouteSchema } from "../../../../assets/shared/schemas/admin-due-work";

export const AdminDueWorkList = openApiRoute(adminDueWorkListRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "admin:read");
  const { bucket, includeRetention, reminderLimit, outboxLimit, cleanupLimit, limit, offset, q, sort } = data.query;

  return json(
    await listDueWork(requestDb(c), c.env, resolveAppBaseUrl(c.env, c.req.raw), {
      bucket,
      includeRetention,
      reminderLimit,
      outboxLimit,
      cleanupLimit,
      limit,
      offset,
      q,
      sort,
    }),
  );
});
