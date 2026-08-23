import { z } from "zod";

/** Response from the Cloudflare-derived visitor geolocation hint endpoint. */
export const geoResponseSchema = z.object({ country: z.string().nullable() });
