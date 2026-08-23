import { z } from "zod";

/** Response from the Cloudflare-derived visitor geolocation hint endpoint. */
export const geoResponseSchema = z.object({ country: z.string().nullable() });

export const geoRouteSchema = {
  tags: ["Public"],
  summary: "Get the visitor's Cloudflare country hint",
  description: "Returns the ISO 3166-1 alpha-2 country code detected by Cloudflare, or null when unavailable.",
  responses: {
    "200": {
      description: "The visitor country hint.",
      content: { "application/json": { schema: geoResponseSchema } },
    },
    "403": { description: "Cross-origin requests are not allowed." },
  },
};
