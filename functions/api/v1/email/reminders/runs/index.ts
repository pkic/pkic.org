import {
  emailReminderRunCreateRouteSchema,
  emailReminderRunResponseSchema,
} from "../../../../../../assets/shared/schemas/email-reminders";
import { requireUserBackedAuthAdmin } from "../../../../../_lib/auth/admin-identity";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { createReminderRun } from "../../../../../_lib/services/reminders/manual-runs";

export const EmailReminderRunCreate = openApiRoute(emailReminderRunCreateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "email:read");
  if (data.body.mode === "execute") requirePermission(staff, "email:manage");
  const actor = requireUserBackedAuthAdmin(staff);
  return json(
    emailReminderRunResponseSchema.parse(
      await createReminderRun(db, c.env, c.req.raw, actor, data.body.mode, data.body.limit),
    ),
  );
});
