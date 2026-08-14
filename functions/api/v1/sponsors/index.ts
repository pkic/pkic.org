/**
 * GET /api/v1/sponsors
 *
 * Public, unauthenticated sponsor list —
 * mirrors GET /api/v1/members's cache-control convention so the public
 * sponsor wall/strip/level pages can be cheap to hit repeatedly.
 */
import { json } from "../../../_lib/http";
import { listPublicSponsors } from "../../../_lib/services/public-sponsors";
import { sponsorsListQuerySchema, sponsorsListRouteSchema } from "../../../../assets/shared/schemas/public-sponsors";
import { openApiRoute } from "../../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export async function onRequestGet(c: any): Promise<Response> {
  const url = new URL(c.req.raw.url);
  const parsed = sponsorsListQuerySchema.safeParse({
    eventName: url.searchParams.get("eventName") ?? undefined,
  });
  const eventName = parsed.success ? parsed.data.eventName : undefined;

  const sponsors = await listPublicSponsors(c.env.DB, { eventName });

  const response = json({ sponsors });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
}

// Thin openApiRoute wrap — onRequestGet is imported directly by
// tests/public-sponsors-api.test.ts, so its lenient
// safeParse-then-ignore-on-failure query handling stays untouched. GET has
// no request body, so wrapping is safe (no double-body-read risk).
export const SponsorsGet = openApiRoute(sponsorsListRouteSchema, (c: any) => onRequestGet(c));
