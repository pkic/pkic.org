import { eventFormPlacementGetRouteSchema } from "../../../../../../assets/shared/schemas/forms";
import { json } from "../../../../../_lib/http";
import { logError } from "../../../../../_lib/logging";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requestDb } from "../../../../../_lib/db/context";
import { getEventRegistrationConfigurationBySlug } from "../../../../../_lib/services/events/registration-configuration";

function isMissingTableError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("no such table");
}

export const EventFormPlacementGet = openApiRoute(eventFormPlacementGetRouteSchema, async (c: any, data) => {
  try {
    return json(
      await getEventRegistrationConfigurationBySlug(requestDb(c), data.params.eventSlug, data.params.purpose),
    );
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    logError("EVENT_FORM_PLACEMENT_SCHEMA_MISSING", {
      eventSlug: data.params.eventSlug,
      purpose: data.params.purpose,
    });
    return json(
      {
        error: {
          code: "BACKEND_SCHEMA_MISSING",
          message: "Event registration schema is not available yet. Run the latest database migrations.",
        },
      },
      503,
    );
  }
});
