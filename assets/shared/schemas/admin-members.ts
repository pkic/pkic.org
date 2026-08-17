/**
 * Interim Admin Tool (Interim Admin Tool — Manual Member
 * Management). `POST/GET /api/v1/admin/members` lets staff
 * add a member (or finish one of the Step 2 migration gaps) without
 * touching D1 by hand, mirroring the same organization/representative
 * shape the YAML migration script (scripts/migrate-members-yaml-to-d1.mjs)
 * already produces.
 */
import { z } from "zod";
import { normalizedEmailSchema } from "./api";
import { paginationQuerySchema, paginatedResponseSchema } from "./pagination";
import {
  MEMBERSHIP_CATEGORIES,
  membershipCategorySchema,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  memberStatusSchema,
} from "./membership-categories";

export { MEMBERSHIP_CATEGORIES, membershipCategorySchema, INDIVIDUAL_MEMBERSHIP_CATEGORIES };

function trimmedString(min: number, max: number): z.ZodString {
  return z.string().trim().min(min).max(max);
}

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
  status: memberStatusSchema,
  showOnOrgProfile: z.boolean(),
  createdAt: z.string(),
});

export const memberCreateResponseSchema = z.object({
  organizationId: z.uuid().nullable(),
  members: z.array(adminMemberSummarySchema),
});

export const adminMembersListQuerySchema = paginationQuerySchema;

export const membersListRouteSchema = {
  tags: ["Membership"],
  summary: "List members (Interim Admin Tool)",
  description:
    "Interim Admin Tool — unfiltered-by-status admin listing of every members row, one row per representative.",
  request: {
    query: adminMembersListQuerySchema,
  },
  responses: {
    "200": {
      description: "Members list.",
      content: {
        "application/json": { schema: paginatedResponseSchema("members", adminMemberSummarySchema) },
      },
    },
  },
};

export const membersCreateRouteSchema = {
  tags: ["Membership"],
  summary: "Create a member (or finish a migration gap) — Interim Admin Tool",
  description:
    "Interim Admin Tool — creates active organizations/users/members(/working_group_members) rows immediately. No email is sent.",
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
