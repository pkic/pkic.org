import { z } from "zod";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

/** Schemas for the public sponsor display endpoints. */

export const publicSponsorItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  website: z.string().nullable(),
  logoUrl: z.string().nullable(),
  tier: z.string().nullable(),
  eventTier: z.string().nullable(),
  effectiveTier: z.string(),
  weight: z.number().int().min(1).max(8),
});
export type PublicSponsor = z.infer<typeof publicSponsorItemSchema>;

export const PUBLIC_SPONSOR_SORT_COLUMNS = ["name", "weight"] as const;
export const sponsorsListQuerySchema = listQuerySchema(PUBLIC_SPONSOR_SORT_COLUMNS).extend({
  eventName: z.string().trim().min(1).max(200).optional(),
  level: z.string().trim().min(1).max(100).optional(),
  minWeight: z.coerce.number().int().min(1).max(8).optional(),
});

export const sponsorsListResponseSchema = paginatedResponseSchema("sponsors", publicSponsorItemSchema);
export type SponsorsListResponse = z.infer<typeof sponsorsListResponseSchema>;

export const sponsorsListRouteSchema = {
  tags: ["Sponsors"],
  summary: "Public sponsor list",
  description:
    "Publicly readable consortium + event sponsors, sourced from D1 (organizations.sponsor_tier / sponsorships). " +
    "Optional event/tier/search filters, allowlisted sorting, and pagination are executed in D1. " +
    "Tier display weights are read from sponsorship_tier_catalog rather than duplicated in clients.",
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
