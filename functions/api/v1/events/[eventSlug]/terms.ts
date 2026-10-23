import { openApiRoute } from "../../../../_lib/openapi/route";
import { getEventTerms } from "../../../../_lib/services/events/terms-read";
import { requestDb } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { eventTermsGetRouteSchema, eventTermsQuerySchema } from "../../../../../assets/shared/schemas/forms";

async function getTerms(c: any, eventSlug: string, audience: "attendee" | "speaker"): Promise<Response> {
  return json(await getEventTerms(requestDb(c), eventSlug, audience));
}

export const TermsGet = openApiRoute(eventTermsGetRouteSchema, (c: any, data) =>
  getTerms(c, data.params.eventSlug, data.query.audience),
);

/** Compatibility entry point for direct Pages-function tests; validates the same shared contract. */
export async function onRequestGet(c: any): Promise<Response> {
  const parsed = eventTermsQuerySchema.safeParse(Object.fromEntries(new URL(c.req.raw.url).searchParams));
  if (!parsed.success) {
    return json({ error: { code: "VALIDATION_ERROR", message: "Invalid terms audience" } }, 400);
  }
  return getTerms(c, c.req.param("eventSlug"), parsed.data.audience);
}
