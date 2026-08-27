/**
 * GET /api/v1/system/membership-applications/:id/documents — staff view of all
 * documents uploaded for an application.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { getMemberApplicationById } from "../../../../../_lib/services/membership/applications/queries";
import { listStaffApplicationDocuments } from "../../../../../_lib/services/membership/applications/documents";
import { AppError } from "../../../../../_lib/errors";
import { staffApplicationDocumentsListRouteSchema } from "../../../../../../assets/shared/schemas/membership-application-management";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireSystemPermission } from "../../authorization";

export const StaffApplicationDocumentsGet = openApiRoute(
  staffApplicationDocumentsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireSystemPermission(c, "membership:read");

    const applicationId = data.params.id;
    const application = await getMemberApplicationById(db, applicationId);
    if (!application) {
      throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
    }

    return json(await listStaffApplicationDocuments(db, applicationId, data.query));
  },
);
