/**
 * Member self-service (PRD §4.9, §4.10). All endpoints operate on the
 * caller's own identity, resolved from a member session — never a
 * target-user path parameter.
 */
import { z } from "zod";

export const myProfileSchema = z.object({
  userId: z.uuid(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  preferredName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  biography: z.string().nullable(),
  links: z.array(z.string()),
  membershipCategory: z.string(),
  organizationId: z.uuid().nullable(),
  organizationName: z.string().nullable(),
  memberSince: z.string(),
  showOnOrgProfile: z.boolean(),
  canEditOrganizationName: z.boolean(),
});

export const myProfileGetRouteSchema = {
  tags: ["Me"],
  summary: "Get my profile (PRD §4.10)",
  responses: {
    "200": { description: "My profile.", content: { "application/json": { schema: myProfileSchema } } },
  },
};

export const myProfileUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().min(1).max(120).optional(),
  preferredName: z.string().trim().max(120).optional(),
  jobTitle: z.string().trim().max(160).optional(),
  biography: z.string().trim().max(5000).optional(),
  links: z.array(z.url()).max(15).optional(),
  organizationName: z.string().trim().max(200).optional(),
});

export const myProfileUpdateRouteSchema = {
  tags: ["Me"],
  summary: "Update my profile (PRD §4.10)",
  description: "organizationName is only honored for org-less categories (H5/H6/H7); ignored otherwise.",
  request: {
    body: { content: { "application/json": { schema: myProfileUpdateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Updated profile.", content: { "application/json": { schema: myProfileSchema } } },
  },
};

export const myApplicationsListRouteSchema = {
  tags: ["Me"],
  summary: "My application history (PRD §4.10)",
  responses: {
    "200": {
      description: "My applications.",
      content: {
        "application/json": {
          schema: z.object({
            applications: z.array(
              z.object({
                id: z.string(),
                status: z.string(),
                stage: z.string(),
                membershipCategory: z.string(),
                createdAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
  },
};

export const myVotesListRouteSchema = {
  tags: ["Me"],
  summary: "My vote history (PRD §4.10)",
  description:
    "Stub — the voting system is Phase 4B (§4.8), not yet built. Always returns an empty list; see prd.md Phase 4A status.",
  responses: {
    "200": {
      description: "My votes (always empty in this phase).",
      content: { "application/json": { schema: z.object({ votes: z.array(z.unknown()) }) } },
    },
  },
};

export const myOrganizationVisibilityUpdateSchema = z.object({
  showOnOrgProfile: z.boolean(),
});

export const myOrganizationVisibilityUpdateRouteSchema = {
  tags: ["Me"],
  summary: "Toggle whether I appear on my organization's public page (PRD §4.10)",
  request: {
    body: { content: { "application/json": { schema: myOrganizationVisibilityUpdateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Updated." },
  },
};

export const myWorkingGroupSummarySchema = z.object({
  workingGroupId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  joinedAt: z.string(),
});

export const myWorkingGroupsListRouteSchema = {
  tags: ["Me"],
  summary: "List my working group memberships (PRD §4.9)",
  responses: {
    "200": {
      description: "My working groups.",
      content: { "application/json": { schema: z.object({ workingGroups: z.array(myWorkingGroupSummarySchema) }) } },
    },
  },
};

export const myWorkingGroupJoinRouteSchema = {
  tags: ["Me"],
  summary: "Join a working group (PRD §4.9)",
  request: { params: z.object({ wgId: z.string() }) },
  responses: {
    "200": { description: "Joined." },
    "403": { description: "CA working group requires category A membership." },
    "404": { description: "Working group not found." },
  },
};

export const myWorkingGroupLeaveRouteSchema = {
  tags: ["Me"],
  summary: "Leave a working group (PRD §4.9)",
  request: { params: z.object({ wgId: z.string() }) },
  responses: {
    "200": { description: "Left." },
    "404": { description: "Working group not found." },
  },
};

export const myHeadshotUploadRouteSchema = {
  tags: ["Me"],
  summary: "Upload my headshot (PRD §4.10)",
  description: "multipart/form-data with a single 'file' field. JPEG, PNG, or WebP, up to 5MB.",
  responses: {
    "200": { description: "Uploaded." },
    "413": { description: "File too large." },
    "415": { description: "Unsupported file type." },
  },
};
