import { eventFormSubmissionStatsRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts-forms";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { getFormSubmissionStats } from "../../../../../../_lib/services/form-submissions";
import { requireEventForm, requireEventFormsPermission } from "../authorization";

export const EventFormSubmissionStatsGet = openApiRoute(
  eventFormSubmissionStatsRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event } = await requireEventFormsPermission(c, data.params.eventSlug, "events:read");
    await requireEventForm(db, event.id, data.params.formKey);
    return json(
      await getFormSubmissionStats(db, {
        ...data.query,
        formKey: data.params.formKey,
        eventSlug: event.slug,
      }),
    );
  },
);
