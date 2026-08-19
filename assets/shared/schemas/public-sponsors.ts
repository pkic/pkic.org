import { z } from "zod";
import { paginationQuerySchema, paginatedResponseSchema } from "./pagination";

/** Schemas for the public sponsor display endpoints. */

export const publicSponsorItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  website: z.string().nullable(),
  logoUrl: z.string().nullable(),
  tier: z.string().nullable(),
  eventTier: z.string().nullable(),
});

export const sponsorsListQuerySchema = paginationQuerySchema.extend({
  eventName: z.string().trim().min(1).max(200).optional(),
});

export const sponsorsListResponseSchema = paginatedResponseSchema("sponsors", publicSponsorItemSchema);

export const sponsorsListRouteSchema = {
  tags: ["Sponsors"],
  summary: "Public sponsor list",
  description:
    "Publicly readable consortium + event sponsors, sourced from D1 (organizations.sponsor_tier / sponsorships). " +
    "Optional ?eventName= merges in that event's active event-tier sponsorships onto the same records. " +
    "Paginated via ?limit=/?offset= (default limit 200, max 200).",
  request: { query: sponsorsListQuerySchema },
  responses: {
    "200": {
      description: "Sponsor list.",
      content: { "application/json": { schema: sponsorsListResponseSchema } },
    },
  },
};

export const sponsorLogoRouteSchema = {
  tags: ["Sponsors"],
  summary: "Public non-member sponsor logo",
  description:
    "Logo for a non-member sponsor (sponsorships.non_member_logo_r2_key). Org-tied sponsors use GET /api/v1/members/:id/logo instead.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": { description: "Logo image bytes." },
    "404": { description: "No logo on file." },
  },
};
