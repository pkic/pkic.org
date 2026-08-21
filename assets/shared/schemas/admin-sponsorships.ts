/**
 * Admin sponsorship sales pipeline. Backs
 * `GET/POST /api/v1/admin/sponsorships`, `GET/PATCH .../:id`,
 * `PATCH .../:id/stage`, `GET .../:id/events`, and
 * `GET/PUT /api/v1/admin/events/:eventSlug/sponsor-tiers`.
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { eventIdSchema, normalizedEmailSchema, trimmedString } from "./api-common";
import {
  listQuerySchema,
  paginatedResponseSchema,
  searchableListQuerySchema,
  sortColumnSchemaWithDefault,
} from "./pagination";
import { addDuplicateStringIssues } from "./refinements";
import { httpOrSameOriginUrlSchema, httpUrlSchema } from "./urls";
import { logoUploadResponseSchema } from "./images";

export const SPONSOR_TYPES = ["consortium", "event"] as const;
export const sponsorTypeSchema = z.enum(SPONSOR_TYPES);

export const SPONSORSHIP_PIPELINE_STAGES = [
  "new_inquiry",
  "contacted",
  "proposal_sent",
  "negotiating",
  "payment_pending",
  "active",
  "lapsed",
] as const;
export const sponsorshipPipelineStageSchema = z.enum(SPONSORSHIP_PIPELINE_STAGES);
export type SponsorshipPipelineStage = (typeof SPONSORSHIP_PIPELINE_STAGES)[number];

export const sponsorshipIdParamsSchema = z.object({ id: databaseIdSchema });

export const adminSponsorshipSchema = z.object({
  id: databaseIdSchema,
  sponsorType: sponsorTypeSchema,
  organizationId: databaseIdSchema.nullable(),
  organizationName: z.string().nullable(),
  nonMemberName: z.string().nullable(),
  nonMemberWebsite: httpUrlSchema.nullable(),
  nonMemberLogoUrl: httpOrSameOriginUrlSchema.nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  eventId: eventIdSchema.nullable(),
  eventName: z.string().nullable(),
  // tier is intentionally a bare string, not a z.enum — it's a
  // reference-table-backed evolvable vocabulary (sponsorship_tier_config,
  // consolidated migration 0035), not a fixed code enum (PR #1 review §1.3's "reference
  // table" enforcement category).
  tier: z.string().nullable(),
  pipelineStage: sponsorshipPipelineStageSchema,
  startDate: z.string().nullable(),
  renewalDate: z.string().nullable(),
  assignedToUserId: databaseIdSchema.nullable(),
  assignedToName: z.string().nullable(),
  notes: z.string().nullable(),
  priceAmountCents: z.number().nullable(),
  priceCurrency: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const sponsorshipEventSchema = z.object({
  id: databaseIdSchema,
  fromStage: sponsorshipPipelineStageSchema.nullable(),
  toStage: sponsorshipPipelineStageSchema,
  actorUserId: databaseIdSchema.nullable(),
  actorName: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export type AdminSponsorship = z.infer<typeof adminSponsorshipSchema>;
export type SponsorshipEvent = z.infer<typeof sponsorshipEventSchema>;

export const SPONSORSHIP_EVENTS_SORT_COLUMNS = ["createdAt"] as const;
export const sponsorshipEventsListQuerySchema = searchableListQuerySchema(
  sortColumnSchemaWithDefault(SPONSORSHIP_EVENTS_SORT_COLUMNS, "-createdAt"),
  { limit: 25 },
);
export type SponsorshipEventsListQuery = z.infer<typeof sponsorshipEventsListQuerySchema>;
export const sponsorshipEventsListResponseSchema = paginatedResponseSchema("events", sponsorshipEventSchema);
export type SponsorshipEventsListResponse = z.infer<typeof sponsorshipEventsListResponseSchema>;

// ── List ─────────────────────────────────────────────────────────────────

export const ADMIN_SPONSORSHIP_SORT_COLUMNS = [
  "company",
  "eventName",
  "tier",
  "pipelineStage",
  "renewalDate",
  "updatedAt",
] as const;

export const sponsorshipsListQuerySchema = listQuerySchema(ADMIN_SPONSORSHIP_SORT_COLUMNS).extend({
  type: sponsorTypeSchema.optional(),
  stage: sponsorshipPipelineStageSchema.optional(),
  tier: trimmedString(1, 100).optional(),
  // Company-scoped filters — decomposed from a company list row's `key`,
  // used to fetch one company's sponsorships for the detail panel instead
  // of the full list.
  organizationId: databaseIdSchema.optional(),
  nonMemberName: trimmedString(1, 200).optional(),
  contactName: trimmedString(1, 200).optional(),
});

export const sponsorshipsListRouteSchema = {
  tags: ["Sponsorships"],
  summary: "List sponsorships (admin sales pipeline)",
  description: "Paginated, optionally filtered by sponsor type / pipeline stage / tier / company.",
  request: { query: sponsorshipsListQuerySchema },
  responses: {
    "200": {
      description: "Sponsorships list.",
      content: {
        "application/json": { schema: paginatedResponseSchema("sponsorships", adminSponsorshipSchema) },
      },
    },
  },
};

// ── Companies (grouped list) ────────────────────────────────────────────

export const sponsorshipCompanySchema = z.object({
  key: z.string(),
  label: z.string(),
  website: httpUrlSchema.nullable(),
  sponsorshipCount: z.number(),
  /** Comma-separated distinct pipeline stages across this company's sponsorships. */
  stages: z.string(),
});

export type SponsorshipCompany = z.infer<typeof sponsorshipCompanySchema>;

export const ADMIN_SPONSORSHIP_COMPANY_SORT_COLUMNS = ["label", "sponsorshipCount"] as const;

export const sponsorshipCompaniesListQuerySchema = listQuerySchema(ADMIN_SPONSORSHIP_COMPANY_SORT_COLUMNS).extend({
  type: sponsorTypeSchema.optional(),
  stage: sponsorshipPipelineStageSchema.optional(),
  tier: trimmedString(1, 100).optional(),
});
export const sponsorshipCompaniesListResponseSchema = paginatedResponseSchema("companies", sponsorshipCompanySchema);

export const sponsorshipCompaniesListRouteSchema = {
  tags: ["Sponsorships"],
  summary: "List sponsorship companies (admin sales pipeline, grouped)",
  description:
    "Paginated companies (member organization, or non-member sponsor/contact name) matching sponsorships, grouped and sorted in D1 — not the full sponsorship list.",
  request: { query: sponsorshipCompaniesListQuerySchema },
  responses: {
    "200": {
      description: "Sponsorship companies list.",
      content: {
        "application/json": { schema: sponsorshipCompaniesListResponseSchema },
      },
    },
  },
};

// ── Create ───────────────────────────────────────────────────────────────

export const sponsorshipEditableFieldsSchema = z.object({
  tier: trimmedString(1, 100).nullable().optional(),
  assignedToUserId: databaseIdSchema.nullable().optional(),
  renewalDate: z.iso.date().nullable().optional(),
  notes: trimmedString(0, 5000).nullable().optional(),
});

export const sponsorshipCreateSchema = z
  .object({
    sponsorType: sponsorTypeSchema,
    organizationId: databaseIdSchema.nullable().optional(),
    nonMemberName: trimmedString(1, 200).nullable().optional(),
    nonMemberWebsite: httpUrlSchema.nullable().optional(),
    contactName: trimmedString(1, 200).nullable().optional(),
    contactEmail: normalizedEmailSchema.nullable().optional(),
    eventId: eventIdSchema.nullable().optional(),
    ...sponsorshipEditableFieldsSchema.shape,
  })
  .refine((v) => v.sponsorType !== "consortium" || !!v.organizationId, {
    message: "organizationId is required for consortium sponsorships",
    path: ["organizationId"],
  });

export const sponsorshipCreateRouteSchema = {
  tags: ["Sponsorships"],
  summary: "Create a sponsorship record (staff-initiated)",
  description:
    "For sponsorships not sourced from a public inquiry/checkout — e.g. a negotiated deal booked directly by staff.",
  request: {
    body: { content: { "application/json": { schema: sponsorshipCreateSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Sponsorship created.",
      content: { "application/json": { schema: z.object({ sponsorship: adminSponsorshipSchema }) } },
    },
  },
};

// ── Get ──────────────────────────────────────────────────────────────────

export const sponsorshipGetRouteSchema = {
  tags: ["Sponsorships"],
  summary: "Get a sponsorship's detail",
  request: { params: sponsorshipIdParamsSchema },
  responses: {
    "200": {
      description: "Sponsorship detail.",
      content: { "application/json": { schema: z.object({ sponsorship: adminSponsorshipSchema }) } },
    },
    "404": { description: "Sponsorship not found." },
  },
};

// ── Logo (non-member sponsors only) ─────────────────────────────────────

export const sponsorshipLogoPutRouteSchema = {
  tags: ["Sponsorships"],
  summary: "Upload or replace a non-member sponsor's logo",
  description:
    "Only valid for non-member sponsorships (organization_id IS NULL). Served via GET /api/v1/sponsors/:id/logo.",
  request: { params: sponsorshipIdParamsSchema },
  responses: {
    "200": {
      description: "Logo uploaded.",
      content: {
        "application/json": {
          schema: logoUploadResponseSchema,
        },
      },
    },
    "404": { description: "Sponsorship not found." },
    "415": { description: "Unsupported image type." },
    "413": { description: "File too large." },
    "422": {
      description: "Sponsorship is linked to a member organization — upload its logo via the organization instead.",
    },
  },
};

export const sponsorshipLogoDeleteRouteSchema = {
  tags: ["Sponsorships"],
  summary: "Remove a non-member sponsor's logo",
  request: { params: sponsorshipIdParamsSchema },
  responses: {
    "200": { description: "Logo removed." },
    "404": { description: "Sponsorship not found." },
    "422": {
      description: "Sponsorship is linked to a member organization — remove its logo via the organization instead.",
    },
  },
};

// ── Update ───────────────────────────────────────────────────────────────

export const sponsorshipUpdateSchema = sponsorshipEditableFieldsSchema;

export const sponsorshipUpdateRouteSchema = {
  tags: ["Sponsorships"],
  summary: "Update a sponsorship's fields",
  description: "Tier, assigned staff, renewal date, notes. Use PATCH .../:id/stage to advance the pipeline.",
  request: {
    params: sponsorshipIdParamsSchema,
    body: { content: { "application/json": { schema: sponsorshipUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Sponsorship updated.",
      content: { "application/json": { schema: z.object({ sponsorship: adminSponsorshipSchema }) } },
    },
    "404": { description: "Sponsorship not found." },
  },
};

// ── Stage transition ────────────────────────────────────────────────────

export const sponsorshipStageUpdateSchema = z.object({
  toStage: sponsorshipPipelineStageSchema,
  note: trimmedString(0, 2000).nullable().optional(),
});

export const sponsorshipStageUpdateRouteSchema = {
  tags: ["Sponsorships"],
  summary: "Advance a sponsorship's pipeline stage",
  description:
    "Records the transition in sponsorship_events. Reaching 'active' writes organizations.sponsor_tier/sponsor_start_date for consortium sponsors; reaching 'lapsed' clears them.",
  request: {
    params: sponsorshipIdParamsSchema,
    body: { content: { "application/json": { schema: sponsorshipStageUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Stage updated.",
      content: { "application/json": { schema: z.object({ sponsorship: adminSponsorshipSchema }) } },
    },
    "400": { description: "Unknown pipeline stage." },
    "404": { description: "Sponsorship not found." },
  },
};

// ── Events (audit trail) ────────────────────────────────────────────────

export const sponsorshipEventsRouteSchema = {
  tags: ["Sponsorships"],
  summary: "Paginated pipeline audit trail for a sponsorship",
  request: { params: sponsorshipIdParamsSchema, query: sponsorshipEventsListQuerySchema },
  responses: {
    "200": {
      description: "Sponsorship events.",
      content: { "application/json": { schema: sponsorshipEventsListResponseSchema } },
    },
  },
};

// ── Per-event sponsor attendee-data-access tier config ─────────────────

export const eventSponsorTierSchema = z.object({
  tierName: trimmedString(1, 100),
  hasAttendeeDataAccess: z.boolean(),
});

export const eventSponsorTiersReplaceSchema = z
  .object({
    tiers: z.array(eventSponsorTierSchema).max(50),
  })
  .superRefine((value, ctx) => {
    addDuplicateStringIssues(value.tiers, ctx, {
      value: (tier) => tier.tierName.toLowerCase(),
      path: (index) => ["tiers", index, "tierName"],
      label: "Sponsor tier",
    });
  });

export const eventSponsorTiersGetRouteSchema = {
  tags: ["Sponsorships"],
  summary: "View per-event sponsor attendee-data-access config",
  responses: {
    "200": {
      description: "Sponsor tier config for this event.",
      content: { "application/json": { schema: z.object({ tiers: z.array(eventSponsorTierSchema) }) } },
    },
  },
};

export const eventSponsorTiersPutRouteSchema = {
  tags: ["Sponsorships"],
  summary: "Replace per-event sponsor attendee-data-access config",
  request: {
    body: { content: { "application/json": { schema: eventSponsorTiersReplaceSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Sponsor tier config replaced.",
      content: { "application/json": { schema: z.object({ tiers: z.array(eventSponsorTierSchema) }) } },
    },
  },
};

// ── Sponsorship tier pricing config (self-service checkout) ──
//
// Managed data, not a code constant (consolidated migration 0035) — a price change is a
// PATCH, not a deployment. Distinct from eventSponsorTiersSchema above,
// which controls attendee-data-access per event, not pricing.

export const sponsorshipTierConfigSchema = z.object({
  id: databaseIdSchema,
  sponsorType: sponsorTypeSchema,
  tier: z.string(),
  currency: z.string(),
  amountCents: z.number(),
  active: z.boolean(),
});

export const sponsorshipTierConfigListRouteSchema = {
  tags: ["Sponsorships"],
  summary: "List sponsorship tier pricing config",
  responses: {
    "200": {
      description: "Tier pricing config.",
      content: { "application/json": { schema: z.object({ tiers: z.array(sponsorshipTierConfigSchema) }) } },
    },
  },
};

export const sponsorshipTierConfigIdParamsSchema = z.object({ id: databaseIdSchema });

export const sponsorshipTierConfigUpdateSchema = z.object({
  amountCents: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().trim().toLowerCase().length(3).optional(),
  active: z.boolean().optional(),
});

export const sponsorshipTierConfigUpdateRouteSchema = {
  tags: ["Sponsorships"],
  summary: "Update a sponsorship tier's price/currency/active state",
  request: {
    params: sponsorshipTierConfigIdParamsSchema,
    body: { content: { "application/json": { schema: sponsorshipTierConfigUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Updated.",
      content: { "application/json": { schema: z.object({ tier: sponsorshipTierConfigSchema }) } },
    },
    "404": { description: "Tier config not found." },
  },
};
