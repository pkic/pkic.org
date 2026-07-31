import { z } from "zod";

/**
 * Leadership positions (migration 0049) — Board of Directors and Executive
 * Council rosters, admin-managed and publicly readable. Replaces the static
 * `content/about/board.md` / `executive-council.md` person-card lists the
 * same way migration 0040's forum/WG chairs replaced static frontmatter:
 * assigned in the admin portal, rendered client-side on the public site.
 */

export const leadershipBodySchema = z.enum(["board", "executive_council"]);

function trimmedString(min: number, max: number): z.ZodString {
  return z.string().trim().min(min).max(max);
}

export const leadershipPositionIdParamsSchema = z.object({ id: z.uuid() });

export const leadershipPositionCreateSchema = z
  .object({
    body: leadershipBodySchema,
    userId: z.uuid(),
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
    title: trimmedString(1, 80).optional(),
    startsAt: z.iso.date().optional(),
    endsAt: z.iso.date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "No fields to update" });

export const leadershipPositionResponseSchema = z.object({
  id: z.string(),
  body: leadershipBodySchema,
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const leadershipPositionsListQuerySchema = z.object({
  body: leadershipBodySchema,
});

export const leadershipPositionsListRouteSchema = {
  tags: ["Leadership"],
  summary: "List Board / Executive Council positions (admin)",
  description: "Every position (current and past) for the requested body, newest starts_at first.",
  request: { query: leadershipPositionsListQuerySchema },
  responses: {
    "200": {
      description: "Positions for the requested body.",
      content: { "application/json": { schema: z.object({ positions: z.array(leadershipPositionResponseSchema) }) } },
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

export const leadershipPublicPersonSchema = z.object({
  name: z.string(),
  title: z.string(),
  organizationName: z.string().nullable(),
  organizationLogoUrl: z.string().nullable(),
  organizationWebsite: z.string().nullable(),
  photoUrl: z.string().nullable(),
  linkedin: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
});

export const leadershipPublicResponseSchema = z.object({
  current: z.array(leadershipPublicPersonSchema),
  past: z.array(leadershipPublicPersonSchema),
});

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

export const forumChairsPublicResponseSchema = z.object({
  chair: leadershipPublicPersonSchema.omit({ title: true, endsAt: true }).nullable(),
  viceChair: leadershipPublicPersonSchema.omit({ title: true, endsAt: true }).nullable(),
});

export const forumChairsPublicRouteSchema = {
  tags: ["Leadership"],
  summary: "Public PKIC forum chair / vice chair",
  description:
    "Resolved from role-forum_chair/role-forum_vice_chair (migration 0040), same source as the admin Leadership tab.",
  responses: {
    "200": {
      description: "Current forum chair and vice chair, if assigned.",
      content: { "application/json": { schema: forumChairsPublicResponseSchema } },
    },
  },
};
