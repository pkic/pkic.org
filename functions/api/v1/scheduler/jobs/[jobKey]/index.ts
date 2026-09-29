import {
  schedulerJobStateResponseSchema,
  schedulerJobStateUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/scheduler";
import { requireUserBackedAuthAdmin } from "../../../../../_lib/auth/admin-identity";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";
import { markResponseSensitive, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { updateScheduledJobState } from "../../../../../_lib/services/scheduled-jobs/management";

export const SchedulerJobStateUpdate = openApiRoute(
  schedulerJobStateUpdateRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, staff } = await requireStaffPermission(c, "scheduler:read");
    requirePermission(staff, "scheduler:manage");
    const actor = requireUserBackedAuthAdmin(staff);
    const job = await updateScheduledJobState(db, actor, data.params.jobKey, data.body);
    return json(schedulerJobStateResponseSchema.parse({ success: true, job }));
  },
);
