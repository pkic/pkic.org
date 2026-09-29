import {
  schedulerJobRunCreateRouteSchema,
  schedulerJobRunResponseSchema,
} from "../../../../../../../assets/shared/schemas/scheduler";
import { requireUserBackedAuthAdmin } from "../../../../../../_lib/auth/admin-identity";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { requireStaffPermission } from "../../../../../../_lib/auth/staff-permissions";
import { getConfig } from "../../../../../../_lib/config";
import { markResponseSensitive, type AdminContext } from "../../../../../../_lib/db/context";
import { AppError } from "../../../../../../_lib/errors";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { runScheduledJobNow } from "../../../../../../_lib/services/scheduled-jobs/management";
import { SCHEDULED_JOB_DEFINITIONS } from "../../../../../../_lib/services/scheduled-jobs/registry";

export const SchedulerJobRunCreate = openApiRoute(schedulerJobRunCreateRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, staff } = await requireStaffPermission(c, "scheduler:read");
  requirePermission(staff, "scheduler:manage");

  const definition = SCHEDULED_JOB_DEFINITIONS.find((job) => job.key === data.params.jobKey);
  if (!definition) {
    throw new AppError(404, "SCHEDULED_JOB_NOT_FOUND", `Unknown scheduled job '${data.params.jobKey}'`);
  }
  // Triggering through the scheduler must not grant what the caller could not
  // do directly in the job's own domain.
  for (const permission of definition.requiredPermissions ?? []) requirePermission(staff, permission);

  const actor = requireUserBackedAuthAdmin(staff);
  const result = await runScheduledJobNow(db, c.env, actor, definition, getConfig(c.env).scheduledD1QueryBudget);
  return json(schedulerJobRunResponseSchema.parse({ success: true, jobKey: definition.key, ...result }));
});
