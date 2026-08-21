import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getFormSubmissionStats } from "../../../../../_lib/services/form-submissions";
import { adminFormSubmissionStatsRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";

export const AdminFormsFormKeySubmissionStatsGet = openApiRoute(
  adminFormSubmissionStatsRouteSchema,
  async (c: AdminContext, data) => {
    await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const result = await getFormSubmissionStats(requestDb(c), {
      formKey: data.params.formKey,
      status: data.query.status ?? "",
      attendanceType: data.query.attendanceType ?? "",
      eventSlug: data.query.eventSlug ?? "",
      q: data.query.q,
    });
    return json(result);
  },
);
