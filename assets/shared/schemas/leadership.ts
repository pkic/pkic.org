import { z } from "zod";
import { trimmedString } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { publicOrganizationPersonSchema } from "./public-person";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

/**
 * Leadership positions (consolidated migration 0035) — Board of Directors and Executive
 * Council rosters, system-managed and publicly readable. Replaces the static
 * `content/about/board.md` / `executive-council.md` person-card lists the
 * same way consolidated migration 0035's group chairs replaced static frontmatter:
 * assigned in the System portal, rendered client-side on the public site.
 */

export const leadershipBodySchema = z.enum(["board", "executive_council"]);
export type LeadershipBody = z.infer<typeof leadershipBodySchema>;

export const leadershipPositionIdParamsSchema = z.object({ id: databaseIdSchema });

export const leadershipPositionCreateSchema = z
  .object({
    body: leadershipBodySchema,
    userId: databaseIdSchema,
    memberId: databaseIdSchema.nullable().optional(),
    title: trimmedString(1, 80),
    startsAt: z.iso.date(),
    endsAt: z.iso.date().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.endsAt && value.endsAt < value.startsAt) {
      ctx.addIssue({ code: "custom", message: "endsAt cannot be before startsAt", path: ["endsAt"] });
    }
  });

export const leadershipPositionUpdateSchema = z
  .object({
    memberId: databaseIdSchema.nullable().optional(),
    title: trimmedString(1, 80).optional(),
    startsAt: z.iso.date().optional(),
    endsAt: z.iso.date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "No fields to update" });

export const leadershipPositionResponseSchema = z.object({
  id: z.string(),
  body: leadershipBodySchema,
  userId: z.string(),
  memberId: z.string().nullable(),
  organizationName: z.string().nullable(),
  name: z.string(),
  email: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LeadershipPosition = z.infer<typeof leadershipPositionResponseSchema>;

export const leadershipAffiliationSchema = z.object({
  memberId: databaseIdSchema,
  organizationName: z.string().nullable(),
  membershipCategory: z.string(),
});
export type LeadershipAffiliation = z.infer<typeof leadershipAffiliationSchema>;

export const leadershipAffiliationsResponseSchema = z.object({
  affiliations: z.array(leadershipAffiliationSchema),
});

export const leadershipAffiliationsParamsSchema = z.object({ userId: databaseIdSchema });

export const leadershipAffiliationsRouteSchema = {
  tags: ["Leadership"],
  summary: "List a user's eligible leadership affiliations",
  request: { params: leadershipAffiliationsParamsSchema },
  responses: {
    "200": {
      description: "Active individual and organization memberships the user can explicitly represent.",
      content: { "application/json": { schema: leadershipAffiliationsResponseSchema } },
    },
  },
};

export const LEADERSHIP_POSITION_SORT_COLUMNS = ["name", "title", "starts_at", "ends_at", "created_at"] as const;
export const leadershipPositionsListQuerySchema = listQuerySchema(LEADERSHIP_POSITION_SORT_COLUMNS).extend({
  body: leadershipBodySchema,
  status: z.enum(["current", "past"]).optional(),
});
export type LeadershipPositionsListQuery = z.infer<typeof leadershipPositionsListQuerySchema>;

export const leadershipPositionsListResponseSchema = paginatedResponseSchema(
  "positions",
  leadershipPositionResponseSchema,
);
export type LeadershipPositionsListResponse = z.infer<typeof leadershipPositionsListResponseSchema>;

export const leadershipPositionsListRouteSchema = {
  tags: ["Leadership"],
  summary: "List Board / Executive Council positions",
  description: "A searchable, sortable, bounded page of positions for the requested body.",
  request: { query: leadershipPositionsListQuerySchema },
  responses: {
    "200": {
      description: "Positions for the requested body.",
      content: { "application/json": { schema: leadershipPositionsListResponseSchema } },
    },
  },
};

export const leadershipPositionsCreateRouteSchema = {
  tags: ["Leadership"],
  summary: "Add a Board / Executive Council position",
  request: {
    body: { content: { "application/json": { schema: leadershipPositionCreateSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Position created.",
      content: { "application/json": { schema: leadershipPositionResponseSchema } },
    },
    "404": { description: "User not found." },
    "422": { description: "The affiliation is invalid or ambiguous." },
  },
};

export const leadershipPositionUpdateRouteSchema = {
  tags: ["Leadership"],
  summary: "Update a Board / Executive Council position",
  description: "Change the title and/or from/till dates of an existing position.",
  request: {
    params: leadershipPositionIdParamsSchema,
    body: { content: { "application/json": { schema: leadershipPositionUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Position updated.",
      content: { "application/json": { schema: leadershipPositionResponseSchema } },
    },
    "404": { description: "Position not found." },
    "422": { description: "The affiliation is not active for this user." },
  },
};

export const leadershipPositionDeleteRouteSchema = {
  tags: ["Leadership"],
  summary: "Remove a Board / Executive Council position",
  request: { params: leadershipPositionIdParamsSchema },
  responses: {
    "200": { description: "Position removed." },
    "404": { description: "Position not found." },
  },
};

/* ── Public response shapes ──────────────────────────────────────────────── */

export const leadershipPublicPersonSchema = publicOrganizationPersonSchema.extend({
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
});

export const leadershipPublicResponseSchema = z.object({
  current: z.array(leadershipPublicPersonSchema),
  past: z.array(leadershipPublicPersonSchema),
});
export type LeadershipPublicPerson = z.infer<typeof leadershipPublicPersonSchema>;
export type LeadershipPublicResponse = z.infer<typeof leadershipPublicResponseSchema>;

export const leadershipPublicRouteSchema = {
  tags: ["Leadership"],
  summary: "Public Board / Executive Council roster",
  request: { params: z.object({ body: leadershipBodySchema }) },
  responses: {
    "200": {
      description: "Current and past positions for the requested body.",
      content: { "application/json": { schema: leadershipPublicResponseSchema } },
    },
    "404": { description: "Unknown body." },
  },
};

export const consortiumChairsPublicResponseSchema = z.object({
  chair: leadershipPublicPersonSchema.omit({ title: true, endsAt: true }).nullable(),
  viceChair: leadershipPublicPersonSchema.omit({ title: true, endsAt: true }).nullable(),
});
export type ConsortiumChairsPublicResponse = z.infer<typeof consortiumChairsPublicResponseSchema>;

export const consortiumChairsPublicRouteSchema = {
  tags: ["Leadership"],
  summary: "Public consortium chair / vice chair",
  description:
    "Resolved from the published leadership of the configured All Members group, using the same source as group administration.",
  responses: {
    "200": {
      description: "Current consortium chair and vice chair, if assigned.",
      content: { "application/json": { schema: consortiumChairsPublicResponseSchema } },
    },
  },
};
