import { eventFormSubmissionsExportRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts-forms";
import { getCsvExportLimits } from "../../../../../../_lib/config";
import { csvResponse } from "../../../../../../_lib/csv";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { exportEventFormResponses } from "../../../../../../_lib/services/form-submissions/export";
import { requireEventForm, requireEventFormsPermission } from "../authorization";

export const EventFormResponsesExportGet = openApiRoute(
  eventFormSubmissionsExportRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventFormsPermission(c, data.params.eventSlug, "events:read");
    const definition = await requireEventForm(db, event.id, data.params.formKey);
    const csv = await exportEventFormResponses(
      db,
      {
        ...data.query,
        definition,
        eventSlug: event.slug,
        eventId: event.id,
        actorUserId: actor.id,
      },
      getCsvExportLimits(c.env),
    );
    return csvResponse(csv, `${event.slug}-${data.params.formKey}-responses.csv`);
  },
);
