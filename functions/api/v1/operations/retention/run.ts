import {
  operationsRetentionRunResponseSchema,
  operationsRetentionRunRouteSchema,
} from "../../../../../assets/shared/schemas/operations";
import { requirePermission } from "../../../../_lib/auth/permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { runRetentionCommand } from "../../../../_lib/services/operations";
import { requireSystemPermission as requireStaffPermission } from "../../system/authorization";

export const OperationsRetentionRunPost = openApiRoute(operationsRetentionRunRouteSchema, async (c: AdminContext) => {
  const { db, staff } = await requireStaffPermission(c, "operations:read");
  requirePermission(staff, "operations:run");
  requirePermission(staff, "users:anonymize");
  return json(operationsRetentionRunResponseSchema.parse(await runRetentionCommand(db, staff)));
});
