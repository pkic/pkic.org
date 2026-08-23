import { openApiRoute } from "../../../../_lib/openapi/route";
import { getEventBySlug, getRequiredTerms } from "../../../../_lib/services/events";
import { json } from "../../../../_lib/http";
import { requiredTermReadModel } from "../../../../_lib/services/event-read-models";
import {
  eventTermsGetRouteSchema,
  eventTermsQuerySchema,
  eventTermsResponseSchema,
} from "../../../../../assets/shared/schemas/forms";

async function getTerms(c: any, audience: "attendee" | "speaker"): Promise<Response> {
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const terms = await getRequiredTerms(c.env.DB, event.id, audience);

  return json(
    eventTermsResponseSchema.parse({
      event: { id: event.id, slug: event.slug, name: event.name },
      audience,
      terms: terms.map(requiredTermReadModel),
    }),
  );
}

export const TermsGet = openApiRoute(eventTermsGetRouteSchema, (c: any, data) => getTerms(c, data.query.audience));

/** Compatibility entry point for direct Pages-function tests; validates the same shared contract. */
export async function onRequestGet(c: any): Promise<Response> {
  const parsed = eventTermsQuerySchema.safeParse(Object.fromEntries(new URL(c.req.raw.url).searchParams));
  if (!parsed.success) {
    return json({ error: { code: "VALIDATION_ERROR", message: "Invalid terms audience" } }, 400);
  }
  return getTerms(c, parsed.data.audience);
}
