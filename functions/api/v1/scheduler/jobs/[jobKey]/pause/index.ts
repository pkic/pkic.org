import {
  schedulerJobPauseRouteSchema,
  schedulerJobResumeRouteSchema,
  schedulerJobStateResponseSchema,
} from "../../../../../../../assets/shared/schemas/scheduler";
import { requireUserBackedAuthAdmin } from "../../../../../../_lib/auth/admin-identity";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { requireStaffPermission } from "../../../../../../_lib/auth/staff-permissions";
import { markResponseSensitive, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { pauseScheduledJob, resumeScheduledJob } from "../../../../../../_lib/services/scheduled-jobs/management";

export const SchedulerJobPause = openApiRoute(schedulerJobPauseRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, staff } = await requireStaffPermission(c, "scheduler:read");
  requirePermission(staff, "scheduler:manage");
  const actor = requireUserBackedAuthAdmin(staff);
  const job = await pauseScheduledJob(db, actor, data.params.jobKey, data.body.reason);
  return json(schedulerJobStateResponseSchema.parse({ success: true, job }));
});

export const SchedulerJobResume = openApiRoute(schedulerJobResumeRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, staff } = await requireStaffPermission(c, "scheduler:read");
  requirePermission(staff, "scheduler:manage");
  const actor = requireUserBackedAuthAdmin(staff);
  const job = await resumeScheduledJob(db, actor, data.params.jobKey);
  return json(schedulerJobStateResponseSchema.parse({ success: true, job }));
});
