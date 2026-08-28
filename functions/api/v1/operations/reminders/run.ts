import {
  operationsRemindersRunResponseSchema,
  operationsRemindersRunRouteSchema,
} from "../../../../../assets/shared/schemas/operations";
import { requirePermission } from "../../../../_lib/auth/permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { runReminderCommand } from "../../../../_lib/services/operations";
import { requireSystemPermission as requireStaffPermission } from "../../system/authorization";

export const OperationsRemindersRunPost = openApiRoute(
  operationsRemindersRunRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "operations:read");
    requirePermission(staff, "operations:run");
    return json(
      operationsRemindersRunResponseSchema.parse(
        await runReminderCommand(db, c.env, c.req.raw, staff, data.body.limit),
      ),
    );
  },
);
