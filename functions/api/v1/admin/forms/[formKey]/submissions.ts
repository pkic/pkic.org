/**
 * GET /api/v1/admin/forms/:formKey/submissions
 *
 * Returns a bounded, sortable, filterable page of submissions for a form
 * (merging in linked registration/proposal answers not yet backfilled into
 * form_submissions — see the form-submissions/population-query service), plus
 * Statistics are exposed separately at /submissions/stats so this collection
 * always follows the canonical list contract.
 */
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { listFormSubmissions } from "../../../../../_lib/services/form-submissions";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { adminFormSubmissionsListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";

export const AdminFormsFormKeySubmissionsGet = openApiRoute(
  adminFormSubmissionsListRouteSchema,
  async (c: AdminContext, data) => {
    await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

    const { limit, offset, q, status, attendanceType, eventSlug, sort } = data.query;

    const result = await listFormSubmissions(requestDb(c), {
      formKey: data.params.formKey,
      status: status ?? "",
      attendanceType: attendanceType ?? "",
      eventSlug: eventSlug ?? "",
      q,
      sort,
      limit,
      offset,
    });

    return json({
      form: result.form,
      page: buildPageInfo(result.limit, result.offset, result.total, result.submissions.length),
      submissions: result.submissions,
    });
  },
);
