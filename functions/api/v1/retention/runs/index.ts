import {
  retentionRunCreateRouteSchema,
  retentionRunResponseSchema,
} from "../../../../../assets/shared/schemas/retention";
import { requireUserBackedAuthAdmin } from "../../../../_lib/auth/admin-identity";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { createRetentionRun } from "../../../../_lib/services/retention-work";

export const RetentionRunCreate = openApiRoute(retentionRunCreateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "retention:read");
  const mode = data.body?.mode ?? "execute";
  if (mode === "execute") {
    requirePermission(staff, "retention:run");
    requirePermission(staff, "users:anonymize");
  }
  const actor = requireUserBackedAuthAdmin(staff);
  return json(retentionRunResponseSchema.parse(await createRetentionRun(db, actor, mode)));
});
