import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import {
  schedulerJobBacklogResponseSchema,
  schedulerJobBacklogRouteSchema,
} from "../../../../../../assets/shared/schemas/scheduler";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";
import { markResponseSensitive, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { SCHEDULED_JOB_DEFINITIONS } from "../../../../../_lib/services/scheduled-jobs/registry";

export const SchedulerJobBacklogList = openApiRoute(schedulerJobBacklogRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, staff } = await requireStaffPermission(c, "scheduler:read");
  const definition = SCHEDULED_JOB_DEFINITIONS.find((job) => job.key === data.params.jobKey);
  if (!definition?.backlog) {
    throw new AppError(404, "SCHEDULED_JOB_NOT_FOUND", `No backlog for scheduled job '${data.params.jobKey}'`);
  }
  // The backlog names people and events, so reading it takes the job's own domain grants.
  for (const permission of definition.requiredPermissions ?? []) requirePermission(staff, permission);
  const result = await definition.backlog(db, data.query);
  return json(
    schedulerJobBacklogResponseSchema.parse({
      items: result.items,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.items.length),
    }),
  );
});
