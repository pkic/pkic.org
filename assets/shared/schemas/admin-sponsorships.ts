/**
 * Admin sponsorship sales pipeline (PRD §4.13, Phase 4E). Backs
 * `GET/POST /api/v1/admin/sponsorships`, `GET/PATCH .../:id`,
 * `PATCH .../:id/stage`, `GET .../:id/events`, and
 * `GET/PUT /api/v1/admin/events/:eventSlug/sponsor-tiers`.
 */
import { z } from "zod";
import { normalizedEmailSchema } from "./api";

function trimmedString(min: number, max: number): z.ZodString {
  return z.string().trim().min(min).max(max);
}

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

export const sponsorshipIdParamsSchema = z.object({ id: z.uuid() });

export const adminSponsorshipSchema = z.object({
  id: z.uuid(),
  sponsorType: z.string(),
  organizationId: z.uuid().nullable(),
  organizationName: z.string().nullable(),
  nonMemberName: z.string().nullable(),
  nonMemberWebsite: z.string().nullable(),
  nonMemberLogoUrl: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  eventId: z.uuid().nullable(),
  eventName: z.string().nullable(),
  tier: z.string().nullable(),
  pipelineStage: z.string(),
  startDate: z.string().nullable(),
  renewalDate: z.string().nullable(),
  assignedToUserId: z.uuid().nullable(),
  assignedToName: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const sponsorshipEventSchema = z.object({
  id: z.uuid(),
  fromStage: z.string().nullable(),
  toStage: z.string(),
  actorUserId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

// ── List ─────────────────────────────────────────────────────────────────

export const sponsorshipsListQuerySchema = z.object({
  type: sponsorTypeSchema.optional(),
  stage: sponsorshipPipelineStageSchema.optional(),
  tier: trimmedString(1, 100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const sponsorshipsListRouteSchema = {
  tags: ["Sponsorships"],
  summary: "List sponsorships (admin sales pipeline)",
  description: "Paginated, optionally filtered by sponsor type / pipeline stage / tier.",
  request: { query: sponsorshipsListQuerySchema },
  responses: {
    "200": {
      description: "Sponsorships list.",
      content: {
        "application/json": {
          schema: z.object({
            sponsorships: z.array(adminSponsorshipSchema),
            page: z.object({ limit: z.number(), offset: z.number(), total: z.number(), hasMore: z.boolean() }),
          }),
        },
      },
    },
  },
};

// ── Create ───────────────────────────────────────────────────────────────

export const sponsorshipCreateSchema = z
  .object({
    sponsorType: sponsorTypeSchema,
    organizationId: z.uuid().nullable().optional(),
    nonMemberName: trimmedString(1, 200).nullable().optional(),
    nonMemberWebsite: z.url().nullable().optional(),
    contactName: trimmedString(1, 200).nullable().optional(),
    contactEmail: normalizedEmailSchema.nullable().optional(),
    eventId: z.uuid().nullable().optional(),
    tier: trimmedString(1, 100).nullable().optional(),
    assignedToUserId: z.uuid().nullable().optional(),
    renewalDate: z.iso.date().nullable().optional(),
    notes: trimmedString(0, 5000).nullable().optional(),
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
        "application/json": { schema: z.object({ success: z.boolean(), r2Key: z.string(), logoUrl: z.string() }) },
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

export const sponsorshipUpdateSchema = z.object({
  tier: trimmedString(1, 100).nullable().optional(),
  assignedToUserId: z.uuid().nullable().optional(),
  renewalDate: z.iso.date().nullable().optional(),
  notes: trimmedString(0, 5000).nullable().optional(),
});

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
  summary: "Full pipeline audit trail for a sponsorship",
  request: { params: sponsorshipIdParamsSchema },
  responses: {
    "200": {
      description: "Sponsorship events.",
      content: { "application/json": { schema: z.object({ events: z.array(sponsorshipEventSchema) }) } },
    },
  },
};

// ── Per-event sponsor attendee-data-access tier config ─────────────────

export const eventSponsorTierSchema = z.object({
  tierName: trimmedString(1, 100),
  hasAttendeeDataAccess: z.boolean(),
});

export const eventSponsorTiersReplaceSchema = z.object({
  tiers: z.array(eventSponsorTierSchema).max(50),
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
