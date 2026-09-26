import type { ValidatedData } from "chanfana";
import { getCsvExportLimits } from "../../../../../_lib/config";
import { csvResponse } from "../../../../../_lib/csv";
import type { AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { buildRegistrationCsvWithAudit } from "../../../../../_lib/services/registrations/export";
import { eventRegistrationExportRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-event-registration-management";
import { requireEventRegistrationManagement } from "./authorization";

async function handleEventRegistrationExport(
  c: AdminContext,
  data: ValidatedData<typeof eventRegistrationExportRouteSchema>,
): Promise<Response> {
  const { actor, db, event } = await requireEventRegistrationManagement(c, data.params.eventSlug);
  const result = await buildRegistrationCsvWithAudit(
    db,
    { id: event.id, source_mode: event.source_mode ?? null },
    actor.id,
    getCsvExportLimits(c.env),
  );
  return csvResponse(result.csv, `${event.slug}-attendees.csv`);
}

export const EventRegistrationExportGet = openApiRoute(
  eventRegistrationExportRouteSchema,
  handleEventRegistrationExport,
);
