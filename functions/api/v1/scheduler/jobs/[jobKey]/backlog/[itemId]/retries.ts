import {
  schedulerJobBacklogRetryResponseSchema,
  schedulerJobBacklogRetryRouteSchema,
} from "../../../../../../../../assets/shared/schemas/scheduler";
import { requirePermission } from "../../../../../../../_lib/auth/permissions";
import { requireStaffPermission } from "../../../../../../../_lib/auth/staff-permissions";
import { markResponseSensitive, type AdminContext } from "../../../../../../../_lib/db/context";
import { AppError } from "../../../../../../../_lib/errors";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { SCHEDULED_JOB_DEFINITIONS } from "../../../../../../../_lib/services/scheduled-jobs/registry";

export const SchedulerJobBacklogRetryCreate = openApiRoute(
  schedulerJobBacklogRetryRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { staff } = await requireStaffPermission(c, "scheduler:read");
    requirePermission(staff, "scheduler:manage");
    const definition = SCHEDULED_JOB_DEFINITIONS.find((job) => job.key === data.params.jobKey);
    if (!definition?.retryBacklogItem) {
      throw new AppError(
        404,
        "SCHEDULED_JOB_NOT_FOUND",
        `No retryable backlog for scheduled job '${data.params.jobKey}'`,
      );
    }
    // Retrying through the scheduler must not grant what the caller could not do in the job's own domain.
    for (const permission of definition.requiredPermissions ?? []) requirePermission(staff, permission);
    const outcome = await definition.retryBacklogItem(c.env, data.params.itemId);
    return json(schedulerJobBacklogRetryResponseSchema.parse({ success: true, ...outcome }));
  },
);
