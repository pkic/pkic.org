/**
 * Interim Admin Tool (PRD §6 "Interim Admin Tool — Manual Member
 * Management (pre-Phase 4A)"). `POST/GET /api/v1/admin/members` lets staff
 * add a member (or finish one of the §6 Step 2 migration gaps) without
 * touching D1 by hand, mirroring the same organization/representative
 * shape the YAML migration script (scripts/migrate-members-yaml-to-d1.mjs)
 * already produces.
 */
import { z } from "zod";
import { normalizedEmailSchema } from "./api";

function trimmedString(min: number, max: number): z.ZodString {
  return z.string().trim().min(min).max(max);
}

export const MEMBERSHIP_CATEGORIES = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "H7",
  "H8",
] as const;
export const membershipCategorySchema = z.enum(MEMBERSHIP_CATEGORIES);

// Individual categories have no organization — §0.1's "NULL for individual
// categories H5/H6/H7" rule, same one the migration script applies.
export const INDIVIDUAL_MEMBERSHIP_CATEGORIES = new Set<string>(["H5", "H6", "H7"]);

export const WORKING_GROUP_SLUGS = ["ca", "cbom", "cm", "pkimm", "pqc", "tcwg"] as const;
export const workingGroupSlugSchema = z.enum(WORKING_GROUP_SLUGS);

export const representativeCreateSchema = z.object({
  name: trimmedString(1, 200),
  email: normalizedEmailSchema,
  role: trimmedString(0, 200).optional(),
  linkedin: z.url().optional(),
});

export const memberCreateSchema = z
  .object({
    organizationName: trimmedString(1, 200).optional(),
    website: z.url().optional(),
    description: trimmedString(0, 2000).optional(),
    membershipCategory: membershipCategorySchema,
    memberSince: z.iso.date(),
    representatives: z.array(representativeCreateSchema).min(1).max(10),
    workingGroupSlugs: z.array(workingGroupSlugSchema).max(WORKING_GROUP_SLUGS.length).default([]),
  })
  .superRefine((value, ctx) => {
    const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(value.membershipCategory);

    if (isIndividual) {
      if (value.organizationName) {
        ctx.addIssue({
          code: "custom",
          message: "Individual categories (H5/H6/H7) have no organization — leave organizationName blank",
          path: ["organizationName"],
        });
      }
      if (value.representatives.length !== 1) {
        ctx.addIssue({
          code: "custom",
          message: "Individual categories (H5/H6/H7) must have exactly one representative",
          path: ["representatives"],
        });
      }
    } else if (!value.organizationName) {
      ctx.addIssue({
        code: "custom",
        message: "organizationName is required for org-tied categories (A-G, H1-H4, H8)",
        path: ["organizationName"],
      });
    }
  });

export const adminMemberSummarySchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  organizationId: z.uuid().nullable(),
  organizationName: z.string().nullable(),
  name: z.string(),
  email: z.string(),
  membershipCategory: z.string(),
  status: z.string(),
  showOnOrgProfile: z.boolean(),
  createdAt: z.string(),
});

export const memberCreateResponseSchema = z.object({
  organizationId: z.uuid().nullable(),
  members: z.array(adminMemberSummarySchema),
});

export const adminMembersListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const membersListRouteSchema = {
  tags: ["Membership"],
  summary: "List members (Interim Admin Tool)",
  description:
    "PRD §6 Interim Admin Tool — unfiltered-by-status admin listing of every members row, one row per representative.",
  request: {
    query: adminMembersListQuerySchema,
  },
  responses: {
    "200": {
      description: "Members list.",
      content: {
        "application/json": {
          schema: z.object({
            members: z.array(adminMemberSummarySchema),
            page: z.object({ limit: z.number(), offset: z.number(), total: z.number(), hasMore: z.boolean() }),
          }),
        },
      },
    },
  },
};

export const membersCreateRouteSchema = {
  tags: ["Membership"],
  summary: "Create a member (or finish a migration gap) — Interim Admin Tool",
  description:
    "PRD §6 Interim Admin Tool — creates active organizations/users/members(/working_group_members) rows immediately. No email is sent.",
  request: {
    body: { content: { "application/json": { schema: memberCreateSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Member(s) created.",
      content: { "application/json": { schema: memberCreateResponseSchema } },
    },
    "409": { description: "A listed representative already holds a membership." },
  },
};
