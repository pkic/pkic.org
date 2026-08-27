import { dispatchRequestMethod, json } from "../../../../_lib/http";
import { getEventBySlug } from "../../../../_lib/services/events";
import { getEventRegistrationConfiguration } from "../../../../_lib/services/events/registration-configuration";
import { logError } from "../../../../_lib/logging";
import { eventFormsGetRouteSchema, type EventFormsPurpose } from "../../../../../assets/shared/schemas/forms";
import { openApiRoute } from "../../../../_lib/openapi/route";

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("no such table");
}

async function getEventForm(c: any, purpose: EventFormsPurpose): Promise<Response> {
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));

  try {
    return json(await getEventRegistrationConfiguration(c.env.DB, event, purpose));
  } catch (error) {
    if (isMissingTableError(error)) {
      logError("EVENT_FORM_CONFIGURATION_SCHEMA_MISSING", { eventSlug: event.slug, purpose });
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
    throw error;
  }
}

export const EventFormsGet = openApiRoute(eventFormsGetRouteSchema, async (c: any, data) =>
  getEventForm(c, data.query.purpose),
);

export async function onRequestGet(c: any): Promise<Response> {
  const parsed = eventFormsGetRouteSchema.request.query.safeParse(
    Object.fromEntries(new URL(c.req.raw.url).searchParams),
  );
  if (!parsed.success) {
    return json({ error: { code: "VALIDATION_ERROR", message: "Invalid form purpose" } }, 400);
  }
  return getEventForm(c, parsed.data.purpose);
}

export async function onRequest(c: any): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet });
}
