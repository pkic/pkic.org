import { buildPageInfo } from "../../../../../../../assets/shared/schemas/pagination";
import { formSubmissionsResponseSchema } from "../../../../../../../assets/shared/schemas/form-management";
import { eventFormSubmissionsListRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts-forms";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { listFormSubmissions } from "../../../../../../_lib/services/form-submissions";
import { requireEventForm, requireEventFormsPermission } from "../authorization";

export const EventFormSubmissionsGet = openApiRoute(
  eventFormSubmissionsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event } = await requireEventFormsPermission(c, data.params.eventSlug, "events:read");
    await requireEventForm(db, event.id, data.params.formKey);
    const result = await listFormSubmissions(db, {
      ...data.query,
      formKey: data.params.formKey,
      eventSlug: event.slug,
    });
    return json(
      formSubmissionsResponseSchema.parse({
        form: result.form,
        page: buildPageInfo(result.limit, result.offset, result.total, result.submissions.length),
        submissions: result.submissions,
      }),
    );
  },
);
