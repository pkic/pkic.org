import { z } from "zod";
import {
  PUBLIC_SPONSOR_SORT_COLUMNS,
  sponsorsListQuerySchema as publicSponsorsListQuerySchema,
  sponsorsListResponseSchema as publicSponsorsListResponseSchema,
} from "./public-sponsors";
import {
  SPONSORSHIP_SORT_COLUMNS,
  sponsorshipTierConfigListResponseSchema,
  sponsorshipsListQuerySchema,
  sponsorshipsListResponseSchema,
} from "./sponsorship-management";
import { sponsorshipTiersResponseSchema, sponsorshipTypeSchema } from "./sponsorship";
import { booleanQueryFlagSchema } from "./api-common";
import { listQuerySchema } from "./pagination";

const SPONSOR_SORT_COLUMNS = [...PUBLIC_SPONSOR_SORT_COLUMNS, ...SPONSORSHIP_SORT_COLUMNS] as const;

export const sponsorsCollectionQuerySchema = listQuerySchema(SPONSOR_SORT_COLUMNS).extend({
  visibility: z.enum(["public", "all"]).default("public"),
  eventSlug: publicSponsorsListQuerySchema.shape.eventSlug,
  eventName: publicSponsorsListQuerySchema.shape.eventName,
  level: publicSponsorsListQuerySchema.shape.level,
  minWeight: publicSponsorsListQuerySchema.shape.minWeight,
  type: sponsorshipsListQuerySchema.shape.type,
  stage: sponsorshipsListQuerySchema.shape.stage,
  tier: sponsorshipsListQuerySchema.shape.tier,
  organizationId: sponsorshipsListQuerySchema.shape.organizationId,
  nonMemberName: sponsorshipsListQuerySchema.shape.nonMemberName,
  contactName: sponsorshipsListQuerySchema.shape.contactName,
});
export type SponsorsCollectionQuery = z.infer<typeof sponsorsCollectionQuerySchema>;

export const sponsorsCollectionResponseSchema = z.union([
  publicSponsorsListResponseSchema,
  sponsorshipsListResponseSchema,
]);

export const sponsorsCollectionRouteSchema = {
  tags: ["Sponsors"],
  summary: "List sponsors visible to the caller",
  description:
    "The default public representation returns active sponsors only. visibility=all requires sponsorships:read and returns the staff pipeline projection; filtering, sorting, and pagination stay in D1 for both representations.",
  request: { query: sponsorsCollectionQuerySchema },
  responses: {
    "200": {
      description: "Sponsors visible in the requested representation.",
      content: { "application/json": { schema: sponsorsCollectionResponseSchema } },
    },
    "403": { description: "visibility=all requires sponsorships:read." },
  },
};

export const sponsorTiersQuerySchema = z.object({
  includeInactive: booleanQueryFlagSchema.default(false),
  sponsorType: sponsorshipTypeSchema.optional(),
});

export const publicSponsorTiersResponseSchema = sponsorshipTiersResponseSchema.extend({
  visibility: z.literal("public"),
});
export const managedSponsorTiersResponseSchema = sponsorshipTierConfigListResponseSchema.extend({
  visibility: z.literal("all"),
});
export const sponsorTiersResponseSchema = z.union([
  publicSponsorTiersResponseSchema,
  managedSponsorTiersResponseSchema,
]);

export const sponsorTiersRouteSchema = {
  tags: ["Sponsors"],
  summary: "List sponsor tiers visible to the caller",
  description:
    "Public callers receive active tier names for one sponsor type. includeInactive=true requires sponsorships:read and returns the editable pricing catalog.",
  request: { query: sponsorTiersQuerySchema },
  responses: {
    "200": {
      description: "Sponsor tier representation.",
      content: { "application/json": { schema: sponsorTiersResponseSchema } },
    },
    "403": { description: "The expanded tier catalog requires sponsorships:read." },
  },
};
