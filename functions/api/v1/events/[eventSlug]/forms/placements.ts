import { eventFormPlacementGetRouteSchema } from "../../../../../../assets/shared/schemas/forms";
import { json } from "../../../../../_lib/http";
import { logError } from "../../../../../_lib/logging";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requestDb } from "../../../../../_lib/db/context";
import { prepareOptionalRequestViewer } from "../../../../../_lib/auth/optional-request-viewer";
import { getEventRegistrationConfigurationBySlug } from "../../../../../_lib/services/events/registration-configuration";

function isMissingTableError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("no such table");
}

export const EventFormPlacementGet = openApiRoute(eventFormPlacementGetRouteSchema, async (c: any, data) => {
  try {
    const db = requestDb(c);
    const auth = await prepareOptionalRequestViewer(db, c.req.raw, c.env);
    return json(await getEventRegistrationConfigurationBySlug(db, data.params.eventSlug, data.params.purpose, auth));
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
