import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, pageInfoSchema, paginatedResponseSchema } from "./pagination";
import { httpOrSameOriginUrlSchema, httpUrlSchema } from "./urls";

/** Schemas for the public sponsor display endpoints. */

export const publicSponsorItemSchema = z.object({
  id: databaseIdSchema,
  name: z.string(),
  website: httpUrlSchema.nullable(),
  logoUrl: httpOrSameOriginUrlSchema.nullable(),
  tier: z.string().nullable(),
  eventTier: z.string().nullable(),
  effectiveTier: z.string(),
  weight: z.number().int().positive(),
});
export type PublicSponsor = z.infer<typeof publicSponsorItemSchema>;

export const PUBLIC_SPONSOR_SORT_COLUMNS = ["name", "weight"] as const;
export const sponsorsListQuerySchema = listQuerySchema(PUBLIC_SPONSOR_SORT_COLUMNS, { limit: 200 }).extend({
  /** Stable event identity. `eventName` remains a legacy fallback for old shortcode callers. */
  eventSlug: z.string().trim().min(1).max(200).optional(),
  eventName: z.string().trim().min(1).max(200).optional(),
  level: z.string().trim().min(1).max(100).optional(),
  minWeight: z.coerce.number().int().positive().optional(),
});

export const sponsorsListResponseSchema = paginatedResponseSchema("sponsors", publicSponsorItemSchema);
export type SponsorsListResponse = z.infer<typeof sponsorsListResponseSchema>;

export const publicSponsorDisplayGroupSchema = z.object({
  weight: z.number().int().positive(),
  tierName: z.string(),
  sponsors: z.array(publicSponsorItemSchema),
});
export const sponsorsDisplayResponseSchema = z.object({
  groups: z.array(publicSponsorDisplayGroupSchema),
  page: pageInfoSchema,
});
export type SponsorsDisplayResponse = z.infer<typeof sponsorsDisplayResponseSchema>;

export const sponsorsListRouteSchema = {
  tags: ["Sponsors"],
  summary: "Public sponsor list",
  description:
    "Publicly readable consortium + event sponsors, sourced from D1 (organizations.sponsor_tier / sponsorships). " +
    "Optional stable event slug (with legacy event-name fallback), tier/search filters, allowlisted sorting, and pagination are executed in D1. " +
    "Tier display weights are read from sponsorship_tier_catalog rather than duplicated in clients.",
  request: { query: sponsorsListQuerySchema },
  responses: {
    "200": {
      description: "Sponsor list.",
      content: { "application/json": { schema: sponsorsListResponseSchema } },
    },
  },
};

export const sponsorsDisplayRouteSchema = {
  tags: ["Sponsors"],
  summary: "Public sponsor display groups",
  description:
    "Returns one bounded, D1-paged sponsor page grouped by catalog display weight for grid and level presentations.",
  request: { query: sponsorsListQuerySchema },
  responses: {
    "200": {
      description: "Grouped sponsor display page.",
      content: { "application/json": { schema: sponsorsDisplayResponseSchema } },
    },
  },
};

export const sponsorLogoRouteSchema = {
  tags: ["Sponsors"],
  summary: "Public non-member sponsor logo",
  description:
    "Logo for a non-member sponsor (sponsorships.non_member_logo_r2_key). Org-tied sponsors use GET /api/v1/members/:id/logo instead.",
  request: { params: z.object({ id: databaseIdSchema }) },
  responses: {
    "200": { description: "Logo image bytes." },
    "404": { description: "No logo on file." },
  },
};
