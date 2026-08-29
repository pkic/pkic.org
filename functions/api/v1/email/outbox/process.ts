import {
  emailOutboxProcessResponseSchema,
  emailOutboxProcessRouteSchema,
} from "../../../../../assets/shared/schemas/email-outbox";
import { requirePermission } from "../../../../_lib/auth/permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { processEmailOutboxCommand } from "../../../../_lib/services/email-outbox";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export const EmailOutboxProcessPost = openApiRoute(emailOutboxProcessRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "email:read");
  requirePermission(staff, "email:manage");
  return json(emailOutboxProcessResponseSchema.parse(await processEmailOutboxCommand(db, c.env, staff, data.body)));
});
