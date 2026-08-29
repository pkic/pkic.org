import { eventFormConfigurationGetRouteSchema } from "../../../../../assets/shared/schemas/forms";
import { json } from "../../../../_lib/http";
import { logError } from "../../../../_lib/logging";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getEventBySlug } from "../../../../_lib/services/events";
import { getEventRegistrationConfiguration } from "../../../../_lib/services/events/registration-configuration";

function isMissingTableError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("no such table");
}

export const EventFormConfigurationGet = openApiRoute(eventFormConfigurationGetRouteSchema, async (c: any, data) => {
  const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
  try {
    return json(await getEventRegistrationConfiguration(c.env.DB, event, data.params.purpose));
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    logError("EVENT_FORM_CONFIGURATION_SCHEMA_MISSING", {
      eventSlug: event.slug,
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
