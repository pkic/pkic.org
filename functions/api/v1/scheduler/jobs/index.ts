import {
  schedulerJobsListResponseSchema,
  schedulerJobsListRouteSchema,
} from "../../../../../assets/shared/schemas/scheduler";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listScheduledJobs } from "../../../../_lib/services/scheduled-jobs/management";

export const SchedulerJobsList = openApiRoute(schedulerJobsListRouteSchema, async (c: AdminContext) => {
  markResponseSensitive(c);
  const { db } = await requireStaffPermission(c, "scheduler:read");
  return json(schedulerJobsListResponseSchema.parse({ jobs: await listScheduledJobs(db) }));
});
